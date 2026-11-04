#!/usr/bin/env python3
"""Static index + tracked worktree boundary. No history, network, or app calls."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

spec = importlib.util.spec_from_file_location('secret_rules', Path(__file__).with_name('secret-scan.py'))
secrets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(secrets)
MANIFEST = 'scripts/fixture-provenance.json'
# Split spellings keep executable negative patterns from being literal leak examples.
OLD = '(?:o[56]|dev[.]' + 'canvas[.]meta-api|o[5]-memory|cursor' + '_worker)'
RULES = {
    'home-path': r'(?:/(?:Users|home)/[\w.-]+|[A-Z]:[\\/]Users[\\/][\w.-]+|~[/\\](?![.]cargo/(?:registry|git)(?:\s|$)))',
    'predecessor': r'(?i)(?<![\w])' + OLD + r'(?![\w])',
    'project-checkout': r'(?i)(?:code|checkouts?|projects?)[/\\](?:canvas|e2a2o[^\s/\\]*)',
    'earlier-project': r'(?i)(?:\b(?:old|earlier|previous|predecessor|legacy)\s+(?:project\s+)?c[a]nvas\b|\bc[a]nvas\s+(?:project|checkout|repository|repo|keychain)\b|\b(?:project|checkout|repository|repo)\s+c[a]nvas\b|(?:cd|git\s+clone)\s+[^\n]*[/\\]c[a]nvas\b|security\s+[^\n]*c[a]nvas|keychain[^\n]*c[a]nvas)',
    'owner-dictation': r'(?i)\ba[v]i\b|\bowner[ -]dictation\s*[:=]|\b(?:ver[b]atim|byte for b[y]te)\b[^\n]*\b(?:inbox|dictation|private)\b',
}
PATTERNS = {k: re.compile(v) for k, v in RULES.items()}
EMAIL = re.compile(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}')
PHONE = re.compile(r'(?<![\w.])(?:\+\d{10,15}|(?:\+?1[- .]?)?\(?\d{3}\)?[- .]\d{3}[- .]\d{4})(?![\w.])')
PUBLIC_EMAIL = '12901566+gaviral@users.noreply.github.com'


def forbidden_path(path):
    parts = path.lower().split('/')
    base = parts[-1]
    if base in {'.editorconfig', '.claude.json', '.cursorignore', '.cursorrules'}:
        return True
    if base.startswith('.env'):
        return base != '.env.example'
    if any(p in {'.claude', '.cursor', '.vscode', '.idea', 'data', 'journals', 'journal',
                 'logs', 'tls', 'exports', 'export', 'chats', 'chat', 'inbox', 'personal',
                 'contacts', '.ssh', '.config'} for p in parts):
        return True
    # journal_tests.rs is source; journal.jsonl and rotated journals are state.
    return bool(re.search(r'(?i)(?:\.(?:log|pem|key|p12|pfx|sqlite|sqlite3|db)|(?:^|[-_.])(?:journal|inbox|export|contacts)(?:[-.]\d+)?\.(?:jsonl?|csv|txt|md))$', base))


def fixture(path, data):
    p = path.lower()
    return (p.endswith(('.jsonl', '.csv', '.tsv')) or
            (p.startswith(('samples/', 'fixtures/', 'testdata/')) and not p.endswith(('.rs', '.ts', '.py', '.js'))) or
            bool(re.search(r'(?:^|/|[-_])(?:sample|fixture|export|inbox|chat|report)(?:[-_].*)?\.(?:json|md|txt)$', p)) or
            p == 'docs/compaction-check.md' or
            (p.endswith(('.md', '.txt', '.json')) and bool(re.search(rb'(?i:inbox report|raw inbox|private dictation)', data))) or
            (p.endswith(('.json', '.txt', '.md')) and bool(re.search(rb'"(?:mapping|messages|user_profile|thought_added)"\s*:', data))))


def content_findings(data):
    found = set(secrets.findings(data))
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        # Still scan key/token signatures in all bytes; prose rules need text.
        return sorted(found)
    for number, line in enumerate(text.splitlines(), 1):
        for rule, pattern in PATTERNS.items():
            if pattern.search(line):
                found.add((rule, number))
        for m in EMAIL.finditer(line):
            email = m.group()
            # Public account identity; fictional examples; upstream copyright
            # attribution only. These never suppress any other rule on the line.
            legal = bool(re.match(r'^\s*(?:\*|//|#)?\s*Copyright\s+(?:\(c\)\s*)?\d{4}', line, re.I))
            if not (email.endswith('@example.com') or email in {PUBLIC_EMAIL, 'fixture@users.noreply.github.com'} or legal or line[max(0, m.start()-3):m.start()] == '://'):
                found.add(('contact-email', number))
        for m in PHONE.finditer(line):
            digits = re.sub(r'\D', '', m.group())
            if 10 <= len(digits) <= 15 and not re.fullmatch(r'1?\d{3}555\d{4}|1555\d{7}', digits):
                # Require phone punctuation; plain timestamps/IDs are not contacts.
                if re.search(r'[+() -]', m.group()):
                    found.add(('contact-phone', number))
    return sorted(found)


def git(root, *args):
    return subprocess.check_output(['git', '--no-replace-objects', '-C', str(root), *args],
                                   stderr=subprocess.DEVNULL, env={**os.environ, 'GIT_NO_LAZY_FETCH': '1'})


def scan(root):
    root = Path(os.fsdecode(git(root, 'rev-parse', '--show-toplevel').strip()))
    entries = {}
    for entry in git(root, 'ls-files', '--stage', '-z').split(b'\0'):
        if not entry:
            continue
        meta, raw = entry.split(b'\t', 1)
        mode, oid, stage = meta.split()
        if stage != b'0' or mode not in (b'100644', b'100755'):
            raise ValueError('unsupported index entry')
        entries[os.fsdecode(raw)] = git(root, 'cat-file', 'blob', oid.decode('ascii'))
    # HEAD union catches staged deletions still present locally; removed files
    # in the index must remain readable in the worktree until staged as deletion.
    head_paths = set()
    if git(root, 'rev-parse', '--verify', '--quiet', 'HEAD'):
        head_paths = {os.fsdecode(p) for p in git(root, 'ls-tree', '-r', '--name-only', '-z', 'HEAD').split(b'\0') if p}
    work = {}
    for path in set(entries) | head_paths:
        file = root / path
        if path not in entries and not file.exists():
            continue  # A complete staged deletion has no candidate bytes.
        s = file.lstat()
        if not stat.S_ISREG(s.st_mode) or not s.st_mode & 0o444:
            raise ValueError('unreadable tracked entry')
        work[path] = file.read_bytes()
    count = 0
    def report(rule, source, path, line=1):
        nonlocal count
        count += 1
        # Even a filename can contain personal text: use a stable locator only.
        locator = hashlib.sha256(os.fsencode(path)).hexdigest()[:12]
        print(f'FAIL tree-guard {rule}: {source} path-id={locator} line={line} (redacted)')
    for source, files in [('index', entries), ('worktree', work)]:
        records = {}
        if MANIFEST in files:
            manifest = json.loads(files[MANIFEST])
            if manifest.get('version') != 1 or not isinstance(manifest.get('fixtures'), dict):
                raise ValueError('invalid manifest')
            records = manifest['fixtures']
        for path, data in files.items():
            if forbidden_path(path):
                report('private-path', source, path)
            if Path(path).name.lower() == '.env.example' and data.strip():
                report('nonblank-env-example', source, path)
            for rule, line in content_findings(os.fsencode(path)) + content_findings(data):
                report(rule, source, path, line)
            if path != MANIFEST and fixture(path, data):
                record = records.get(path, {})
                if (record.get('kind') != 'synthetic' or not record.get('provenance') or
                        record.get('sha256') != hashlib.sha256(data).hexdigest()):
                    report('synthetic-provenance-required', source, path)
    if count:
        return 1
    print('PASS tree-guard: index and tracked worktree; history/film/release clearance remains open')
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default='.')
    args = parser.parse_args()
    try:
        sys.exit(scan(args.repo))
    except (OSError, ValueError, TypeError, AttributeError, subprocess.SubprocessError):
        print('FAIL tree-guard: Git/input enumeration or read failed (details redacted)')
        sys.exit(1)
