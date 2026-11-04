#!/usr/bin/env python3
"""Read-only lock/evidence checks. No installs, network, builds or app access."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]
LEGAL = re.compile(r'^(licen[cs]e|copying|copyright|notice|authors|unlicense|third[-_]party)(?:[.\-_].*|$)', re.I)
REQUIRED_NOTICES = {
    ('npm', 'rolldown', '1.2.16'): {'THIRD-PARTY-LICENSE'},
    ('cargo', 'security-framework', '3.7.0'): {'THIRD_PARTY'},
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def choose(spdx):
    # Legacy Cargo slash notation is retained in spdx; only the choice is normalized.
    if spdx == '(Apache-2.0 OR MIT) AND BSD-3-Clause':
        return 'MIT AND BSD-3-Clause'
    if spdx == '(MIT OR Apache-2.0) AND Unicode-3.0':
        return 'MIT AND Unicode-3.0'
    if 'AND' in spdx:
        return spdx
    if re.search(r'\bMIT\b', spdx):
        return 'MIT'
    return spdx.split(' OR ')[0]


def check(sources=False):
    ledger = json.loads((ROOT / 'dependency-licences/inventory.json').read_text())
    npm = json.loads((ROOT / 'ui/package-lock.json').read_text())['packages']
    cargo = tomllib.loads((ROOT / 'core/Cargo.lock').read_text())['package']
    expected = {('npm', k): v for k, v in npm.items() if k}
    expected.update({('cargo', p['name'] + '@' + p['version']): p for p in cargo if p.get('source')})
    entries = ledger['packages']
    assert len(entries) == len(expected), 'package count differs'
    assert {(p['ecosystem'], p['lock_key']) for p in entries} == set(expected), 'lock coverage differs'
    for path, checksum in ledger['locks'].items():
        assert digest((ROOT / path).read_bytes()) == checksum, 'lock changed: ' + path
    assert set(ledger['locks']) == {'ui/package-lock.json', 'core/Cargo.lock'}
    file_count = archive_count = 0
    notes = (ROOT / 'THIRD_PARTY_NOTICES.md').read_text()
    for p in entries:
        locked = expected[p['ecosystem'], p['lock_key']]
        assert p['version'] == locked['version']
        assert p['selected_licence'] == choose(p['spdx']), p['name'] + ': licence choice differs'
        assert f"`{p['name']}` | {p['version']} |" in notes, 'notice row missing'
        if p['ecosystem'] == 'npm':
            assert p['name'] == p['lock_key'].split('node_modules/')[-1]
            assert (p['source'], p['integrity'], p['spdx']) == (locked['resolved'], locked['integrity'], locked['license'])
            assert p['distribution'].startswith('build-only') == bool(locked.get('dev'))
        else:
            assert (p['name'], p['source'], p['checksum']) == (locked['name'], locked['source'], locked['checksum'])
        assert p['evidence'] or p['unresolved'], 'missing evidence must be explicit'
        required = REQUIRED_NOTICES.get((p['ecosystem'], p['name'], p['version']), set())
        assert required <= {f['source_file'] for f in p['evidence']}, p['name'] + ': required third-party notice missing'
        if p['archive_verified']:
            assert p['metadata_spdx'] == p['spdx'], 'metadata SPDX differs'
        files = None
        if sources and p['archive_verified']:
            if p['ecosystem'] == 'npm':
                h = base64.b64decode(p['integrity'].split('-', 1)[1]).hex()
                archive = Path.home() / '.npm/_cacache/content-v2/sha512' / h[:2] / h[2:4] / h[4:]
                data = archive.read_bytes()
                assert hashlib.sha512(data).hexdigest() == h, 'npm archive integrity differs'
            else:
                candidates = list((Path.home() / '.cargo/registry/cache').glob('*/' + p['name'] + '-' + p['version'] + '.crate'))
                assert len(candidates) == 1, 'exact archive unavailable or ambiguous: ' + p['lock_key']
                data = candidates[0].read_bytes()
                assert digest(data) == p['checksum'], 'Cargo archive checksum differs'
            with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as tar:
                prefix = p['archive_prefix']
                files = {m.name[len(prefix):]: tar.extractfile(m).read() for m in tar.getmembers() if m.isfile() and m.name.startswith(prefix)}
            archive_count += 1
            captured = {f['source_file'] for f in p['evidence']}
            omitted = {k for k in files if LEGAL.match(Path(k).name)} - captured
            assert not omitted, p['name'] + ': legal source file omitted: ' + ', '.join(sorted(omitted))
        for f in p['evidence']:
            path = ROOT / f['path']
            assert path.resolve().is_relative_to((ROOT / 'dependency-licences').resolve())
            data = path.read_bytes()
            assert digest(data) == f['sha256'], 'evidence changed: ' + f['path']
            file_count += 1
            if files is not None:
                if f['source_file'] is not None:
                    assert files[f['source_file']] == data, 'source text differs'
                else:
                    for snippet in json.loads(data):
                        source = files[snippet['source_file']]
                        assert digest(source) == snippet['source_sha256']
                        lines = source.decode().splitlines(keepends=True)
                        tail = ''.join(lines[snippet['line'] - 1:])
                        offset = tail.find(snippet['text'])
                        assert 0 <= offset <= len(lines[snippet['line'] - 1].rstrip('\r\n')), 'embedded notice differs'
    critical = {
        'ring': ('Apache-2.0 AND ISC', {'LICENSE-BoringSSL', 'LICENSE-other-bits', 'third_party/fiat/LICENSE', 'src/polyfill/once_cell/LICENSE-MIT', 'src/polyfill/once_cell/LICENSE-APACHE'}),
        'matchit': ('MIT AND BSD-3-Clause', {'LICENSE', 'LICENSE.httprouter'}),
        'encoding_rs': ('MIT AND BSD-3-Clause', {'COPYRIGHT', 'LICENSE-WHATWG', 'LICENSE-MIT'}),
        'unicode-ident': ('MIT AND Unicode-3.0', {'LICENSE-UNICODE', 'LICENSE-MIT'}),
    }
    for name, (choice, required) in critical.items():
        p = next(p for p in entries if p['ecosystem'] == 'cargo' and p['name'] == name)
        assert p['selected_licence'] == choice
        assert required <= {e['source_file'] for e in p['evidence']}, name + ': required text missing'
    unicode = [p for p in entries if 'Unicode-3.0' in p['spdx']]
    assert all(any('LICENSE' in (e['source_file'] or '').upper() for e in p['evidence']) for p in unicode)
    public = [ROOT / 'THIRD_PARTY_NOTICES.md', ROOT / 'scripts/dependency-licences-check.py']
    public += [p for p in (ROOT / 'dependency-licences').rglob('*') if p.is_file()]
    for path in public:
        text = path.read_text()
        # Upstream legal names/emails are preserved; machine paths and credentials are not.
        assert not re.search(r'/(?:Users|home)/[^\s"<>]+|_authToken\s*[:=]|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', text), 'private material: ' + str(path.relative_to(ROOT))
    gaps = sum(bool(p['unresolved']) for p in entries)
    print(f'PASS: {len(npm)-1} npm + {len(cargo)-1} third-party Cargo entries; {file_count} evidence files; {len(unicode)} Unicode entries; {gaps} documented unresolved entries.')
    if sources:
        print(f'PASS: {archive_count} cached archives match lock integrity and retained source texts.')
    return ledger


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', action='store_true', help='also compare texts with exact local cached archives')
    args = parser.parse_args()
    check(args.sources)
