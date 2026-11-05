"""Zero-token guards on the app's model calls, run by precheck.sh (and so by every push).
meta-only: this project's runtime policy: every model the project calls at runtime must be a Meta model.
  The event requires meaningful Meta use; this guard enforces the project's stricter Meta-only choice.
  Fails when the app's code names a non-Meta model SDK, a non-Meta model endpoint or a non-Meta model, or
  when the core or the UI talks to any outside host but Meta's API. Coding tools used while building are allowed and
  aren't checked here; names of other chat apps (an import reads ChatGPT and Claude exports) are words, not calls.
counted: every model call counts toward the core's hourly cap (model.rs CALLS_PER_HOUR): only `call_model_noting`
  (which `call_model` wraps) and `ask_model` send the key, and both spend first. Voice Transcribe is left out on
  purpose (model.rs `listening_key`).
  python3 scripts/model-guards.py meta-only   # this repo's tracked files
  python3 scripts/model-guards.py counted
  python3 scripts/model-guards.py self-test   # plants each kind of breach and checks it's caught
"""
import json
import re
import subprocess
import sys

# Packages that call a model service other than Meta's (Rust crates and npm packages), matched on the whole name.
SDK = re.compile(
    r"^(async-openai|openai(-.*)?|@openai/.*|anthropic(-.*)?|async-anthropic|@anthropic-ai/.*|claude-.*"
    r"|@google/(generative-ai|genai)|@google-cloud/(vertexai|aiplatform)|google-generativeai|gemini-.*"
    r"|mistralai|@mistralai/.*|cohere(-.*)?|groq(-sdk)?|@ai-sdk/.*|ai|replicate|together-ai"
    r"|langchain(-.*)?|@langchain/.*|ollama(-rs|-js)?|@huggingface/inference|elevenlabs(-.*)?|@deepgram/.*"
    r"|deepgram(-.*)?|assemblyai|genai|llm|llm-chain|rig-core|openrouter(-.*)?|@openrouter/.*)$"
)
# Model APIs other than Meta's, anywhere in the app's own code.
HOSTS = re.compile(
    r"api\.openai\.com|openai\.azure\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com"
    r"|aiplatform\.googleapis\.com|api\.mistral\.ai|api\.cohere\.(ai|com)|api\.groq\.com|api\.together\.(xyz|ai)"
    r"|openrouter\.ai|api\.deepseek\.com|api\.x\.ai|api\.perplexity\.ai|api\.replicate\.com"
    r"|api-inference\.huggingface\.co|router\.huggingface\.co|api\.elevenlabs\.io|api\.deepgram\.com"
    r"|api\.assemblyai\.com|api\.fireworks\.ai|bedrock-runtime|dashscope|api\.moonshot|api\.stability\.ai"
)
# Names of other makers' models, as an API would take them.
MODELS = re.compile(
    r"\b(gpt-[0-9a-z]|o[1-4]-(mini|preview|pro)|chatgpt-4o|claude-[0-9a-z]|gemini-[0-9a-z]|gemma|mistral-|mixtral"
    r"|codestral|command-r|qwen|deepseek|grok-[0-9]|phi-[0-9]|whisper-1|tts-1|text-embedding|dall-e"
    r"|stable-diffusion|sdxl|flux-[0-9a-z])",
    re.I,
)
URL = re.compile(r"\b(?:https?|wss?)://([A-Za-z0-9.-]+)")
META = "api.meta.ai"
# This machine, a laptop on the same network (a room), and the made-up sites the tests use.
LOCAL = re.compile(r"^(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.[0-9.]+|10\.[0-9.]+|[a-z0-9.-]+\.(localhost|test))$")

RUNTIME = ("core/src/", "ui/src/", "ui/index.html", "run.sh", ".env.example")
MANIFESTS = ("core/Cargo.toml", "core/Cargo.lock", "ui/package.json", "ui/package-lock.json")


def runtime_part(path, text):
    """The code that runs: a Rust file without its test-only items, no test files."""
    if path.endswith(("tests.rs", ".test.ts", ".test.tsx")):
        return ""
    return without_tests(text) if path.endswith(".rs") else text


TEST_GATE = "#[cfg(test)]"


def without_tests(text):
    """Blanks each item under #[cfg(test)] (a module, impl, fn, field or statement) and keeps the rest, newlines
    included so line numbers hold. Only that item goes: a test module declared near the top (main.rs `mod perf;`)
    or a test-only field (apps.rs) mustn't hide the runtime code after it."""
    out, at = [], 0
    while (gate := text.find(TEST_GATE, at)) >= 0:
        end = item_end(text, gate + len(TEST_GATE))
        out += [text[at:gate], re.sub(r"[^\n]", " ", text[gate:end])]
        at = end
    return "".join(out + [text[at:]])


def item_end(text, i):
    """Where the Rust item starting at i ends: its `;` or `,` outside brackets, or its closing brace (and a `;`
    right after). Strings, chars and comments are skipped so a brace inside one doesn't count. Generics aren't
    tracked, so a `,` inside `<..>` ends a field early: the rest is then scanned, which can only add findings."""
    depth, n = 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith("//", i):
            i = text.find("\n", i)
            i = n if i < 0 else i
            continue
        if text.startswith("/*", i):
            i = text.find("*/", i + 2)
            i = n if i < 0 else i + 2
            continue
        raw = re.match(r'b?r(#*)"', text[i:i + 12]) if c in "br" and (i == 0 or not (text[i - 1].isalnum() or text[i - 1] == "_")) else None
        if raw:
            close = '"' + raw.group(1)
            j = text.find(close, i + raw.end())
            i = n if j < 0 else j + len(close)
            continue
        if c == '"':
            i += 1
            while i < n and text[i] != '"':
                i += 2 if text[i] == "\\" else 1
            i += 1
            continue
        if c == "'":
            char = re.match(r"'(\\(x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^\\'])'", text[i:i + 12])
            i += char.end() if char else 1  # else a lifetime ('a)
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0 and c == "}":
                after = re.match(r"\s*;", text[i + 1:])
                return i + 1 + (after.end() if after else 0)
            if depth < 0:  # the item was the last in its block: stop before the block's close
                return i
        elif c in ";," and depth == 0:
            return i + 1
        i += 1
    return n


def packages(path, text):
    if path.endswith("Cargo.lock"):
        return re.findall(r'^name = "([^"]+)"', text, re.M)
    if path.endswith("Cargo.toml"):
        names = []
        for section, body in re.findall(r"^\[([^\]]+)\]\n(.*?)(?=^\[|\Z)", text, re.M | re.S):
            if "dependencies" in section:
                names += re.findall(r"^([A-Za-z0-9_-]+)\s*=", body, re.M)
        return names
    data = json.loads(text)
    if path.endswith("package-lock.json"):
        return [key.rsplit("node_modules/", 1)[-1] for key in data.get("packages", {}) if key]
    return [name for field in ("dependencies", "devDependencies", "optionalDependencies") for name in data.get(field, {})]


# A reviewed publication reference displayed only as an explicit reader-opened link.
# This permits one JSON data field, never an executable network-call site or another URL.
CITATION_PATH = "ui/src/features/research-walkthrough/evidence.json"
CITATION_URL = "https://www.microsoft.com/en-us/research/publication/data-mountain-using-spatial-memory-for-document-management/"


def citation_text(path, text):
    if path != CITATION_PATH:
        return text
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return text
    if isinstance(data, dict) and data.get("sourceUrl") == CITATION_URL:
        # Blank only the exact field value; all other fields keep the normal scan.
        return re.sub(r'("sourceUrl"\s*:\s*)"' + re.escape(CITATION_URL) + r'"',
                      lambda match: match[1] + '"reviewed-publication-link"', text)
    return text


def breaches(files):
    """files: {path: text}. Each breach as 'path:line: what'."""
    found = []
    for path, text in sorted(files.items()):
        if path in MANIFESTS:
            found += [f"{path}: {name} is a non-Meta model SDK" for name in packages(path, text) if SDK.match(name)]
            continue
        if not path.startswith(RUNTIME):
            continue
        code = runtime_part(path, citation_text(path, text))
        for n, line in enumerate(code.splitlines(), 1):
            if HOSTS.search(line):
                found.append(f"{path}:{n}: a non-Meta model API: {line.strip()[:120]}")
            if MODELS.search(line):
                found.append(f"{path}:{n}: a non-Meta model name: {line.strip()[:120]}")
            # The core and the UI talk to Meta's API and to nothing else outside this machine and its room.
            if path.startswith(("core/src/", "ui/src/")):
                for host in URL.findall(line):
                    if host != META and not LOCAL.match(host):
                        found.append(f"{path}:{n}: calls {host}, not {META}")
    return found


# Modules that only tests compile (main.rs and refiner.rs declare them under #[cfg(test)]).
TEST_ONLY = ("core/src/perf.rs", "core/src/refiner_live.rs")


def uncounted(files):
    """Model calls that could go out without counting toward the cap, as 'path:line: what'."""
    found = []
    for path, text in sorted(files.items()):
        if not (path.startswith("core/src/") and path.endswith(".rs")) or path in TEST_ONLY:
            continue
        lines = runtime_part(path, text).splitlines()
        if path == "core/src/model.rs":
            if sum("self.spend()?;" in line for line in lines) < 3:
                found.append(f"{path}: call_model_noting and ask_model (both of its sends) must spend before sending")
            continue
        for n, line in enumerate(lines, 1):
            # Outside model.rs, the key goes out only from inside an ask_model closure (placing, Explain).
            if ".bearer_auth(" in line and not any(".ask_model(" in above for above in lines[max(0, n - 13):n]):
                found.append(f"{path}:{n}: sends the key outside call_model or ask_model, so the cap can't count it")
    return found


def tracked():
    paths = subprocess.run(["git", "ls-files", "-z"], capture_output=True, text=True, check=True).stdout.split("\0")
    files = {}
    for path in paths:
        if path in MANIFESTS or path.startswith(RUNTIME):
            try:
                files[path] = open(path, encoding="utf-8").read()
            except (UnicodeDecodeError, FileNotFoundError):
                pass
    return files


def self_test():
    clean = {
        "core/src/explain.rs": 'const URL: &str = "https://api.meta.ai/v1/chat/completions";\n',
        "core/src/asr.rs": 'const URL: &str = "wss://api.meta.ai/v1/asr/realtime";\n',
        "core/src/main.rs": 'let s = "http://localhost:4321"; let t = "http://192.168.1.5:4321";\n#[cfg(test)]\nlet x = "https://evil.com";\n',
        "core/src/import.rs": '"assistant" | "chatgpt" | "gpt" | "claude" | "gemini" | "llama" | "muse" => false,\n// A ChatGPT or Claude export\n',
        "ui/src/Import.tsx": "<p>From ChatGPT: Settings › Data controls. From Claude: Settings › Privacy.</p>\n",
        "core/Cargo.toml": '[dependencies]\nreqwest = "0.12"\nserde = "1"\n',
        "core/Cargo.lock": 'name = "matchers"\nname = "reqwest"\n',
        "ui/package.json": '{"dependencies": {"react": "^19"}, "devDependencies": {"vite": "^7"}}',
        "ui/package-lock.json": '{"packages": {"": {}, "node_modules/react": {}, "node_modules/@vitejs/plugin-react": {}}}',
        "README.md": "Calls api.openai.com? No: README text isn't code.\n",
    }
    assert breaches(clean) == [], breaches(clean)
    citation = json.dumps({"sourceUrl": CITATION_URL})
    assert breaches({CITATION_PATH: citation}) == [], "reviewed reader-opened citation"
    assert breaches({CITATION_PATH: json.dumps({"sourceUrl": "https://other.test.evil/paper"})}), "changed citation stays guarded"
    assert breaches({CITATION_PATH: json.dumps({"sourceUrl": CITATION_URL, "endpoint": "https://other.test.evil/api"})}), "other fields stay guarded"
    assert breaches({"ui/src/citation.ts": 'fetch("' + CITATION_URL + '")'}), "executable calls stay guarded"
    assert breaches({"ui/src/other.json": citation}), "other files stay guarded"
    planted = {
        "core/src/placer.rs": 'const URL: &str = "https://api.openai.com/v1/chat/completions";\n',
        "core/src/refiner.rs": '"model": "gpt-4o-mini",\n',
        "core/src/recap.rs": 'Setting::from_env("RECAP_MODEL", "claude-sonnet-4")\n',
        "core/src/find.rs": 'const URL: &str = "https://api.some-new-llm.com/v1/chat";\n',
        "ui/src/core.ts": 'fetch("https://generativelanguage.googleapis.com/v1beta/models")\n',
        ".env.example": "# PLACER_MODEL=gemini-2.5-flash\n",
        "core/Cargo.toml": '[dependencies]\nasync-openai = "0.28"\n',
        "core/Cargo.lock": 'name = "async-openai"\n',
        "ui/package.json": '{"dependencies": {"@anthropic-ai/sdk": "^0.50"}}',
        "ui/package-lock.json": '{"packages": {"node_modules/ai": {}, "node_modules/@ai-sdk/openai": {}}}',
    }
    for path, text in planted.items():
        assert breaches({path: text}), f"missed a planted breach in {path}"
    # Runtime code after a test-only module or field is still scanned (main.rs declares `mod perf` near the top,
    # apps.rs gates a field of its Runtime): only the gated item is left out.
    after_tests = {
        "core/src/main.rs": '#[cfg(test)]\nmod perf;\n\nfn main() {\n    let placer = Setting::from_env("PLACER_MODEL", "gpt-4o");\n}\n',
        "core/src/apps.rs": "pub struct Runtime {\n    #[cfg(test)]\n    answers: Mutex<VecDeque<Value>>,\n}\n"
        'const URL: &str = "https://api.openai.com/v1/chat/completions";\n',
    }
    for path, text in after_tests.items():
        assert breaches({path: text}), f"missed a breach after a test-only item in {path}"
    gated = (
        '#[cfg(test)]\nfn stand_in() { let close = "}"; let brace = \'{\'; let s = r#"x}"#; /* } */ let m = "gpt-4o"; }\n'
        '#[cfg(test)]\nmod tests {\n    const URL: &str = "https://evil.com";\n}\n'
        "fn model(core: &Core) {\n    #[cfg(test)]\n    if let Some(a) = core.answers.pop() { return a; }\n"
        '    core.call_model("https://api.meta.ai/v1/chat/completions");\n}\n'
    )
    assert breaches({"core/src/apps.rs": gated}) == [], breaches({"core/src/apps.rs": gated})
    assert runtime_part("core/src/apps.rs", gated).count("\n") == gated.count("\n"), "line numbers hold"
    model = "pub async fn call_model() {\n    self.spend()?;\n}\nfn ask_model() {\n    self.spend()?;\n    self.spend()?;\n}\n"
    inside = "let r = core\n    .ask_model(&setting, |model| {\n        core.http.post(URL).bearer_auth(key).send()\n    })\n"
    counted_clean = {"core/src/model.rs": model, "core/src/placer.rs": inside, "core/src/refiner_live.rs": "http.post(URL).bearer_auth(key)\n"}
    assert uncounted(counted_clean) == [], uncounted(counted_clean)
    assert uncounted({"core/src/apps.rs": "core.http.post(URL).bearer_auth(key).json(&body).send()\n"}), "missed a direct send"
    late_send = "struct Runtime {\n    #[cfg(test)]\n    asked: Mutex<Vec<String>>,\n}\nfn model() {\n    core.http.post(URL).bearer_auth(key).send()\n}\n"
    assert uncounted({"core/src/apps.rs": late_send}) == ["core/src/apps.rs:6: sends the key outside call_model or ask_model, so the cap can't count it"], "missed a send after a test-only field"
    assert uncounted({"core/src/model.rs": model.replace("    self.spend()?;\n}\nfn", "}\nfn", 1)}), "missed a call_model that doesn't spend"
    print("PASS  model-guards self-test: 15 planted breaches caught (3 after test-only items), 0 false alarms on the clean sets")


if __name__ == "__main__":
    check = {"meta-only": breaches, "counted": uncounted}
    if sys.argv[1:] == ["self-test"]:
        self_test()
        sys.exit(0)
    if len(sys.argv) != 2 or sys.argv[1] not in check:
        sys.exit(__doc__)
    found = check[sys.argv[1]](tracked())
    for line in found:
        print(f"      {line}")
    sys.exit(1 if found else 0)
