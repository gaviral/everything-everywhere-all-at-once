#!/usr/bin/env python3
"""Isolated static Git fixtures; no runtime, network or models."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

GUARD = Path(__file__).with_name('tree-guard.py').resolve()

class Boundary(unittest.TestCase):
    def setUp(self):
        # Keep temporary fixtures for reversible cleanup by the OS, no deletes.
        self.root = Path(tempfile.mkdtemp(prefix='tree-guard-test-'))
        self.git('init', '-q')
        self.git('config', 'user.name', 'Synthetic')
        self.git('config', 'user.email', 'synthetic@example.com')
        self.write('safe.txt', 'safe\n')
        self.git('add', '.')
        self.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Synthetic baseline')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.DEVNULL)

    def write(self, path, data):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(data)

    def run_guard(self, ok):
        p = subprocess.run([sys.executable, str(GUARD), '--repo', str(self.root)], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0 if ok else 1, p.stdout)
        self.assertNotIn(str(self.root), p.stdout + p.stderr)
        self.assertFalse(p.stderr)
        return p.stdout

    def stage(self, path, value):
        self.write(path, value)
        self.git('add', '-f', path)

    def test_safe_canvas_and_journal_source(self):
        self.stage('core/src/journal_tests.rs', '// synthetic test source\n')
        self.stage('view.html', '<canvas></canvas>\nCanvas view\n')
        self.run_guard(True)

    def test_staged_bad_and_hidden_index(self):
        value = 'sk-' + 'Q' * 30
        self.stage('new.md', value)
        out = self.run_guard(False)
        self.assertNotIn(value, out)
        self.write('new.md', 'safe')
        self.assertIn('index', self.run_guard(False))

    def test_missing_unreadable_symlink(self):
        self.stage('new.txt', 'safe')
        (self.root/'new.txt').rename(self.root/'saved.txt')
        self.run_guard(False)
        (self.root/'saved.txt').rename(self.root/'new.txt')
        (self.root/'new.txt').chmod(0)
        self.run_guard(False)
        (self.root/'new.txt').chmod(0o644)
        (self.root/'new.txt').rename(self.root/'saved.txt')
        (self.root/'new.txt').symlink_to('saved.txt')
        self.run_guard(False)

    def test_raw_report_and_changed_synthetic(self):
        self.stage('docs/meeting-report.md', 'Inbox report\nJordan said the appointment moved.\n')
        self.run_guard(False)
        self.write('docs/meeting-report.md', 'Fictional workshop scenario.\n')
        data = (self.root/'docs/meeting-report.md').read_bytes()
        record = {'version':1, 'fixtures':{'docs/meeting-report.md':{'kind':'synthetic', 'provenance':'Authored fictional workshop scenario for this test.', 'sha256':hashlib.sha256(data).hexdigest()}}}
        self.stage('scripts/fixture-provenance.json', json.dumps(record))
        self.git('add', 'docs/meeting-report.md')
        self.run_guard(True)
        self.write('docs/meeting-report.md', 'Changed fictional scenario.')
        self.run_guard(False)

    def test_predecessors_and_paths(self):
        for value in ['o'+'5', 'o'+'6', 'dev.'+'canvas.meta-api', 'o'+'5-memory', 'cursor'+'_worker', 'earlier '+'Can'+'vas project', 'cd projects/'+'can'+'vas', '/'+'Users/'+'synthetic/code/project', 'security find-generic-password -a '+'can'+'vas']:
            self.stage('safe.txt', value)
            self.run_guard(False)

    def test_private_paths(self):
        for path in ['.env', '.env.sample', '.claude/launch.json', 'data/state.json', 'inbox/raw.md', 'journal.jsonl', 'tls/identity.json', '.vscode/settings.json']:
            with self.subTest(path=path):
                self.stage(path, '')
                self.run_guard(False)
                self.git('rm', '--cached', path)
                # Reversible move, not deletion.
                (self.root/path).rename(self.root/('saved-'+hashlib.sha256(path.encode()).hexdigest()))
        self.stage('.env.example', '')
        self.run_guard(True)
        self.stage('.env.example', '# not blank\n')
        self.run_guard(False)

    def test_contacts_and_safe_diagnostics(self):
        for value in ['Person <real@'+'private.invalid>', '+1604'+'1234567', 'name='+'a'+'vi']:
            self.stage('safe.txt', value)
            self.assertNotIn(value, self.run_guard(False))

    def test_legal_and_secrets_in_allowed_files(self):
        notice = """Copyright (c) 2026 gaviral
Copyright (c) 2020 Upstream <author@upstream.invalid>
https://github.com/gaviral/e2a2o
sam@example.com
fixture@users.noreply.github.com
+15551234567
"""
        self.stage('LICENSE', notice)
        self.run_guard(True)
        for path in ['LICENSE', 'docs/note.md', 'scripts/tree-guard.py']:
            self.stage(path, notice+'\nsk-'+ 'R'*30)
            self.run_guard(False)
            self.stage(path, notice)

    def test_verified_dependency_contacts_are_narrow(self):
        path = 'dependency-licences/cargo/synthetic@1.0.0/Cargo.toml'
        notice = 'authors = ["Upstream <author@' + 'upstream.invalid>"]\nSupport: +1604' + '1234567\n'
        self.stage(path, notice)
        inventory = {'schema': 1, 'packages': [{
            'ecosystem': 'cargo', 'name': 'synthetic', 'version': '1.0.0',
            'archive_verified': True, 'evidence': [{
                'path': path, 'sha256': hashlib.sha256(notice.encode()).hexdigest()}]}]}
        def record(value):
            self.stage('dependency-licences/inventory.json', json.dumps(value))
        record(inventory)
        self.run_guard(True)
        # Unreviewed edits, even in this exact path, regain all contact checks.
        self.write(path, notice + 'Other <other@' + 'private.invalid>\n')
        self.assertIn('contact-email', self.run_guard(False))
        self.write(path, notice)
        self.stage('docs/note.md', notice)
        self.assertIn('contact-email', self.run_guard(False))
        self.stage('docs/note.md', 'safe')
        inventory['packages'][0]['archive_verified'] = False
        record(inventory)
        self.assertIn('contact-email', self.run_guard(False))
        inventory['packages'][0]['archive_verified'] = True
        # Matching evidence never suppresses credentials or personal paths.
        for value in ['sk-' + 'R'*30, '/'+'Users/'+'synthetic/private', 'name='+'a'+'vi']:
            data = notice + value
            self.stage(path, data)
            inventory['packages'][0]['evidence'][0]['sha256'] = hashlib.sha256(data.encode()).hexdigest()
            record(inventory)
            self.run_guard(False)

    def test_staged_deletion_and_private_filename(self):
        self.git('rm', '--cached', 'safe.txt')
        self.run_guard(True)
        (self.root/'safe.txt').rename(self.root/'saved.txt')
        self.run_guard(True)
        name = 'contact-' + 'a'+'vi' + '.txt'
        self.stage(name, 'safe')
        self.assertNotIn(name, self.run_guard(False))

    def test_git_error(self):
        p=subprocess.run([sys.executable,str(GUARD),'--repo',str(self.root/'absent')],capture_output=True,text=True)
        self.assertEqual(p.returncode,1)
        self.assertNotIn(str(self.root),p.stdout+p.stderr)

if __name__ == '__main__':
    unittest.main(verbosity=1)
