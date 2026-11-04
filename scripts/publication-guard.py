"""Offline outgoing history gate. Imported by tree-guard and its installer."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

SPEC = importlib.util.spec_from_file_location('tree_rules', Path(__file__).with_name('tree-guard.py'))
tree = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tree)
MAIN = 'refs/heads/main'


def policy(root, path):
    if path is None:
        common = Path(os.fsdecode(tree.git(root, 'rev-parse', '--git-common-dir').strip()))
        path = (Path(root) / common).resolve() / 'publication-guard' / 'allowlist.json'
    value = json.loads(Path(path).read_bytes())
    if (set(value) != {'version', 'refs'} or value['version'] != 1 or
            not isinstance(value['refs'], dict) or set(value['refs']) != {MAIN}):
        raise ValueError('invalid approval policy')
    return value['refs']


def scan(root, allowlist, ref_input, approved=None):
    # The hook input, not HEAD, tracking refs, or remote state, defines the roots.
    root = Path(root).resolve()
    fmt = tree.git(root, 'rev-parse', '--show-object-format').strip().decode('ascii')
    width = hashlib.new(fmt).digest_size * 2
    oid_re = re.compile('[0-9a-f]{' + str(width) + '}')
    approved = policy(root, allowlist) if approved is None else approved
    if set(approved) != {MAIN} or any(not isinstance(v, str) or not oid_re.fullmatch(v) or
                                    v == '0' * width for v in approved.values()):
        raise ValueError('invalid approved main')
    updates = ref_input.decode('ascii').splitlines()
    if not updates:
        raise ValueError('empty ref inventory')
    roots, destinations = set(), set()
    for row in updates:
        fields = row.split()
        if len(fields) != 4:
            raise ValueError('invalid ref input')
        local, oid, remote, old = fields
        if (remote in destinations or remote not in approved or oid != approved[remote] or
                local == '(delete)' or not oid_re.fullmatch(old)):
            raise ValueError('unapproved ref update')
        destinations.add(remote)
        roots.add(oid)
    if tree.git(root, 'rev-parse', '--is-shallow-repository').strip() != b'false':
        raise ValueError('shallow history')
    graft = Path(os.fsdecode(tree.git(root, 'rev-parse', '--git-path', 'info/grafts').strip()))
    if not graft.is_absolute():
        graft = root / graft
    if graft.exists() and graft.stat().st_size:
        raise ValueError('grafted history')
    inventory = tree.git(root, 'rev-list', '--objects', '--no-object-names', *sorted(roots)).splitlines()
    if not inventory or any(not oid_re.fullmatch(o.decode('ascii')) for o in inventory):
        raise ValueError('incomplete inventory')
    objects = {}
    with subprocess.Popen(['git', '--no-replace-objects', '-C', str(root), 'cat-file', '--batch'],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          env={**os.environ, 'GIT_NO_LAZY_FETCH': '1'}) as batch:
        try:
            for oid in dict.fromkeys(inventory):
                batch.stdin.write(oid + b'\n')
                batch.stdin.flush()
                header = batch.stdout.readline().split()
                if len(header) != 3 or header[0] != oid or header[1] not in (b'blob', b'tree', b'commit'):
                    raise ValueError('missing or unexpected object')
                size = int(header[2])
                if size < 0:
                    raise ValueError('invalid size')
                data = batch.stdout.read(size)
                if len(data) != size or batch.stdout.read(1) != b'\n':
                    raise ValueError('incomplete object')
                digest = hashlib.new(fmt, header[1] + b' ' + str(size).encode() + b'\0' + data).hexdigest()
                if digest.encode() != oid:
                    raise ValueError('object digest mismatch')
                objects[oid.decode()] = (header[1], data)
        except BaseException:
            batch.kill()  # Only this scanner's own subprocess.
            raise
        finally:
            batch.stdin.close()
        if batch.wait() != 0:
            raise ValueError('object reader failed')

    seen, trees, commits = set(), {}, {}

    pending = [(oid, b'commit') for oid in roots]
    while pending:
        oid, expected = pending.pop()
        kind, data = objects[oid]  # Missing references fail closed.
        if kind != expected:
            raise ValueError('wrong object type')
        if oid in seen:
            continue
        seen.add(oid)
        if kind == b'commit':
            headers, message = data.split(b'\n\n', 1)
            lines = headers.splitlines()
            tree_ids = [x[5:].decode('ascii') for x in lines if x.startswith(b'tree ')]
            if len(tree_ids) != 1 or any(sum(x.startswith(k) for x in lines) != 1
                                         for k in (b'author ', b'committer ')):
                raise ValueError('invalid commit headers')
            commits[oid] = tree_ids[0]
            pending.append((tree_ids[0], b'tree'))
            for line in lines:
                if line.startswith(b'parent '):
                    pending.append((line[7:].decode('ascii'), b'commit'))
        elif kind == b'tree':
            entries, at, names = [], 0, set()
            while at < len(data):
                end = data.index(b'\0', at)
                mode, name = data[at:end].split(b' ', 1)
                child = data[end+1:end+1+width//2].hex()
                if (len(child) != width or not name or b'/' in name or name in names or
                        name in (b'.', b'..') or mode not in (b'40000', b'100644', b'100755')):
                    raise ValueError('unsupported tree entry')
                names.add(name)
                entries.append((name, child, mode))
                pending.append((child, b'tree' if mode == b'40000' else b'blob'))
                at = end + 1 + width//2
            trees[oid] = entries
    if seen != set(objects):
        raise ValueError('incomplete or extraneous inventory')

    failures = set()

    def report(rule, oid, line=1):
        failures.add((rule, oid, line))

    for oid, (kind, data) in objects.items():
        if kind == b'commit':
            # Exact approved public identity may use its public display name.
            # No other header, message line, or identity is exempted.
            public = ('A' + 'vi <' + tree.PUBLIC_EMAIL + '>').encode()
            headers, message = data.split(b'\n\n', 1)
            headers = re.sub(rb'(?m)^(author|committer) ' + re.escape(public) + rb'(?= [0-9]+ [+-][0-9]{4}$)',
                             rb'\1 <' + tree.PUBLIC_EMAIL.encode() + b'>', headers, count=2)
            data = headers + b'\n\n' + message
        if kind in (b'blob', b'commit'):
            for rule, line in tree.content_findings(data):
                report(rule, oid, line)

    def files(oid, prefix=''):
        for raw, child, mode in trees[oid]:
            path = prefix + os.fsdecode(raw)
            if tree.forbidden_path(path):
                report('private-path', child)
            for rule, line in tree.content_findings(os.fsencode(path)):
                report(rule, child, line)
            if mode == b'40000':
                yield from files(child, path + '/')
            else:
                yield path, child

    for tree_id in set(commits.values()):
        snapshot = dict(files(tree_id))
        records = {}
        if tree.MANIFEST in snapshot:
            manifest = json.loads(objects[snapshot[tree.MANIFEST]][1])
            if manifest.get('version') != 1 or not isinstance(manifest.get('fixtures'), dict):
                raise ValueError('invalid historical manifest')
            records = manifest['fixtures']
        for path, oid in snapshot.items():
            data = objects[oid][1]
            if Path(path).name.lower() == '.env.example' and data.strip():
                report('nonblank-env-example', oid)
            if path != tree.MANIFEST and tree.fixture(path, data):
                record = records.get(path, {})
                if (record.get('kind') != 'synthetic' or not record.get('provenance') or
                        record.get('sha256') != hashlib.sha256(data).hexdigest()):
                    report('synthetic-provenance-required', oid)
    for rule, oid, line in sorted(failures):
        print(f'FAIL publication-guard {rule}: object={oid} line={line} (redacted)')
    print(f'{"FAIL" if failures else "PASS"} publication-guard: {len(roots)} approved ref; '
          f'{len(commits)} commits; {len(objects)} complete reachable objects')
    return 1 if failures else 0
