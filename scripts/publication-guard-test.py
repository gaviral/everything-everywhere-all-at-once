#!/usr/bin/env python3
"""Offline temporary Git fixtures; invokes hooks directly, never pushes."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
GUARD = HERE / 'tree-guard.py'
INSTALL = HERE / 'install-publication-guard.py'


class Publication(unittest.TestCase):
    def setUp(self):
        # Retained in OS temp storage, no permanent deletion of fixture files.
        self.root = Path(tempfile.mkdtemp(prefix='publication-guard-test-'))
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Synthetic')
        self.git('config', 'user.email', 'fixture@users.noreply.github.com')
        self.write('safe.txt', 'safe\n')
        self.commit()
        self.main = self.git('rev-parse', 'main').strip()
        self.allowlist = self.root / '.git' / 'approved.json'
        self.approve(self.main)

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args],
                                       stderr=subprocess.DEVNULL).decode()

    def write(self, path, data):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(data)

    def commit(self, message='Synthetic change', env=None):
        self.git('add', '.')
        subprocess.run(['git', '-C', str(self.root), '-c', 'core.hooksPath=/dev/null',
                        'commit', '-qm', message], env={**os.environ, **(env or {})},
                       check=True, capture_output=True)
        return self.git('rev-parse', 'HEAD').strip()

    def approve(self, oid):
        self.allowlist.write_text(json.dumps({'version': 1, 'refs': {'refs/heads/main': oid}}))

    def row(self, oid=None, destination='refs/heads/main', source='refs/heads/main', old=None):
        return f'{source} {oid or self.main} {destination} {old or "0" * 40}\n'

    def check(self, ok, rows=None, env=None, command=None):
        result = subprocess.run(command or [sys.executable, str(GUARD), '--repo', str(self.root),
                                '--pre-push', '--allowlist', str(self.allowlist), 'origin', 'unused'],
                                input=self.row() if rows is None else rows, text=True,
                                capture_output=True, cwd=self.root, env={**os.environ, **(env or {})})
        self.assertEqual(result.returncode, 0 if ok else 1, result.stdout + result.stderr)
        self.assertFalse(result.stderr)
        self.assertNotIn(str(self.root), result.stdout)
        return result.stdout

    def test_permitted_main_and_unrelated_dirty_refs(self):
        self.git('checkout', '-qb', 'side')
        self.write('safe.txt', 'sk-' + 'R' * 30)
        dirty = self.commit()
        self.git('tag', 'old-copy', dirty)
        # HEAD is dirty and a tag exists, but neither is proposed for publication.
        self.check(True)

    def test_clean_tip_cannot_hide_ancestor_even_if_remote_has_it(self):
        self.write('safe.txt', 'sk-' + 'R' * 30)
        dirty = self.commit()
        self.write('safe.txt', 'safe again\n')
        tip = self.commit()
        self.approve(tip)
        out = self.check(False, self.row(tip, old=dirty), env={'ACCEPT_COMMITS': dirty})
        self.assertIn('legacy-api-key', out)
        self.assertNotIn('R' * 30, out)

    def test_historical_private_path(self):
        self.write('inbox/removed.txt', '')
        self.commit()
        (self.root / 'inbox/removed.txt').rename(self.root / '.git/retained.txt')
        tip = self.commit()
        self.approve(tip)
        self.assertIn('private-path', self.check(False, self.row(tip)))

    def test_bad_side_tag_and_all_mirror_backup_rows(self):
        self.git('checkout', '-qb', 'side')
        self.write('safe.txt', 'sk-' + 'R' * 30)
        dirty = self.commit()
        self.git('tag', '-a', 'old-copy', '-m', 'Synthetic tag', dirty)
        tag = self.git('rev-parse', 'refs/tags/old-copy').strip()
        for destination, oid in [('refs/tags/old-copy', tag), ('refs/heads/side', dirty),
                                 ('refs/backup/old-main', dirty), ('refs/remotes/origin/main', self.main)]:
            with self.subTest(destination=destination):
                self.check(False, self.row() + self.row(oid, destination, destination))

    def test_unapproved_tip_deletion_and_malformed_input(self):
        self.write('safe.txt', 'new safe\n')
        newer = self.commit()
        for rows in [self.row(newer), self.row('0' * 40, source='(delete)'), '', '\n',
                     self.row() + self.row(), 'malformed\n', self.row(old='bad')]:
            self.check(False, rows)

    def test_missing_or_broadened_approval(self):
        self.allowlist.rename(self.root / '.git/retained-approval.json')
        self.check(False)
        self.allowlist.write_text(json.dumps({'version': 1, 'refs': {
            'refs/heads/main': self.main, 'refs/tags/old-copy': self.main}}))
        self.check(False)

    def test_full_message_and_both_identities(self):
        for env, message in [({}, 'Safe subject\n\n' + ('ordinary\n' * 60) + 'sk-' + 'T' * 30),
                             ({'GIT_AUTHOR_EMAIL': 'someone@' + 'private.invalid'}, 'Safe subject'),
                             ({'GIT_COMMITTER_EMAIL': 'someone@' + 'private.invalid'}, 'Safe subject')]:
            self.git('checkout', '-q', self.main)
            self.write('safe.txt', 'safe changed\n')
            tip = self.commit(message, env)
            self.approve(tip)
            self.check(False, self.row(tip))

    def test_exact_public_identity_and_message_not_exempt(self):
        name = 'A' + 'vi'
        email = '12901566+gaviral@users.noreply.github.com'
        identity = {'GIT_AUTHOR_NAME': name, 'GIT_AUTHOR_EMAIL': email,
                    'GIT_COMMITTER_NAME': name, 'GIT_COMMITTER_EMAIL': email}
        self.write('safe.txt', 'safe changed\n')
        tip = self.commit(env=identity)
        self.approve(tip)
        self.check(True, self.row(tip))
        self.write('safe.txt', 'safe changed again\n')
        tip = self.commit('Safe\n\nauthor ' + name + ' <' + email + '> 1234567890 +0000', identity)
        self.approve(tip)
        self.check(False, self.row(tip))

    def test_enumeration_failure_and_successful_truncation(self):
        real_git = subprocess.check_output(['which', 'git'], text=True).strip()
        bin_dir = self.root / '.git' / 'fixture-bin'
        bin_dir.mkdir()
        wrapper = bin_dir / 'git'
        for body in ['exit 1', 'exit 0', 'printf "%s\\n" "$FIXTURE_TIP"']:
            wrapper.write_text('#!/bin/sh\ncase " $* " in *" rev-list "*) ' + body +
                               ';; *) exec "' + real_git + '" "$@";; esac\n')
            wrapper.chmod(0o700)
            self.check(False, env={'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'],
                                   'FIXTURE_TIP': self.main})

    def test_shallow_and_missing_object(self):
        self.write('.git/shallow', self.main + '\n')
        self.check(False)
        (self.root / '.git/shallow').rename(self.root / '.git/retained-shallow')
        oid = self.git('rev-parse', 'main:safe.txt').strip()
        obj = self.root / '.git/objects' / oid[:2] / oid[2:]
        obj.rename(self.root / '.git/retained-object')
        self.check(False)

    def test_installer_check_only_activation_and_existing_hook(self):
        command = [sys.executable, str(INSTALL), '--repo', str(self.root), '--approved-main', self.main]
        self.check(True, command=command + ['--check-only'])
        self.assertFalse((self.root / '.git/publication-guard').exists())
        config = (self.root / '.git/config').read_bytes()
        self.check(True, command=command)
        hook = self.root / '.git/hooks/pre-push'
        self.check(True, command=[str(hook), 'origin', 'unused'])
        self.check(False, self.row(destination='refs/tags/old-copy'), command=[str(hook), 'origin', 'unused'])
        original = hook.read_bytes()
        self.check(False, command=command)
        self.assertEqual(original, hook.read_bytes())
        self.assertEqual(config, (self.root / '.git/config').read_bytes())

    def test_installer_refuses_dirty_history_and_custom_hook_path(self):
        self.write('safe.txt', 'sk-' + 'R' * 30)
        dirty = self.commit()
        command = [sys.executable, str(INSTALL), '--repo', str(self.root), '--approved-main']
        self.check(False, command=command + [dirty])
        self.assertFalse((self.root / '.git/hooks/pre-push').exists())
        self.git('config', 'core.hooksPath', '.custom-hooks')
        self.check(False, command=command + [self.main])
        self.assertFalse((self.root / '.git/publication-guard').exists())


if __name__ == '__main__':
    unittest.main(verbosity=1)
