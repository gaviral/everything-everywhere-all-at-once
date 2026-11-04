"""Scan tracked working/index files and all locally reachable Git objects. No secret values are printed.

Run: python3 scripts/secret-scan.py
Findings contain only a rule, object ID and line/entry number. Resolve IDs locally with Git.
Includes deleted/binary blobs, commit messages, annotated tags and historical .env names.
Templates (.env.example, .env.sample, .env.template) are allowed by name, but still scanned.
This is a pattern guard, not a guarantee that arbitrary credentials can be recognized.
"""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys


RULES = {
    "legacy-api-key": r"\b(?:sk|pk|key)-[A-Za-z0-9_-]{20,}",
    "github-token": r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b",
    "aws-access-key": r"\b(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{16}\b",
    "google-api-key": r"\bAIza[A-Za-z0-9_-]{35}\b",
    "slack-token": r"\bxox[baprs]-[A-Za-z0-9-]{10,}",
    "stripe-key": r"\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}",
    "provider-token": r"\b(?:glpat-|hf_|npm_|pypi-|SG\.)[A-Za-z0-9_.-]{20,}",
    "private-key": r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|PuTTY-User-Key-File-[23]:",
    "authorization": r"\b(?:Bearer|Basic)\s+[A-Za-z0-9_./+=-]{16,}",
    "credential-url": r"\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@",
}
PATTERNS = {name: re.compile(pattern) for name, pattern in RULES.items()}
# JSON/YAML, shell/.env, Python, Rust and JS credential assignments. Bare values are
# longer to avoid treating ordinary variable references as credentials. Generic
# key/token assignments need 16 characters, even when quoted; passwords and
# secrets still accept shorter literals. Provider-specific rules above apply at
# any location independently of this heuristic.
NAME = re.compile(r"(?:^|[_-])(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|secret|client[_-]?secret|private[_-]?key|password|passwd|pwd|token|auth[_-]?token)(?:$|[_-])", re.I)
SHORT_SECRET = re.compile(r"(?:^|[_-])(?:secret|password|passwd|pwd)(?:$|[_-])", re.I)
ASSIGNMENT = re.compile(
    r"\b([a-z][a-z0-9_-]{0,127})['\"]?\s*[:=]\s*(?:['\"]([^'\"\r\n]{8,})['\"]|([A-Za-z0-9_./+=!@#$%^&*~-]{16,}))", re.I
)
PLACEHOLDER = re.compile(
    r"^(?:your[-_ ].*|replace[-_ ].*|example(?:[-_ ].*)?|placeholder|changeme|change[-_]me|"
    r"dummy(?:[-_].*)?|fake(?:[-_].*)?|test[-_]?(?:key|token|password|secret)|"
    r"insert[-_].*|paste[-_].*|<[^>]*>|\$.*|\{.*|x{4,}|\*{4,})$", re.I
)
TEMPLATES = {b".env.example", b".env.sample", b".env.template"}


def private_env(name):
    name = name.lower()
    return (name == b".env" or name.startswith(b".env.")) and name not in TEMPLATES


def findings(data):
    text = data.decode("utf-8", errors="replace")
    found = set()
    for name, pattern in PATTERNS.items():
        for match in pattern.finditer(text):
            found.add((name, text.count("\n", 0, match.start()) + 1))
    for match in ASSIGNMENT.finditer(text):
        if not NAME.search(match.group(1)):
            continue
        value = match.group(2) or match.group(3)
        if len(value) < 16 and not SHORT_SECRET.search(match.group(1)):
            continue
        # References and explanatory prose are not literal credentials.
        if PLACEHOLDER.fullmatch(value) or re.search(r"\$\{|process\.env\.|std::env|os\.environ", value):
            continue
        found.add(("credential-assignment", text.count("\n", 0, match.start()) + 1))
    return sorted(found)


def git(*args):
    return subprocess.check_output(
        ["git", "--no-replace-objects", *args], stderr=subprocess.DEVNULL,
        env={**os.environ, "GIT_NO_LAZY_FETCH": "1"},
    )


def scan():
    if git("rev-parse", "--is-shallow-repository").strip() != b"false":
        raise RuntimeError("incomplete history")
    object_format = git("rev-parse", "--show-object-format").decode().strip()
    oid_bytes = hashlib.new(object_format).digest_size
    seen = set()
    count = 0

    def report(rule, location, line):
        nonlocal count
        key = (rule, location, line)
        if key not in seen:
            seen.add(key)
            count += 1
            print(f"FAIL  {rule}: {location}, line/entry {line} (redacted)")

    # Worktree bytes matter too: edits need not have been staged yet. Symlinks are
    # scanned as Git stores them; do not follow a link outside the checkout.
    for raw_path in git("ls-files", "--cached", "-z").split(b"\0"):
        if not raw_path:
            continue
        path = Path(os.fsdecode(raw_path))
        if path.is_symlink():
            data = os.fsencode(os.readlink(path))
        elif path.is_dir():  # Submodules are separate repositories.
            continue
        elif not path.exists():  # Deletions are covered by reachable blobs below.
            continue
        else:
            data = path.read_bytes()
        oid = hashlib.new(object_format, b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        location = f"blob {oid}"
        if private_env(raw_path.rsplit(b"/", 1)[-1]):
            report("private-env-file", location, 1)
        for rule, line in findings(data):
            report(rule, location, line)

    # Unlike log -p, this includes binary files and messages on annotated tags,
    # and never loses the second command's failure in a shell pipeline.
    oids = git("rev-list", "--objects", "--no-object-names", "--all", "HEAD").splitlines()
    # The index can differ from both HEAD and the worktree. Inspect staged blobs
    # too, including files staged and then removed or edited again locally.
    staged = []
    for entry in git("ls-files", "--stage", "-z").split(b"\0"):
        if not entry:
            continue
        metadata, path = entry.split(b"\t", 1)
        mode, oid, _ = metadata.split()
        if mode == b"160000":  # Submodule contents belong to another repository.
            continue
        staged.append(oid)
        if private_env(path.rsplit(b"/", 1)[-1]):
            report("private-env-file", f"blob {oid.decode('ascii')}", 1)
    reachable_count = len(oids)
    oids = list(dict.fromkeys(oids + staged))
    with subprocess.Popen(
        ["git", "--no-replace-objects", "cat-file", "--batch"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env={**os.environ, "GIT_NO_LAZY_FETCH": "1"},
    ) as batch:
        try:
            for oid in oids:
                batch.stdin.write(oid + b"\n")
                batch.stdin.flush()
                header = batch.stdout.readline().split()
                if len(header) != 3 or header[0] != oid:
                    raise RuntimeError("unreadable git object")
                kind = header[1].decode("ascii")
                data = batch.stdout.read(int(header[2]))
                if len(data) != int(header[2]) or batch.stdout.read(1) != b"\n":
                    raise RuntimeError("incomplete git object")
                location = f"{kind} {oid.decode('ascii')}"
                if kind == "tree":
                    at, entry = 0, 0
                    while at < len(data):
                        end = data.index(b"\0", at)
                        name = data[at:end].split(b" ", 1)[1]
                        entry += 1
                        if private_env(name):
                            report("private-env-file", location, entry)
                        for rule, _ in findings(name):
                            report(rule, location, entry)
                        at = end + 1 + oid_bytes
                elif kind in ("blob", "commit", "tag"):
                    for rule, line in findings(data):
                        report(rule, location, line)
                else:
                    raise RuntimeError("unexpected git object type")
        except BaseException:
            batch.kill()
            raise
        finally:
            batch.stdin.close()
        if batch.wait() != 0:
            raise RuntimeError("git object scan failed")
    print(f"{'FAIL' if count else 'PASS'}  secret scan: {count} redacted findings; working/index files and {reachable_count} reachable objects scanned")
    return 1 if count else 0


if __name__ == "__main__":
    try:
        sys.exit(scan())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        # Never echo subprocess output, exception text, paths or scanned bytes.
        print("FAIL  secret scan incomplete: cannot read tracked files or complete reachable git history (details redacted)")
        sys.exit(1)
