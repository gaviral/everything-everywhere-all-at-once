"""Synthetic check adapter. Never creates Native, sends OS input, or captures a screen."""
import base64
import json
from secrets import token_urlsafe
import threading
from http.server import ThreadingHTTPServer

from helper import handler, valid_input


class ExampleMac:
    def __init__(self):
        self.events = []
        self.frames = 0
        self.input_ready = True
        self.preview_ready = False
        self.fail_input = False

    def request(self, event):
        if event["kind"] == "status":
            return {"input": self.input_ready, "preview": self.preview_ready}
        if self.fail_input:
            self.fail_input = False
            raise ValueError("Example input refused.")
        self.events.append(event)
        return {"ok": True}

    def frame(self):
        self.frames += 1
        # A tiny synthetic image, never the Mac's screen.
        return base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=")


def serve():
    assert valid_input({"kind": "move", "dx": -24.5, "dy": 32})
    assert valid_input({"kind": "key", "key": "a", "modifiers": ["command", "shift"]})
    for event in [{}, [], {"kind": "status"}, {"kind": "move", "dx": True, "dy": 0},
                  {"kind": "move", "dx": float("nan"), "dy": 0}, {"kind": "move", "dx": 501, "dy": 0},
                  {"kind": "key", "key": "a", "modifiers": ["bogus"]}, {"kind": "text", "text": "x" * 501},
                  {"kind": "click", "button": "left", "x": 30}, {"kind": "click", "button": []}]:
        assert not valid_input(event), event
    native = ExampleMac()
    token = token_urlsafe(32)
    server = ThreadingHTTPServer(("127.0.0.1", 0), None)
    origin = f"http://127.0.0.1:{server.server_port}"
    base = handler(native, token, origin)

    class Fixture(base):
        def do_GET(self):
            if self.path == "/fixture":
                self.respond(200, json.dumps({"events": native.events, "frames": native.frames}).encode())
            else:
                super().do_GET()

        def do_POST(self):
            if self.path == "/fixture":
                values = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                for name, value in values.items():
                    if name not in ("input_ready", "preview_ready", "fail_input") or type(value) is not bool:
                        self.failure("Invalid fixture setting.")
                        return
                    setattr(native, name, value)
                self.respond(200, b"{}")
            else:
                super().do_POST()

    server.RequestHandlerClass = Fixture
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(json.dumps({"origin": origin, "pair": token}), flush=True)
    try:
        input()  # The owning check closes stdin as its completion signal.
    except EOFError:
        pass
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    serve()
