#!/usr/bin/env python3
"""Explicit, offline installation only after approved history sanitation."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('publication', HERE / 'publication-guard.py')
publication = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publication)


def install(args):
    root = Path(args.repo).resolve()
    approved = {publication.MAIN: args.approved_main}
    rows = f'{publication.MAIN} {args.approved_main} {publication.MAIN} {"0" * len(args.approved_main)}\n'.encode()
    if publication.scan(root, None, rows, approved=approved):
        return 1
    if args.check_only:
        print('PASS publication installer: check only; no hook or policy written')
        return 0
    git = publication.tree.git
    configured = subprocess.run(['git', '-C', str(root), 'config', '--get', 'core.hooksPath'],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if configured.returncode != 1:
        raise ValueError('configured hooks path requires manual review')
    common = Path(os.fsdecode(git(root, 'rev-parse', '--git-common-dir').strip()))
    common = (root / common).resolve()
    hooks = common / 'hooks'
    hook = hooks / 'pre-push'
    bundle = common / 'publication-guard'
    if hook.exists() or hook.is_symlink() or bundle.exists() or bundle.is_symlink():
        raise ValueError('existing hook or bundle; preserve and review manually')
    # New directory only. A failed installation retains it for review/recovery.
    bundle.mkdir(mode=0o700)
    for name in ('tree-guard.py', 'secret-scan.py', 'publication-guard.py'):
        (bundle / name).write_bytes((HERE / name).read_bytes())
    policy = bundle / 'allowlist.json'
    policy.write_text(json.dumps({'version': 1, 'refs': approved}) + '\n')
    launcher = bundle / 'pre-push'
    launcher.write_text('#!/bin/sh\nexec python3 ' + shlex.quote(str(bundle / 'tree-guard.py')) +
                        ' --repo . --pre-push --allowlist ' + shlex.quote(str(policy)) + ' "$@"\n')
    launcher.chmod(0o700)
    hooks.mkdir(exist_ok=True)
    # Atomic installation, never overwrites another hook or rewrites a launcher.
    os.link(launcher, hook)
    print('PASS publication installer: approved main pinned; pre-push hook activated')
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default='.')
    parser.add_argument('--approved-main', required=True, help='explicitly reviewed full sanitized commit OID')
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    try:
        sys.exit(install(args))
    except (OSError, ValueError, TypeError, AttributeError, KeyError, RecursionError, subprocess.SubprocessError):
        print('FAIL publication installer: approval, inventory or installation failed (details redacted)')
        sys.exit(1)
