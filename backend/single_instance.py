from __future__ import annotations

import hashlib
import json
import os
import socket
import threading
import time
from pathlib import Path
from typing import Any, Callable


class SingleInstance:
    def __init__(self, state_dir: Path, on_message: Callable[[dict[str, Any]], None], app_id: str = "SlideStudio") -> None:
        self.state_dir = state_dir
        self.on_message = on_message
        self.app_id = app_id
        digest = hashlib.sha256(f"{app_id}:{state_dir.resolve()}".encode("utf-8")).digest()
        self.port = 41000 + int.from_bytes(digest[:2], "big") % 18000
        self._lock_file: Any = None
        self._socket: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def acquire(self, payload: dict[str, Any] | None = None) -> bool:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        lock_path = self.state_dir / f"{self.app_id}.lock"
        lock_file = lock_path.open("a+b")
        if lock_file.tell() == 0:
            lock_file.write(b"0")
            lock_file.flush()
        try:
            self._lock(lock_file)
        except OSError:
            lock_file.close()
            self._notify(payload or {})
            return False
        self._lock_file = lock_file
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            listener.bind(("127.0.0.1", self.port))
            listener.listen(4)
            listener.settimeout(0.25)
        except OSError:
            listener.close()
            self._unlock(lock_file)
            lock_file.close()
            self._lock_file = None
            raise
        self._socket = listener
        self._thread = threading.Thread(target=self._serve, name="slide-single-instance", daemon=True)
        self._thread.start()
        return True

    @staticmethod
    def _lock(stream: Any) -> None:
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    @staticmethod
    def _unlock(stream: Any) -> None:
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

    def _notify(self, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")[:65535]
        for _ in range(20):
            try:
                with socket.create_connection(("127.0.0.1", self.port), timeout=0.2) as connection:
                    connection.sendall(encoded)
                return
            except OSError:
                time.sleep(0.05)

    def _serve(self) -> None:
        while not self._stop.is_set() and self._socket is not None:
            try:
                connection, _ = self._socket.accept()
            except (OSError, socket.timeout):
                continue
            with connection:
                try:
                    raw = connection.recv(65536)
                    if raw:
                        payload = json.loads(raw.decode("utf-8"))
                        if isinstance(payload, dict):
                            self.on_message(payload)
                except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                    continue

    def close(self) -> None:
        self._stop.set()
        if self._socket is not None:
            try:
                self._socket.close()
            except OSError:
                pass
            self._socket = None
        if self._thread is not None:
            self._thread.join(timeout=1)
            self._thread = None
        if self._lock_file is not None:
            try:
                self._unlock(self._lock_file)
            finally:
                self._lock_file.close()
                self._lock_file = None

    def __enter__(self) -> "SingleInstance":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
