from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any

from PySide6.QtCore import QObject, QUrl, Qt, Signal
from PySide6.QtGui import QCloseEvent, QMoveEvent, QResizeEvent
from PySide6.QtWidgets import QApplication, QFileDialog, QMainWindow
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineScript, QWebEngineUrlRequestInterceptor
from PySide6.QtWebEngineWidgets import QWebEngineView


LOGGER = logging.getLogger(__name__)


class QtScreenProxy:
    def __init__(self, screen: Any) -> None:
        geometry = screen.geometry()
        available = screen.availableGeometry()
        self.x = geometry.x()
        self.y = geometry.y()
        self.width = geometry.width()
        self.height = geometry.height()
        self.frame = type(
            "AvailableFrame",
            (),
            {
                "X": available.x(),
                "Y": available.y(),
                "Width": available.width(),
                "Height": available.height(),
            },
        )()


def screen_proxies(application: QApplication) -> list[QtScreenProxy]:
    return [QtScreenProxy(screen) for screen in application.screens()]


class QtMainWindow(QMainWindow):
    moved = Signal()
    resized = Signal()
    closing = Signal()
    instance_message = Signal(object)
    rpc_request = Signal(object)

    def moveEvent(self, event: QMoveEvent) -> None:
        super().moveEvent(event)
        self.moved.emit()

    def resizeEvent(self, event: QResizeEvent) -> None:
        super().resizeEvent(event)
        self.resized.emit()

    def closeEvent(self, event: QCloseEvent) -> None:
        self.closing.emit()
        super().closeEvent(event)

    def dispatch_instance_message(self, payload: dict[str, Any]) -> None:
        self.instance_message.emit(payload)


class QtWindowAdapter:
    """Window protocol consumed by DesktopApi, backed by Qt widgets."""

    def __init__(self, window: QtMainWindow, view: QWebEngineView, application: QApplication) -> None:
        self._window = window
        self._view = view
        self._application = application
        self.native = type("QtNative", (), {"scale_factor": 1.0})()

    @property
    def width(self) -> int:
        return self._window.width()

    @property
    def height(self) -> int:
        return self._window.height()

    @property
    def x(self) -> int:
        return self._window.x()

    @property
    def y(self) -> int:
        return self._window.y()

    @property
    def screen(self) -> QtScreenProxy | None:
        screen = self._window.screen()
        return QtScreenProxy(screen) if screen is not None else None

    @property
    def screens(self) -> list[QtScreenProxy]:
        return screen_proxies(self._application)

    def move(self, x: int, y: int) -> None:
        self._window.move(int(x), int(y))

    def resize(self, width: int, height: int, fix_point: Any = None) -> None:
        x, y = self._window.x(), self._window.y()
        if isinstance(fix_point, tuple) and len(fix_point) == 2:
            fix_x, fix_y = fix_point
            if fix_x == "east":
                x += self._window.width() - int(width)
            if fix_y == "south":
                y += self._window.height() - int(height)
        self._window.setGeometry(x, y, int(width), int(height))

    def set_geometry(self, x: int, y: int, width: int, height: int) -> None:
        self._window.setGeometry(int(x), int(y), int(width), int(height))

    def restore(self) -> None:
        self._window.showNormal()

    def maximize(self) -> None:
        self._window.showMaximized()

    def minimize(self) -> None:
        self._window.showMinimized()

    def show(self) -> None:
        self._window.show()

    def destroy(self) -> None:
        self._window.close()

    def set_always_on_top(self, enabled: bool) -> None:
        self._window.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, bool(enabled))
        self._window.show()
        self._window.raise_()

    def resize_content(self, width: int, height: int) -> None:
        self._window.resize(int(width), int(height))

    def activate(self) -> None:
        self._window.show()
        self._window.raise_()
        self._window.activateWindow()

    def dispatch_instance_message(self, payload: dict[str, Any]) -> None:
        self._window.dispatch_instance_message(payload)

    def evaluate_js(self, script: str) -> None:
        self._view.page().runJavaScript(script)

    @staticmethod
    def _qt_filter(filters: tuple[str, ...] | list[str] | None) -> str:
        if not filters:
            return "All files (*.*)"
        normalized: list[str] = []
        for item in filters:
            normalized.append(item.replace(";", " "))
        return ";;".join(normalized)

    def create_file_dialog(
        self,
        dialog_type: str,
        *,
        allow_multiple: bool = False,
        file_types: tuple[str, ...] | list[str] | None = None,
    ) -> list[str] | str | None:
        if dialog_type == "folder":
            value = QFileDialog.getExistingDirectory(self._window, "选择文件夹")
            return value or None
        if allow_multiple:
            values, _ = QFileDialog.getOpenFileNames(self._window, "选择文件", "", self._qt_filter(file_types))
            return values
        value, _ = QFileDialog.getOpenFileName(self._window, "选择文件", "", self._qt_filter(file_types))
        return value or None


class QtWebPage(QWebEnginePage):
    def __init__(self, view: QWebEngineView, host: "QtWebHost") -> None:
        super().__init__(view)
        self._host = host

    def createWindow(self, window_type: QWebEnginePage.WebWindowType) -> QWebEnginePage | None:
        del window_type
        return self._host.create_popup_page()


class RpcRequestInterceptor(QWebEngineUrlRequestInterceptor):
    def __init__(self, rpc_server: Any) -> None:
        super().__init__()
        self._rpc_server = rpc_server

    def interceptRequest(self, info: Any) -> None:
        url = info.requestUrl()
        if url.host() == "127.0.0.1" and url.port() == self._rpc_server.port:
            info.setHttpHeader(b"Authorization", f"Bearer {self._rpc_server.token}".encode("ascii"))


class QtWebHost:
    def __init__(
        self,
        api: Any,
        url: Path | QUrl | None,
        width: int,
        height: int,
        x: int | None,
        y: int | None,
        application: QApplication,
        *,
        parent: "QtWebHost | None" = None,
        title: str = "Slide Studio",
        rpc_server: Any = None,
        window_id: str | None = None,
    ) -> None:
        self.application = application
        self.api = api
        self.parent = parent
        self.children: list[QtWebHost] = []
        self.rpc_server = rpc_server
        self.window_id = window_id or "main"
        self.window = QtMainWindow()
        self.window.setWindowTitle(title)
        if not application.windowIcon().isNull():
            self.window.setWindowIcon(application.windowIcon())
        self.window.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        # Use the native Windows titlebar so DWM owns dragging, resizing,
        # maximize bounds, system buttons, and Win11 rounded corners.
        self.window.setWindowFlag(Qt.WindowType.Window, True)
        self.window.setMinimumSize(760, 520)
        if parent is not None:
            self.window.setMinimumSize(320, 240)
        self.window.setGeometry(x if x is not None else 0, y if y is not None else 0, width, height)
        self.view = QWebEngineView(self.window)
        self.page = QtWebPage(self.view, self)
        self.view.setPage(self.page)
        self.window.setCentralWidget(self.view)
        if self.window_id != "main":
            register = getattr(self.api, "_register_popup_window", None)
            if callable(register):
                register(self.window_id, QtWindowAdapter(self.window, self.view, self.application))
            unregister = getattr(self.api, "_unregister_popup_window", None)
            if callable(unregister):
                self.window.closing.connect(lambda: unregister(self.window_id))
        if rpc_server is not None:
            self.interceptor = RpcRequestInterceptor(rpc_server)
            self.page.profile().setUrlRequestInterceptor(self.interceptor)
            script = QWebEngineScript()
            script.setName("slide-rpc-config")
            script.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
            script.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
            script.setSourceCode(
                "window.__SLIDE_RPC__ = "
                f"{{baseUrl: {json.dumps(rpc_server.base_url)}, "
                f"token: {json.dumps(rpc_server.token)}}};"
                f"window.__SLIDE_WINDOW_ID__ = {json.dumps(self.window_id)};"
            )
            self.page.scripts().insert(script)
        if url is not None:
            target = url if isinstance(url, QUrl) else QUrl.fromLocalFile(str(url.resolve()))
            self.view.load(target)

    def show(self) -> None:
        self.window.show()

    def load_finished_connect(self, callback: Any) -> None:
        self.view.loadFinished.connect(callback)

    def create_popup_page(self) -> QWebEnginePage:
        popup = QtWebHost(
            self.api,
            QUrl("about:blank"),
            1280,
            760,
            None,
            None,
            self.application,
            parent=self,
            title="Slide Studio Preview",
            rpc_server=self.rpc_server,
            window_id=f"popup-{uuid.uuid4().hex}",
        )
        self.children.append(popup)
        popup.window.show()
        return popup.page
