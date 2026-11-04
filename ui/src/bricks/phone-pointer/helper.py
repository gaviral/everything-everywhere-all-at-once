#!/usr/bin/env python3
"""Explicitly launched, ephemeral Mac bridge. No model, microphone, journal or saved credential."""
import argparse
import hmac
import json
import mimetypes
from pathlib import Path
import secrets
import select
import ssl
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
DIST = HERE.parents[2] / "dist"


class Native:
    def __init__(self, executable):
        self.executable = executable
        self.lock = threading.Lock()
        self.frames = threading.Lock()
        self.lifecycle = threading.Lock()
        self.closing = False
        self.frame_process = None
        self.process = subprocess.Popen([str(executable)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)

    def request(self, event):
        with self.lock:
            if self.closing or self.process.poll() is not None:
                raise ValueError("Mac input helper stopped. Restart it to pair again.")
            self.process.stdin.write(json.dumps(event) + "\n")
            self.process.stdin.flush()
            if not select.select([self.process.stdout], [], [], 3)[0]:
                self.process.terminate()  # Only the child we own; never replay an uncertain input.
                raise ValueError("Mac input timed out. Restart the helper.")
            result = json.loads(self.process.stdout.readline())
            if "error" in result:
                raise ValueError(result["error"])
            return result

    def frame(self):
        if not self.frames.acquire(blocking=False):
            raise ValueError("A preview frame is already in progress.")
        try:
            # This process exists only for one requested frame. No recording loop or audio.
            with self.lifecycle:
                if self.closing:
                    raise ValueError("Mac helper stopped.")
                child = subprocess.Popen([str(self.executable), "--frame"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                self.frame_process = child
            try:
                image, _ = child.communicate(timeout=8)
            except subprocess.TimeoutExpired:
                child.kill()
                child.communicate()
                raise ValueError("Preview timed out. Start it again when ready.") from None
            finally:
                with self.lifecycle:
                    self.frame_process = None
            if child.returncode or not image.startswith(b"\xff\xd8"):
                raise ValueError("Preview unavailable. Allow Screen Recording for the helper, then check connection.")
            return image
        finally:
            self.frames.release()

    def close(self):
        with self.lifecycle:
            self.closing = True
            children = [self.process, self.frame_process]
            for child in children:
                if child is not None and child.poll() is None:
                    child.terminate()
        for child in children:
            if child is not None:
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()


def valid_input(data):
    if not isinstance(data, dict):
        return False
    kind = data.get("kind")
    if kind == "move":
        return set(data) == {"kind", "dx", "dy"} and all(type(data[k]) in (int, float) and -500 <= data[k] <= 500 for k in ("dx", "dy"))
    if kind == "click":
        return set(data) == {"kind", "button"} and data["button"] in ("left", "right")
    if kind == "text":
        return set(data) == {"kind", "text"} and isinstance(data["text"], str) and 0 < len(data["text"]) <= 500
    if kind == "key":
        keys = {"Escape", "Tab", "Enter", "Backspace", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"} | set("abcdefghijklmnopqrstuvwxyz0123456789")
        return (set(data) == {"kind", "key", "modifiers"} and isinstance(data["key"], str) and data["key"] in keys
                and isinstance(data["modifiers"], list) and len(data["modifiers"]) <= 4
                and all(isinstance(item, str) and item in {"command", "control", "option", "shift"} for item in data["modifiers"]))
    return False


def handler(native, token, origin, dist=DIST):
    authority = urlsplit(origin).netloc

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *_args):
            pass  # Pairing credentials and screen content never enter request logs.

        def respond(self, status, body, content_type="application/json"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def failure(self, message, status=400):
            self.respond(status, json.dumps({"error": message}).encode())

        def admitted(self):
            if self.headers.get("Host") != authority:
                self.failure("Wrong helper address.", 403)
                return False
            if self.path.startswith("/pointer/"):
                if (not hmac.compare_digest(self.headers.get("Authorization", "").encode(), ("Bearer " + token).encode())
                        or self.headers.get("Origin", origin) != origin
                        or self.headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none")):
                    self.failure("Pair again using the link from this helper.", 403)
                    return False
            return True

        def do_GET(self):
            if not self.admitted():
                return
            if self.path == "/pointer/status":
                try:
                    self.respond(200, json.dumps(native.request({"kind": "status"})).encode())
                except (ValueError, OSError) as error:
                    self.failure(str(error), 503)
                return
            path = urlsplit(self.path).path
            if path == "/":
                self.send_response(302)
                self.send_header("Location", "/bricks.html?brick=phone-pointer&sample=empty")
                self.end_headers()
                return
            if path != "/bricks.html" and not path.startswith("/assets/"):
                self.failure("Not found.", 404)
                return
            file = (dist / path.lstrip("/")).resolve()
            if not file.is_relative_to(dist.resolve()) or not file.is_file():
                self.failure("Build the UI first.", 404)
                return
            mime = mimetypes.guess_type(file)[0] or "application/octet-stream"
            content = file.read_bytes()
            if path == "/bricks.html":
                # The shared playground rewrites URLs before its lazy feature mounts.
                # Read the fragment into memory first, without editing that shared host.
                bootstrap = (HERE / "bootstrap.js").read_bytes()
                content = content.replace(b"<head>", b"<head><script>" + bootstrap + b"</script>", 1)
            self.respond(200, content, mime)

        def do_POST(self):
            if not self.admitted():
                return
            if self.path not in ("/pointer/input", "/pointer/frame"):
                self.failure("Not found.", 404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 8192 or self.headers.get("Content-Type") != "application/json":
                    raise ValueError("Expected a small JSON request.")
                data = json.loads(self.rfile.read(length))
                if self.path == "/pointer/input":
                    if not valid_input(data):
                        raise ValueError("Unsupported input.")
                    result = native.request(data)
                    self.respond(200, json.dumps(result).encode())
                else:
                    if data != {"start": True}:
                        raise ValueError("Start preview explicitly.")
                    self.respond(200, native.frame(), "image/jpeg")
            except (ValueError, OSError, subprocess.TimeoutExpired) as error:
                self.failure(str(error))

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--host", default="127.0.0.1", help="Mac LAN IP or hostname, as the phone will open it")
    parser.add_argument("--port", type=int, default=4387)
    parser.add_argument("--cert", type=Path, help="Optional HTTPS certificate")
    parser.add_argument("--key", type=Path, help="HTTPS private key (never put it in this repo)")
    args = parser.parse_args()
    if args.port in (4360, 4399) or not 1024 <= args.port <= 65535:
        parser.error("Choose an unreserved port between 1024 and 65535.")
    if any(char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-" for char in args.host) or not args.host:
        parser.error("Use a plain Mac LAN IPv4 address or hostname.")
    if bool(args.cert) != bool(args.key):
        parser.error("HTTPS needs both --cert and --key.")
    if not (DIST / "bricks.html").is_file():
        parser.error("Build first: npm --prefix ui run build")
    build = Path(tempfile.mkdtemp(prefix="phone-pointer-native-"))
    executable = build / "phone-pointer"
    subprocess.run(["swiftc", "-parse-as-library", str(HERE / "native.swift"), "-o", str(executable)], check=True)
    native = Native(executable)
    token = secrets.token_urlsafe(32)
    origin = f"{'https' if args.cert else 'http'}://{args.host}:{args.port}"
    server = None
    try:
        server = ThreadingHTTPServer((args.bind, args.port), handler(native, token, origin))
        server.daemon_threads = True
        if args.cert:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(args.cert, args.key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
        print("Open this private link on the phone, on the same trusted Wi-Fi. Keep it private; anyone with it can control the Mac.", flush=True)
        print(f"{origin}/bricks.html?brick=phone-pointer&sample=empty#pair={token}", flush=True)
        print("No capture started. Ctrl-C stops the helper and invalidates the link.", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if server is not None:
            server.server_close()
        native.close()


if __name__ == "__main__":
    main()
