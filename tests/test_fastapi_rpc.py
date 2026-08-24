from __future__ import annotations

import json
import tempfile
import unittest
import urllib.error
import urllib.request

from backend.fastapi_rpc import RpcServer


class FakeDispatcher:
    methods = frozenset({"ping"})

    def call(self, method: str, args: list[object]) -> object:
        if method != "ping":
            raise AttributeError(method)
        return {"args": args}


class FastApiRpcTests(unittest.TestCase):
    def request(self, server: RpcServer, method: str, path: str, *, headers: dict[str, str] | None = None, payload: dict[str, object] | None = None) -> tuple[int, object]:
        request = urllib.request.Request(
            f"{server.base_url}{path}",
            method=method,
            headers=headers or {},
            data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                body = response.read().decode("utf-8")
                return response.status, json.loads(body) if response.headers.get_content_type() == "application/json" else body
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8")) if error.headers.get_content_type() == "application/json" else {}

    def test_rpc_requires_bearer_token_and_disables_docs(self) -> None:
        server = RpcServer(FakeDispatcher())
        server.start()
        try:
            self.assertEqual(self.request(server, "GET", "/docs")[0], 404)
            self.assertEqual(self.request(server, "GET", "/health")[0], 401)
            self.assertEqual(self.request(server, "GET", "/health", headers={"Authorization": "Bearer wrong"})[0], 401)
            response = self.request(server, "GET", "/health", headers={"Authorization": f"Bearer {server.token}"})
            self.assertEqual(response, (200, {"status": "ok"}))
        finally:
            server.stop()

    def test_rpc_validates_method_and_arguments(self) -> None:
        server = RpcServer(FakeDispatcher())
        headers = {"Authorization": f"Bearer {server.token}"}
        headers["Content-Type"] = "application/json"
        server.start()
        try:
            success = self.request(server, "POST", "/rpc", headers=headers, payload={"requestId": "1", "method": "ping", "args": ["value"]})
            self.assertEqual(success, (200, {"ok": True, "value": {"args": ["value"]}}))
            unknown = self.request(server, "POST", "/rpc", headers=headers, payload={"requestId": "2", "method": "unknown", "args": []})
            self.assertEqual(unknown[0], 500)
            self.assertFalse(unknown[1]["ok"])
            extra = self.request(server, "POST", "/rpc", headers=headers, payload={"requestId": "3", "method": "ping", "args": [], "extra": True})
            self.assertEqual(extra[0], 422)
        finally:
            server.stop()

    def test_server_can_serve_same_origin_frontend(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = __import__("pathlib").Path(directory)
            root.joinpath("desktop.html").write_text("<html>ok</html>", encoding="utf-8")
            server = RpcServer(FakeDispatcher(), static_root=root)
            server.start()
            try:
                status, payload = self.request(server, "GET", "/desktop.html")
                self.assertEqual(status, 200)
                self.assertEqual(payload, "<html>ok</html>")
            finally:
                server.stop()

    def test_project_asset_route_serves_files_and_blocks_path_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pathlib = __import__("pathlib")
            asset_dir = pathlib.Path(directory) / "assets" / "files"
            asset_dir.mkdir(parents=True)
            (asset_dir / "bg.jpg").write_bytes(b"fake-image-bytes")

            class AssetDispatcher(FakeDispatcher):
                def __init__(self, asset_dir: object) -> None:
                    super().__init__()
                    self._api = type("Api", (), {"_store": type("Store", (), {"asset_dir": asset_dir})()})()

            server = RpcServer(AssetDispatcher(asset_dir))
            server.start()
            try:
                status, payload = self.request(server, "GET", "/project-assets/bg.jpg")
                self.assertEqual(status, 200)
                self.assertEqual(payload, "fake-image-bytes")
                status, _ = self.request(server, "GET", "/project-assets/..%2F..%2Fsecret.txt")
                self.assertEqual(status, 404)
            finally:
                server.stop()
