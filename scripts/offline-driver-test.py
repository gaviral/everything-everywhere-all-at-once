#!/usr/bin/env python3
"""Offline driver fixtures; pass --runner PATH to exercise the host scheduler.

Uses fake cargo/npm/node executables and temporary resource roots, never a build,
browser, network, model, or the live machine's lease pool.
"""
import argparse
import importlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ARGS = argparse.ArgumentParser(description=__doc__)
ARGS.add_argument('--runner', required=True)
OPTIONS, REST = ARGS.parse_known_args()
HOST = Path(OPTIONS.runner).resolve()
sys.path.insert(0, str(HOST.parent))
resources = importlib.import_module('resources')
DRIVER = Path(__file__).with_name('test.sh')

NODE = '''#!/usr/bin/env python3
import fcntl, json, os, pathlib, signal, subprocess, sys, time
spec = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert pathlib.Path('ui/built').exists(), 'build must precede UI checks'
entry = json.loads(os.environ.get('E2A2O_LEASES', '{}')).get('heavy')
lease = None
if entry:
    stat = os.fstat(entry['fd'])
    assert stat.st_ino == pathlib.Path(entry['path']).stat().st_ino
    lease = entry['path']
def event(kind):
    with open(os.environ['EVENTS'], 'a') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.write(json.dumps([time.monotonic(), kind, sys.argv[1], lease]) + '\\n')
event('start')
time.sleep(spec.get('sleep', .25))
event('end')
print('SKIP fixture: unavailable' if spec['rc'] == 3 else 'fixture diagnostic', flush=True)
if spec.get('kill_worker'):
    parent = os.getppid()
    if entry:  # Kill the shell worker, not just its Python lease runner.
        parent = int(subprocess.check_output(['ps', '-p', str(parent), '-o', 'ppid=']))
    os.kill(parent, signal.SIGKILL)
sys.exit(spec['rc'])
'''
WRAPPER = '''import os, runpy, sys
sys.path.insert(0, os.path.dirname(os.environ['HOST_RUNNER']))
import resources
resources.pressure = lambda: {'pressure': int(os.environ.get('FIXTURE_PRESSURE', '1'))}
runpy.run_path(os.environ['HOST_RUNNER'], run_name='__main__')
'''


class DriverTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='offline-driver-fixture-')
        self.root = Path(self.tmp.name)
        for folder in ('scripts', 'core', 'ui/node_modules', 'bin', 'tmp'):
            (self.root / folder).mkdir(parents=True)
        shutil.copy2(DRIVER, self.root / 'scripts/test.sh')
        (self.root / 'runner.py').write_text(WRAPPER)
        commands = {
            'node': NODE,
            'cargo': '#!/bin/sh\necho "test result: ok. 7 passed; 0 failed; 2 ignored"\necho "core diagnostic"\nexit "${CORE_RC:-0}"\n',
            'npm': '#!/bin/sh\ntouch built\necho "build diagnostic"\nexit "${BUILD_RC:-0}"\n',
        }
        for name, source in commands.items():
            p = self.root / 'bin' / name
            p.write_text(source); p.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.root / 'bin') + ':' + os.environ['PATH'],
                        TMPDIR=str(self.root / 'tmp'), E2A2O_RESOURCES=str(self.root / 'leases'),
                        E2A2O_LEASES='{}', EVENTS=str(self.root / 'events'),
                        HOST_RUNNER=str(HOST), PRECHECK_STAGE='gate', PRECHECK_JOBS='2',
                        PRECHECK_TIMINGS=str(self.root / 'times.tsv'))
        self.env.pop('PRECHECK_RUNNER', None)
        # A check which must never run, even in the standalone path.
        (self.root / 'scripts/composer-check.mjs').write_text('not executable fixture')

    def tearDown(self):
        self.tmp.cleanup()

    def checks(self, codes, **extra):
        for i, code in enumerate(codes):
            (self.root / f'scripts/{i:02}-check.mjs').write_text(json.dumps(dict(rc=code, **extra)))

    def run_driver(self, runner=True, **env):
        runenv = dict(self.env, **env)
        if runner:
            runenv['PRECHECK_RUNNER'] = str(self.root / 'runner.py')
        start = time.monotonic()
        result = subprocess.run(['sh', 'scripts/test.sh'], cwd=self.root, env=runenv,
                                capture_output=True, text=True, timeout=30)
        elapsed = time.monotonic() - start
        events = sorted(json.loads(line) for line in (self.root / 'events').read_text().splitlines())
        active = {}; peak = 0
        for _, kind, name, lease in events:
            if kind == 'start':
                active[name] = lease
                if runner:
                    self.assertIsNotNone(lease)
                    self.assertEqual(len(set(active.values())), len(active))
                peak = max(peak, len(active))
            else:
                del active[name]
        self.assertFalse(active, 'all workers must finish before return')
        self.assertEqual(list((self.root / 'tmp').iterdir()), [], 'driver cleans its own temp directory')
        rows = [r.split('\t') for r in (self.root / 'times.tsv').read_text().splitlines()] if (self.root / 'times.tsv').exists() else []
        self.assertTrue(all(float(r[2]) >= 0 for r in rows))
        return result, elapsed, peak, rows

    def reset_observations(self):
        for name in ('events', 'times.tsv'):
            (self.root / name).write_text('')

    def test_identical_fixture_gain(self):
        self.checks([0] * 8, sleep=.35)
        serial, before, peak1, rows1 = self.run_driver(PRECHECK_JOBS='1')
        self.reset_observations()
        bounded, after, peak2, rows2 = self.run_driver(PRECHECK_JOBS='2')
        self.assertEqual(serial.returncode, 0, serial.stdout + serial.stderr)
        self.assertEqual(bounded.returncode, 0, bounded.stdout + bounded.stderr)
        self.assertEqual(serial.stdout, bounded.stdout)
        self.assertEqual((peak1, peak2), (1, 2))
        self.assertEqual((len(rows1), len(rows2)), (8, 8))
        self.assertTrue(all(len(r) == 4 for r in rows1 + rows2))
        self.assertLess(after, before * .85, 'retain only a meaningful measured gain')
        print(f'FIXTURE serial={before:.3f}s peak={peak1}; bounded={after:.3f}s peak={peak2}; gain={100*(1-after/before):.1f}%', flush=True)

    def test_pass_skip_failure_and_stable_diagnostics(self):
        self.checks([0, 3, 7, 0])
        result, _, peak, rows = self.run_driver()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(peak, 2)
        text = result.stdout
        markers = ['PASS  00-check', 'SKIP  01-check: unavailable', 'FAIL  02-check', 'PASS  03-check']
        self.assertEqual([text.index(m) for m in markers], sorted(text.index(m) for m in markers))
        self.assertIn('fixture diagnostic', text)
        self.assertIn('2 of 3 UI checks pass', text)
        self.assertEqual(sorted(r[1] for r in rows), ['0', '0', '3', '7'])

    def test_no_runner_is_serial_even_when_two_requested(self):
        self.checks([0, 3, 0])
        result, _, peak, rows = self.run_driver(runner=False)
        self.assertEqual((result.returncode, peak, len(rows)), (0, 1, 3))
        self.assertTrue(all(len(r) == 3 for r in rows))

    def test_missing_worker_status_fails_and_waits(self):
        self.checks([0, 0])
        (self.root / 'scripts/00-check.mjs').write_text(json.dumps(dict(rc=0, kill_worker=True, sleep=.1)))
        result, _, peak, _ = self.run_driver()
        self.assertEqual(peak, 2)
        self.assertEqual(result.returncode, 1)
        self.assertIn('PASS  01-check', result.stdout)
        self.assertIn('FAIL  UI check worker', result.stdout)
        self.assertIn('missing worker status', result.stdout)

    def test_rust_and_build_failures_remain_failures(self):
        self.checks([0])
        for env in ({'CORE_RC': '1'}, {'BUILD_RC': '1'}):
            self.reset_observations()
            result, _, _, _ = self.run_driver(runner=False, **env)
            self.assertEqual(result.returncode, 1)
            self.assertIn('core diagnostic' if 'CORE_RC' in env else 'build diagnostic', result.stdout)
            self.assertIn('1 of 1 UI checks pass', result.stdout)

    def test_pressure_serializes(self):
        self.checks([0, 0])
        result, _, peak, _ = self.run_driver(FIXTURE_PRESSURE='2')
        self.assertEqual((result.returncode, peak), (0, 1))

    def test_inherited_lease_serializes(self):
        self.checks([0, 0])
        with patch.object(resources, 'ROOT', self.root / 'leases'), patch.dict(os.environ, self.env):
            with resources.lease('heavy', priority=True):
                result, _, peak, _ = self.run_driver(E2A2O_LEASES=os.environ['E2A2O_LEASES'])
        self.assertEqual((result.returncode, peak), (0, 1))

    def test_only_one_global_slot_free(self):
        self.checks([0, 0, 0])
        with patch.object(resources, 'ROOT', self.root / 'leases'), patch.dict(os.environ, self.env):
            with resources.lease('heavy', priority=True):
                # The fixture driver cannot borrow this unrelated holder's lease.
                result, _, peak, _ = self.run_driver()
        self.assertEqual((result.returncode, peak), (0, 1))


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0], *REST])
