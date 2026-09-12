"""Mock GuardFrame TCP runner for R3 prototype validation.

Speaks GF_TRACK1_TCP_V1 framing and validates requests exactly like the
real (future, WSL-hosted) GuardFrame runner would, but never touches SCRFD,
CropB35, or any of the three synthetic-detection models. Every response is
tagged source=MOCK_GUARDFRAME_RUNNER so nothing downstream can mistake a
mock result for a real GuardFrame judgment. Loopback-only: start() refuses
to bind anything other than proto.DEFAULT_BIND_ADDRESS (127.0.0.1).
"""
from __future__ import annotations

import socket
import threading
from dataclasses import dataclass, field
from types import TracebackType
from typing import Optional, Type

from . import protocol as proto
from .socket_io import make_socket_read_exact


@dataclass
class MockGuardFrameRunner:
    host: str = proto.DEFAULT_BIND_ADDRESS
    port: int = 0  # 0 lets the OS pick a free loopback port, for test isolation
    accept_timeout_seconds: float = 0.5
    connection_timeout_seconds: float = 10.0

    _server: Optional[socket.socket] = field(default=None, init=False, repr=False)
    _thread: Optional[threading.Thread] = field(default=None, init=False, repr=False)
    _stop: threading.Event = field(default_factory=threading.Event, init=False, repr=False)

    @property
    def bound_port(self) -> int:
        if self._server is None:
            raise RuntimeError("runner not started")
        return self._server.getsockname()[1]

    def start(self) -> "MockGuardFrameRunner":
        if self.host != proto.DEFAULT_BIND_ADDRESS:
            raise ValueError(
                f"refusing to bind host={self.host!r}: this prototype runner is "
                f"loopback-only and may only bind {proto.DEFAULT_BIND_ADDRESS!r} "
                f"(TCP_SCOPE=LOOPBACK_ONLY, 0.0.0.0=FORBIDDEN)"
            )

        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((self.host, self.port))
        server.listen(5)
        server.settimeout(self.accept_timeout_seconds)
        self._server = server
        self._stop.clear()
        self._thread = threading.Thread(target=self._serve_forever, daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        if self._server is not None:
            self._server.close()
        self._server = None
        self._thread = None

    def __enter__(self) -> "MockGuardFrameRunner":
        return self.start()

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.stop()

    def _serve_forever(self) -> None:
        assert self._server is not None
        while not self._stop.is_set():
            try:
                conn, _addr = self._server.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            try:
                self._handle_connection(conn)
            finally:
                conn.close()

    def _handle_connection(self, conn: socket.socket) -> None:
        conn.settimeout(self.connection_timeout_seconds)
        request_id = "unknown"
        try:
            header, payload = proto.read_message_from_stream(make_socket_read_exact(conn))
            request_id = header.get("request_id") or "unknown"
            message_type = header.get("message_type")

            if message_type == proto.MessageType.HEALTH.value:
                proto.validate_health_request(header)
                response_header = proto.build_health_response(request_id)
            elif message_type == proto.MessageType.ASSESS.value:
                proto.validate_assess_request(header, payload)
                response_header = proto.build_mock_assess_response(request_id)
            else:
                raise proto.GuardFrameProtocolError(
                    proto.ProtocolErrorCode.MALFORMED_HEADER,
                    f"unknown message_type={message_type!r}",
                )

            conn.sendall(proto.pack_message(response_header))
        except proto.GuardFrameProtocolError as exc:
            self._send_error_best_effort(conn, request_id, exc.code, exc.message)
        except Exception as exc:  # noqa: BLE001 - runner must never crash on bad input
            self._send_error_best_effort(
                conn, request_id, proto.ProtocolErrorCode.RUNNER_INTERNAL_ERROR, str(exc)
            )

    @staticmethod
    def _send_error_best_effort(
        conn: socket.socket, request_id: str, code: proto.ProtocolErrorCode, message: str
    ) -> None:
        """Truly best-effort: a failure here must never escape and kill the serving thread."""
        try:
            response = proto.build_error_response(request_id, code, message)
            conn.sendall(proto.pack_message(response))
        except (OSError, proto.GuardFrameProtocolError):
            pass  # peer gone, or the error itself couldn't be packed; nothing more we can do
