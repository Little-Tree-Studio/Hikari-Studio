from __future__ import annotations

import hmac
import logging
import secrets
import threading
from dataclasses import dataclass
from typing import Any, Callable

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send
from PySide6.QtCore import QObject, Signal, Slot


LOGGER = logging.getLogger(__name__)
MAX_RPC_BODY_BYTES = 64 * 1024 * 1024
MAX_RPC_METHOD_LENGTH = 128
MAX_RPC_ARGUMENTS = 128
RPC_REQUEST_TIMEOUT_SECONDS = 120


class RpcRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requestId: str = Field(min_length=1, max_length=128)
    method: str = Field(min_length=1, max_length=MAX_RPC_METHOD_LENGTH, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    args: list[Any] = Field(default_factory=list, max_length=MAX_RPC_ARGUMENTS)


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[..., Any]) -> Any:
        try:
            content_length = request.headers.get("content-length")
            if content_length is not None and int(content_length) > MAX_RPC_BODY_BYTES:
                return JSONResponse({"detail": "RPC request body is too large"}, status_code=413)
            if request.method == "POST" and request.url.path == "/rpc":
                body = await request.body()
                if len(body) > MAX_RPC_BODY_BYTES:
                    return JSONResponse({"detail": "RPC request body is too large"}, status_code=413)
                request = Request(request.scope, receive=lambda: _body_receive(body))
        except ValueError:
            return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
        return await call_next(request)


async def _body_receive(body: bytes) -> dict[str, Any]:
    return {"type": "http.request", "body": body, "more_body": False}


class BearerAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, token: str) -> None:
        super().__init__(app)
        self.token = token

    async def dispatch(self, request: Request, call_next: Callable[..., Any]) -> Any:
        if request.method == "OPTIONS":
            return await call_next(request)
        if request.url.path in {"/rpc", "/health"}:
            authorization = request.headers.get("authorization", "")
            scheme, _, supplied = authorization.partition(" ")
            if scheme.lower() != "bearer" or not hmac.compare_digest(supplied, self.token):
                return PlainTextResponse("Unauthorized", status_code=401, headers={"WWW-Authenticate": "Bearer"})
        return await call_next(request)


class LocalhostOnlyMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in {"http", "websocket"}:
            client = scope.get("client")
            host = client[0] if client else ""
            if host not in {"127.0.0.1", "::1", "localhost"}:
                response = JSONResponse({"detail": "Local RPC only"}, status_code=403)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


@dataclass
class RpcCall:
    method: str
    args: list[Any]
    done: threading.Event
    result: Any = None
    error: BaseException | None = None


class QtRpcDispatcher(QObject):
    """Dispatches network requests onto the Qt GUI thread."""

    def __init__(self, api: Any, request_signal: Any) -> None:
        super().__init__()
        self._api = api
        self._request_signal = request_signal
        excluded = {
            "capture_python_crash",
            "install_crash_handlers",
            "persist_window_state",
            "restore_crash_handlers",
            "schedule_window_state",
            "start_background_services",
            "stop_background_services",
        }
        self.methods = frozenset(
            name for name in dir(api)
            if not name.startswith("_") and name not in excluded and callable(getattr(api, name, None))
        )

    def call(self, method: str, args: list[Any]) -> Any:
        if method not in self.methods:
            raise AttributeError(f"Unknown desktop API method: {method}")
        call = RpcCall(method, args, threading.Event())
        self._request_signal.emit(call)
        if not call.done.wait(RPC_REQUEST_TIMEOUT_SECONDS):
            raise TimeoutError("Desktop API call timed out")
        if call.error is not None:
            raise call.error
        return call.result

    @Slot(object)
    def handle(self, call: RpcCall) -> None:
        try:
            call.result = getattr(self._api, call.method)(*call.args)
        except BaseException as exc:
            call.error = exc
        finally:
            call.done.set()


class QtRpcSignalHost(QObject):
    request = Signal(object)


class RpcServer:
    def __init__(self, dispatcher: QtRpcDispatcher, static_root: Any | None = None) -> None:
        self.token = secrets.token_urlsafe(32)
        self.dispatcher = dispatcher
        self._server: uvicorn.Server | None = None
        self._thread: threading.Thread | None = None
        self._ready = threading.Event()
        self.port: int | None = None

        app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
        app.add_middleware(BearerAuthMiddleware, token=self.token)
        app.add_middleware(LocalhostOnlyMiddleware)
        app.add_middleware(RequestSizeLimitMiddleware)
        app.add_middleware(GZipMiddleware, minimum_size=1024)
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[],
            allow_methods=["POST", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
            allow_credentials=False,
            max_age=60,
        )

        @app.get("/health", include_in_schema=False)
        def health(request: Request) -> dict[str, str]:
            return {"status": "ok"}

        @app.post("/rpc", include_in_schema=False)
        def rpc(request: Request, payload: RpcRequest) -> JSONResponse:
            try:
                value = self.dispatcher.call(payload.method, payload.args)
                return JSONResponse({"ok": True, "value": value})
            except Exception as exc:
                LOGGER.exception("FastAPI desktop RPC failed: %s", payload.method)
                return JSONResponse(
                    {
                        "ok": False,
                        "error": {"type": type(exc).__name__, "message": str(exc)},
                    },
                    status_code=500,
                )

        if static_root is not None:
            app.mount("/", StaticFiles(directory=str(static_root), html=True), name="frontend")

        self.app = app

    @property
    def base_url(self) -> str:
        if self.port is None:
            raise RuntimeError("RPC server is not running")
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> None:
        if self._thread is not None:
            return
        config = uvicorn.Config(
            self.app,
            host="127.0.0.1",
            port=0,
            log_config=None,
            access_log=False,
            server_header=False,
            date_header=False,
            loop="asyncio",
        )
        self._server = uvicorn.Server(config)

        def run() -> None:
            assert self._server is not None
            self._server.run()

        self._thread = threading.Thread(target=run, name="slide-fastapi-rpc", daemon=True)
        self._thread.start()
        for _ in range(200):
            if self._server.started:
                sockets = self._server.servers
                if sockets and sockets[0].sockets:
                    self.port = int(sockets[0].sockets[0].getsockname()[1])
                    self._ready.set()
                    return
            if self._server.should_exit:
                break
            self._ready.wait(0.01)
        if not self._ready.is_set():
            raise RuntimeError("FastAPI RPC server failed to start")

    def stop(self) -> None:
        if self._server is not None:
            self._server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=3)
        self._thread = None
        self._server = None
        self.port = None
