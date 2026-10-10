"""Open decider server: exposes an open-weights Quyet model behind the TypeSafe
`/v1/systemone` request/response shape, so `OpenDecider` can reuse the official
TypeSafe SDK by pointing `baseURL` here.

Local only (binds 127.0.0.1 by default). No secrets are read or required.

Usage:
    python server.py --model chinhnc/Quyet-1.0-Medium --port 8765
"""

from __future__ import annotations

import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import quyet
import torch

MAX_BODY_BYTES = 2 * 1024 * 1024


def pick_device(requested: str | None) -> str:
    if requested:
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class Server:
    def __init__(self, model_id: str, device: str):
        self.model_id = model_id
        self.device = device
        started = time.perf_counter()
        self.model = quyet.load(model_id, device=device)
        self.load_seconds = round(time.perf_counter() - started, 1)
        # One forward pass at a time: the model object is not documented as thread-safe.
        self.lock = threading.Lock()

    def predict(self, payload: dict) -> dict:
        state = payload.get("state")
        questions = payload.get("questions")
        if not isinstance(questions, dict) or not questions:
            raise ValueError("`questions` must be a non-empty object")
        with self.lock:
            result = self.model.predict(state, questions, strict=bool(payload.get("strict", False)))
        answers = result.get("answers", result)
        usage = result.get("usage") or {"input_tokens": 0, "output_tokens": 0}
        return {"model": self.model_id, "answers": answers, "usage": usage}


def make_handler(server: Server):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: dict) -> None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                self._send(200, {"ok": True, "model": server.model_id, "device": server.device,
                                 "load_seconds": server.load_seconds})
            elif self.path == "/v1/models":
                self._send(200, {"models": [{"name": server.model_id,
                                             "description": "Quyet open decision model",
                                             "release_date": "2026-10-03"}]})
            else:
                self._send(404, {"error": {"message": "not found"}})

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/v1/systemone":
                self._send(404, {"error": {"message": "not found"}})
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY_BYTES:
                self._send(413 if length > MAX_BODY_BYTES else 400, {"error": {"message": "bad body size"}})
                return
            try:
                payload = json.loads(self.rfile.read(length))
                self._send(200, server.predict(payload))
            except (ValueError, TypeError, KeyError) as exc:
                self._send(422, {"error": {"message": str(exc)}})
            except Exception as exc:  # surface model errors as 500 without crashing the server
                self._send(500, {"error": {"message": f"{type(exc).__name__}: {exc}"}})

        def log_message(self, fmt: str, *args) -> None:
            pass

    return Handler


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="chinhnc/Quyet-1.0-Medium")
    p.add_argument("--device", default=None)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    a = p.parse_args()
    server = Server(a.model, pick_device(a.device))
    print(json.dumps({"msg": "open-decider ready", "model": server.model_id, "device": server.device,
                      "load_seconds": server.load_seconds, "url": f"http://{a.host}:{a.port}"}), flush=True)
    ThreadingHTTPServer((a.host, a.port), make_handler(server)).serve_forever()


if __name__ == "__main__":
    main()
