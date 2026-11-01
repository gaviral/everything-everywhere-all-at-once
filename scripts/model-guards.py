"""Zero-token guards on the app's model calls, run by precheck.sh (and so by every push).
meta-only: the hackathon rule, from the organizers in writing: every model the project calls at runtime must be a
  Meta model. Fails when the app's code names a non-Meta model SDK, a non-Meta model endpoint or a non-Meta model, or
  when the core or the UI talks to any outside host but Meta's API. Coding tools used while building are allowed and
  aren't checked here; names of other chat apps (an import reads ChatGPT and Claude exports) are words, not calls.
counted: every model call counts toward the core's hourly cap (model.rs CALLS_PER_HOUR): only `call_model` and
  `ask_model` send the key, and both spend first. Voice Transcribe is left out on purpose (model.rs `listening_key`).
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
    """The code that runs: a Rust file up to its tests, no test files."""
    if path.endswith(("tests.rs", ".test.ts", ".test.tsx")):
        return ""
    return text.split("#[cfg(test)]")[0] if path.endswith(".rs") else text


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


def breaches(files):
    """files: {path: text}. Each breach as 'path:line: what'."""
    found = []
    for path, text in sorted(files.items()):
        if path in MANIFESTS:
            found += [f"{path}: {name} is a non-Meta model SDK" for name in packages(path, text) if SDK.match(name)]
            continue
        if not path.startswith(RUNTIME):
            continue
        code = runtime_part(path, text)
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
                found.append(f"{path}: call_model and ask_model (both of its sends) must spend before sending")
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
    model = "pub async fn call_model() {\n    self.spend()?;\n}\nfn ask_model() {\n    self.spend()?;\n    self.spend()?;\n}\n"
    inside = "let r = core\n    .ask_model(&setting, |model| {\n        core.http.post(URL).bearer_auth(key).send()\n    })\n"
    counted_clean = {"core/src/model.rs": model, "core/src/placer.rs": inside, "core/src/refiner_live.rs": "http.post(URL).bearer_auth(key)\n"}
    assert uncounted(counted_clean) == [], uncounted(counted_clean)
    assert uncounted({"core/src/apps.rs": "core.http.post(URL).bearer_auth(key).json(&body).send()\n"}), "missed a direct send"
    assert uncounted({"core/src/model.rs": model.replace("    self.spend()?;\n}\nfn", "}\nfn", 1)}), "missed a call_model that doesn't spend"
    print("PASS  model-guards self-test: 12 planted breaches caught, 0 false alarms on the clean sets")


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
