"""Offline release safety regressions: python3 scripts/release-safety-test.py.

All Git and release fixtures live in temporary directories inside this worktree.
Release tests replace network/publication tools with local stubs.
"""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("secret_scan", ROOT / "scripts/secret-scan.py")
SCAN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCAN)


class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix=".release-test-", dir=ROOT)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def run_cmd(self, *args, env=None):
        return subprocess.run(args, cwd=self.root, env={**os.environ, **(env or {})},
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def git(self, *args):
        result = self.run_cmd("git", *args)
        self.assertEqual(result.returncode, 0, "fixture Git command failed")
        return result.stdout.strip()

    def write(self, name, data, executable=False):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data)
        if executable:
            path.chmod(0o755)

    def scan(self):
        return self.run_cmd("python3", str(ROOT / "scripts/secret-scan.py"))

    def init_repo(self):
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@users.noreply.github.com")
        self.write("README", "safe\n")
        self.git("add", ".")
        self.git("commit", "-qm", "Initial")

    def test_credential_families_and_placeholders(self):
        values = [
            "sk-" + "a1" * 16, "ghp_" + "a1" * 20,
            "github_pat_" + "a1_" * 20, "AKIA" + "A1" * 8,
            "AIza" + "a" * 35, "xoxb-" + "12345-" * 5,
            "sk_live_" + "a1" * 16, "glpat-" + "a1" * 16,
            "hf_" + "a1" * 16, "npm_" + "a1" * 16,
            "-----BEGIN " + "OPENSSH PRIVATE KEY-----",
            "Bearer " + "a1" * 16, "Basic " + "a1" * 16,
            "postgres://owner:" + "s3cr3t" + "@localhost/db",
            'AWS_SECRET_ACCESS_KEY="' + "a1/+" * 10 + '"',
            '"client_secret": "' + "a1" * 16 + '"',
            'password="' + "s3cr3t!a" + '"',
            'password="' + "a secret passphrase with spaces" + '"',
        ]
        for value in values:
            self.assertTrue(SCAN.findings(value.encode()), "credential family was missed")
        for value in ('MODEL_API_KEY=', 'API_KEY="your-api-key"', 'TOKEN="${API_TOKEN}"',
                      'api_key = "process.env.API_KEY"', 'password="changeme"'):
            self.assertFalse(SCAN.findings(value.encode()))
        for name in (b".env", b".env.local", b".env.production", b".env.test.local"):
            self.assertTrue(SCAN.private_env(name))
        for name in SCAN.TEMPLATES:
            self.assertFalse(SCAN.private_env(name))

    def test_worktree_history_binary_messages_tags_and_refs_are_redacted(self):
        self.init_repo()
        token = "ghp_" + "B7" * 20
        self.write("removed.bin", "\0" + token)
        self.write("nested/.env.production", "SAFE=1\n")
        self.git("add", ".")
        self.git("commit", "-qm", "Historical fixture")
        self.git("rm", "-qr", "removed.bin", "nested")
        self.git("commit", "-qm", "Remove fixture")
        self.git("tag", "-a", "fixture-tag", "-m", token)
        self.git("branch", "fixture-side")
        self.git("checkout", "-q", "fixture-side")
        self.git("commit", "--allow-empty", "-qm", token)
        self.git("checkout", "-q", "-")
        self.write("README", 'password="' + "s3cr3t!a" + '"\n')
        result = self.scan()
        self.assertEqual(result.returncode, 1)
        for kind in ("blob", "tree", "commit", "tag"):
            self.assertIn(f": {kind} ", result.stdout)
        self.assertIn("private-env-file", result.stdout)
        self.assertIn("credential-assignment", result.stdout)
        for private in (token, "s3cr3t!a", "removed.bin", ".env.production"):
            self.assertNotIn(private, result.stdout)

    def test_staged_secret_is_found_after_worktree_is_cleaned(self):
        self.init_repo()
        token = "github_" + "pat_" + "Q2_" * 20
        self.write("staged.txt", token)
        self.git("add", "staged.txt")
        self.write("staged.txt", "safe now\n")
        result = self.scan()
        self.assertEqual(result.returncode, 1)
        self.assertIn("github-token", result.stdout)
        self.assertNotIn(token, result.stdout)

    def test_templates_are_scanned_and_git_errors_fail_closed(self):
        self.init_repo()
        self.write(".env.example", "API_KEY=\n")
        self.git("add", ".env.example")
        self.assertEqual(self.scan().returncode, 0)
        self.write(".env.example", "TOKEN=" + "z8" * 16)
        self.assertEqual(self.scan().returncode, 1)
        self.git("reset", "-q", "HEAD", "--", ".env.example")
        self.assertEqual(self.scan().returncode, 0)
        self.write(".git/shallow", self.git("rev-parse", "HEAD") + "\n")
        result = self.scan()
        self.assertEqual(result.returncode, 1)
        self.assertIn("incomplete", result.stdout)
        (self.root / ".git/shallow").unlink()
        # Missing reachable objects and incomplete history cannot pass silently.
        oid = self.git("rev-parse", "HEAD:README")
        (self.root / ".git/objects" / oid[:2] / oid[2:]).unlink()
        self.assertEqual(self.scan().returncode, 1)

    def release_fixture(self):
        self.write("scripts/release.sh", (ROOT / "scripts/release.sh").read_text())
        self.write("scripts/precheck.sh", '''#!/bin/sh
[ "$PRECHECK_PAGES" = all ] && [ "$PRECHECK_STRICT" = 1 ] || exit 98
echo 'PASS  full precheck selected'
exit "${FIXTURE_PRECHECK_RC:-0}"
''')
        self.write("scripts/health-words.pl", "while (<STDIN>) {}\n")
        self.write("README.md", "Ready\n")
        self.write("LICENSE", "MIT\nCopyright Fixture\n")
        for directory in ("ui/node_modules", "ui/src", "core"):
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        self.write("bin/git", '''#!/bin/sh
case "$1" in
remote) echo https://github.com/fixture/repo.git ;;
fetch|status|ls-remote) ;;
rev-parse) echo 1234567 ;;
log) case "$2" in *%ae*) echo fixture@users.noreply.github.com ;; esac ;;
*) exit 99 ;;
esac
''', True)
        self.write("bin/curl", "#!/bin/sh\nprintf 200\n", True)
        self.write("bin/gh", '#!/bin/sh\n[ "$1 $2" = "repo view" ] || exit 99\necho PRIVATE\n', True)
        self.write("bin/ffprobe", '#!/bin/sh\necho "${FIXTURE_DURATION:-120}"\n', True)
        return {"PATH": str(self.root / "bin") + os.pathsep + os.environ["PATH"],
                "VIDEO_FILE": "fixture.mp4", "VIDEO_URL": "https://fixture.test/demo"}

    def test_release_forces_full_precheck_and_requires_both_video_inputs(self):
        env = self.release_fixture()
        for mode in ("only", "0"):
            result = self.run_cmd("sh", "scripts/release.sh", env={**env, "PRECHECK_PAGES": mode, "PRECHECK_STRICT": "0"})
            self.assertEqual(result.returncode, 0, result.stdout)
        for overrides, expected in (({"VIDEO_FILE": ""}, "set VIDEO_FILE"),
                                    ({"VIDEO_URL": ""}, "set VIDEO_URL"),
                                    ({"FIXTURE_DURATION": "181"}, "3:00 at most"),
                                    ({"FIXTURE_PRECHECK_RC": "1"}, "precheck fails")):
            result = self.run_cmd("sh", "scripts/release.sh", env={**env, **overrides})
            self.assertEqual(result.returncode, 1, result.stdout)
            self.assertIn(expected, result.stdout)
            self.assertNotIn("OK: ready", result.stdout)

    def test_strict_precheck_rejects_skips_missing_dependencies_and_stale_status(self):
        self.write("scripts/precheck.sh", (ROOT / "scripts/precheck.sh").read_text())
        self.write("scripts/browser-check.mjs", 'import "./headless.mjs";\n')
        self.write("bin/node", '#!/bin/sh\nexit "${FIXTURE_NODE_RC:-3}"\n', True)
        env = {"PATH": str(self.root / "bin") + os.pathsep + os.environ["PATH"],
               "PRECHECK_PAGES": "only", "PRECHECK_STRICT": "1", "PRECHECK_LOGS": str(self.root / "logs")}
        self.assertEqual(self.run_cmd("sh", "scripts/precheck.sh", env=env).returncode, 1)
        (self.root / "ui/node_modules").mkdir(parents=True)
        self.assertEqual(self.run_cmd("sh", "scripts/precheck.sh", env=env).returncode, 1)
        self.assertEqual(self.run_cmd("sh", "scripts/precheck.sh", env={**env, "PRECHECK_STRICT": "0"}).returncode, 0)
        self.assertEqual(self.run_cmd("sh", "scripts/precheck.sh", env={**env, "FIXTURE_NODE_RC": "0"}).returncode, 0)
        self.write("bin/node", "#!/bin/sh\nkill -TERM \"$PPID\"\n", True)
        self.assertEqual(self.run_cmd("sh", "scripts/precheck.sh", env=env).returncode, 1)


if __name__ == "__main__":
    unittest.main()
