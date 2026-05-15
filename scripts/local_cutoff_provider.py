#!/usr/bin/env python3
"""Tiny OpenAI-compatible image endpoint for recovery acceptance tests."""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


PNG_1X1_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


class State:
    mode = "ok"
    n = 512


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def do_POST(self) -> None:
        if self.path == "/__test/cutoff":
            payload = self._read_json()
            State.mode = str(payload.get("mode") or "ok")
            State.n = int(payload.get("n") or 512)
            self._send_json(200, {"mode": State.mode, "n": State.n})
            return

        if self.path not in ("/v1/images/generations", "/v1/images/edits"):
            self._send_json(404, {"error": {"message": "not found"}})
            return

        _ = self._read_json()
        body = json.dumps(
            {
                "created": 1778865554,
                "data": [{"b64_json": PNG_1X1_BASE64, "revised_prompt": "acceptance image"}],
            }
        ).encode("utf-8")

        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("x-request-id", "local-cutoff-request")
        if State.mode == "ok":
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
            return

        if State.mode == "headers_only":
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.close_connection = True
            return

        if State.mode == "body_after_n_bytes":
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body[: max(0, min(State.n, len(body) - 1))])
            self.wfile.flush()
            self.close_connection = True
            return

        self._send_json(400, {"error": {"message": f"unsupported cutoff mode: {State.mode}"}})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    host, port = server.server_address
    print(json.dumps({"host": host, "port": port, "api_base": f"http://{host}:{port}/v1"}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
