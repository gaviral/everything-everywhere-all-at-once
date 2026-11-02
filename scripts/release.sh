#!/bin/sh
# The public-repo gate. The hackathon needs a public repo, and making it public is a one-way door: whatever a stranger
# clones in the first minute stays out there. So every check runs on exactly what GitHub has, and the script changes
# nothing unless it's run with --publish and the repo's name, the same retype GitHub's own dialog asks for.
#   sh scripts/release.sh                                  check only; safe any time
#   VIDEO_FILE=demo.mp4 VIDEO_URL=https://... sh scripts/release.sh     also the demo video (3:00 at most, opens logged out)
#   ACCEPT_COMMITS="355cc7d" sh scripts/release.sh         commits whose message paths the owner chose to keep
#   sh scripts/release.sh --publish OWNER/REPO             check, make public, confirm it opens logged out
# FAIL lines block --publish; WARN lines are for the owner to read first.
set -u
cd "$(dirname "$0")/.." || exit 1
failed=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; failed=1; }
warn() { echo "WARN  $1"; }
indent() { sed 's/^/        /'; }
# Logged out: curl sends no cookie or token, so it sees what a judge without a GitHub account sees.
status() { curl -s -o /dev/null -L --max-time 15 -w '%{http_code}' "$1"; }

publish=""
case "${1:-}" in
  "") ;;
  --publish) publish=${2:-}; [ -n "$publish" ] || { echo "Usage: sh scripts/release.sh --publish OWNER/REPO" >&2; exit 2; } ;;
  -h|--help|help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "Unknown option: $1 (try sh scripts/release.sh --help)" >&2; exit 2 ;;
esac

repo=$(git remote get-url origin 2>/dev/null | sed -E 's#^(https://github\.com/|git@github\.com:)##; s#\.git$##')
case "$repo" in */*) ;; *) echo "FAIL  origin isn't a GitHub repo ($repo)"; exit 1 ;; esac
url="https://github.com/$repo"
echo "Release gate for $repo"
[ -z "$publish" ] || [ "$publish" = "$repo" ] || { echo "FAIL  --publish $publish doesn't match this repo ($repo); nothing changed"; exit 1; }

# 1. The checks run on what goes public: GitHub's main, checked out here, with nothing uncommitted on top.
if git fetch --quiet origin main 2>/dev/null; then
  if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then pass "this checkout is GitHub's main ($(git rev-parse --short HEAD))"
  else fail "this checkout ($(git rev-parse --short HEAD), $(git branch --show-current)) isn't GitHub's main ($(git rev-parse --short origin/main)): push main, then run this on it"; fi
else fail "can't fetch origin's main (network or sign-in)"; fi
[ -z "$(git status --porcelain)" ] && pass "nothing uncommitted" || fail "uncommitted changes: commit or stash them; the checks must match what's pushed"

# 2. Everything precheck holds (keys, paths, Meta-only models, tests, claims, links inside the repo).
pre=$(sh scripts/precheck.sh 2>&1); pre_status=$?
if [ $pre_status = 0 ]; then pass "precheck passes"; else fail "precheck fails:"; echo "$pre" | grep '^FAIL' | indent; fi
echo "$pre" | grep '^WARN' | indent

# 3. A license, or GitHub shows "No license" and nobody may legally reuse the code.
if [ -f LICENSE ]; then pass "LICENSE: $(head -1 LICENSE), $(grep -m1 -i 'copyright' LICENSE)"; else fail "no LICENSE file"; fi

# 4. History goes public with the repo: no commit message or identity may carry a local path or a private address.
ref=origin/main; git rev-parse -q --verify "$ref" >/dev/null || ref=HEAD
paths='/Users/[A-Za-z]|/home/[A-Za-z]|/private/(tmp|var)|/var/folders|/tmp/claude|/code/(e2a2o|e2a2o|canvas)'
leaks=$(git log --format='@@ %h%n%B' "$ref" | awk -v re="$paths" '/^@@ /{h=$2; next} $0 ~ re && !seen[h]++ {print h}')
blocked=""; accepted=""
for h in $leaks; do
  case " ${ACCEPT_COMMITS:-} " in *" $h "*) accepted="$accepted $h" ;; *) blocked="$blocked $h" ;; esac
done
if [ -z "$blocked" ]; then pass "no commit message on $ref names a local path${accepted:+ (but the kept ones below)}"
else
  fail "commit messages on $ref name local paths (reword them before public, or list them in ACCEPT_COMMITS):"
  for h in $blocked; do echo "$h $(git log -1 --format=%s "$h" | cut -c1-110)" | indent; done
fi
[ -z "$accepted" ] || warn "kept by choice (ACCEPT_COMMITS):$accepted"
others=$(git log --format='%ae%n%ce' "$ref" | sort -u | grep -v '@users\.noreply\.github\.com$')
[ -z "$others" ] && pass "every author and committer address is a GitHub noreply one" || { fail "commits carry these addresses:"; echo "$others" | indent; }

# 5. Every branch and tag on GitHub goes public too, not only main.
refs=$(git ls-remote --heads --tags origin 2>/dev/null | awk '{print $2}' | grep -vx 'refs/heads/main')
[ -z "$refs" ] && pass "GitHub holds only main" || { warn "these go public with main (delete or keep, by choice):"; echo "$refs" | indent; }

# 6. Web links in the README open for a logged-out visitor (links inside the repo: precheck's links-check).
# Links only ([text](https://...), href= and src=): an address in a code block is something to type, not to click.
for link in $(grep -oE '\]\(https?://[^) ]+|(href|src)="https?://[^"]+' README.md | sed -E 's/^(\]\(|href="|src=")//' | sort -u); do
  case "$link" in "$url"|"$url"/*|"$url".git) continue ;; esac   # the repo itself: checked after it's public
  code=$(status "$link")
  case "$code" in 2*|3*) pass "README link opens: $link" ;; *) fail "README link answers $code: $link" ;; esac
done

# 7. The demo video: the form wants a working link, 3:00 at most.
if [ -n "${VIDEO_FILE:-}" ]; then
  seconds=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO_FILE" 2>/dev/null)
  if [ -z "$seconds" ]; then fail "can't read $VIDEO_FILE's length (ffprobe)"
  elif awk -v s="$seconds" 'BEGIN { exit !(s <= 180) }'; then pass "video is ${seconds%.*} s (180 at most)"
  else fail "video is ${seconds%.*} s; the rule is 3:00 at most"; fi
else warn "video length not checked: set VIDEO_FILE"; fi
if [ -n "${VIDEO_URL:-}" ]; then
  case "$VIDEO_URL" in
    # YouTube answers 200 even for a private video; its oEmbed answers 200 only for public and unlisted ones.
    *youtube.com/*|*youtu.be/*) code=$(status "https://www.youtube.com/oembed?format=json&url=$VIDEO_URL") ;;
    *) code=$(status "$VIDEO_URL") ;;
  esac
  [ "$code" = 200 ] && pass "video opens logged out" || fail "video answers $code logged out (private, or a wrong link?)"
else warn "video link not checked: set VIDEO_URL"; fi

# 8. Where the repo stands now.
visibility=$(gh repo view "$repo" --json visibility -q .visibility 2>/dev/null || echo "unknown (gh not signed in?)")
echo "INFO  $repo is $visibility; logged out, $url answers $(status "$url")"

if [ -z "$publish" ]; then
  echo
  [ $failed = 0 ] && echo "OK: ready to go public." || echo "Fix the FAIL lines first."
  echo "To go public (one-way; clones made meanwhile stay):"
  echo "  gh repo edit $repo --visibility public --accept-visibility-change-consequences"
  echo "  curl -s -o /dev/null -w '%{http_code}' $url    # 200 once public, logged out"
  echo "or both, after these checks: sh scripts/release.sh --publish $repo"
  exit $failed
fi

[ $failed = 0 ] || { echo "Not publishing: fix the FAIL lines first. Nothing changed."; exit 1; }
gh repo edit "$repo" --visibility public --accept-visibility-change-consequences || { echo "FAIL  gh repo edit failed"; exit 1; }
# GitHub usually serves the page at once; give it 30 s before calling it a failure.
for _ in 1 2 3 4 5 6; do [ "$(status "$url")" = 200 ] && break; sleep 5; done
[ "$(status "$url")" = 200 ] || { echo "FAIL  $url doesn't answer 200 logged out yet; check it by hand"; exit 1; }
echo "PASS  $url opens logged out"
# The first public run of the tests, so the Actions tab shows them passing rather than nothing.
gh workflow run ci.yml --repo "$repo" --ref main >/dev/null 2>&1 && echo "INFO  CI started: $url/actions" || warn "couldn't start CI; run: gh workflow run ci.yml --ref main"
