"""Real long-lived WSL GuardFrame TCP runner for R5-R3.

Speaks GF_TRACK1_TCP_V1 exactly like MockGuardFrameRunner (loopback-only
bind, serial accept loop, bounded per-connection timeout, clean stop), but
on ASSESS replaces the hardcoded mock inference body with a real external
adapter -- either the frozen portable GuardFrame V3 component (production)
or an injected fake (tests). Every response is tagged
source=REAL_GUARDFRAME_RUNNER.

This module must not import guardframe_synthetic_v3, torch, onnxruntime, or
any model runtime at module scope. The production adapter factory is
resolved lazily inside start(), only when no adapter_factory override is
supplied, so this module can be imported and exercised in model-free tests
with zero model dependencies installed.
"""
from __future__ import annotations

import math
import socket
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from types import TracebackType
from typing import Any, Callable, Optional, Sequence, Type

from . import protocol as proto
from .socket_io import make_socket_read_exact


class RealRunnerStartupError(RuntimeError):
    """Raised when the real runner cannot reach a servable state."""


def _materialize_frames_bgr(payload: bytes, frames_meta: Sequence["proto.FrameMeta"]) -> list:
    """Reconstruct the wire-order BGR uint8 frames as read-only, zero-copy views.

    No color conversion, no resize, no face detection, no CropB35, no model
    preprocessing, no mutation of the reconstructed arrays. `payload` is
    immutable `bytes`; slicing it directly would copy, so a `memoryview` is
    sliced instead -- each per-frame `memoryview` slice references the same
    underlying buffer, and `np.frombuffer` over a read-only buffer yields a
    non-writeable `ndarray`, enforcing RUNNER_INPUT_MUTATION=FORBIDDEN by
    construction rather than by convention.
    """
    import numpy as np

    payload_view = memoryview(payload)
    offset = 0
    frames_bgr = []
    for meta in frames_meta:
        frame_view = payload_view[offset : offset + meta.nbytes]
        frame = np.frombuffer(frame_view, dtype=np.uint8).reshape(meta.height, meta.width, 3)
        frames_bgr.append(frame)
        offset += meta.nbytes
    return frames_bgr


def _validate_adapter_result(result: Any) -> tuple:
    """Validate the external adapter's return value against its frozen contract.

    Strict: exact top-level keys, exact per-signal keys, exact allowed
    fakeProbability values, exact descending presentation weights. No
    normalization, repair, or coercion -- any violation raises, which the
    caller maps to RUNNER_INTERNAL_ERROR.
    """
    if not isinstance(result, dict):
        raise RuntimeError("adapter result is not a dict")

    if set(result.keys()) != {"fakeProbability", "topSignals"}:
        raise RuntimeError("adapter result has unexpected top-level keys")

    fake_probability = result["fakeProbability"]
    if isinstance(fake_probability, bool) or not isinstance(fake_probability, (int, float)):
        raise RuntimeError("fakeProbability is not numeric")
    if not math.isfinite(fake_probability):
        raise RuntimeError("fakeProbability is not finite")
    if fake_probability not in (0.2, 0.5, 0.8):
        raise RuntimeError("fakeProbability is not an allowed discrete value")

    top_signals = result["topSignals"]
    if not isinstance(top_signals, list) or len(top_signals) != 3:
        raise RuntimeError("topSignals is not a 3-element list")

    weights: list = []
    for entry in top_signals:
        if not isinstance(entry, dict) or set(entry.keys()) != {"label", "weight"}:
            raise RuntimeError("topSignals entry has unexpected keys")
        label = entry["label"]
        weight = entry["weight"]
        if not isinstance(label, str):
            raise RuntimeError("topSignals label is not a str")
        if isinstance(weight, bool) or not isinstance(weight, (int, float)):
            raise RuntimeError("topSignals weight is not numeric")
        if not math.isfinite(weight):
            raise RuntimeError("topSignals weight is not finite")
        weights.append(float(weight))

    if weights != [0.9, 0.6, 0.3]:
        raise RuntimeError("topSignals weights do not match the frozen presentation contract")

    return float(fake_probability), top_signals


@dataclass
class RealGuardFrameRunner:
    """Long-lived real GuardFrame TCP runner for GF_TRACK1_TCP_V1.

    Loopback-only: start() refuses to bind anything other than
    proto.DEFAULT_BIND_ADDRESS (127.0.0.1), checked before any portable
    import, adapter construction, or socket creation. start() is
    transactional: if any startup step fails -- adapter build, socket
    bind/listen, or thread start -- all partial state from that attempt is
    rolled back (server closed, instance state reset, and only the sys.path
    entry this attempt itself inserted is removed) before the failure
    propagates. start() also refuses to run again while a prior instance is
    still live or not fully stopped.
    """

    host: str = proto.DEFAULT_BIND_ADDRESS
    port: int = proto.DEFAULT_PORT
    accept_timeout_seconds: float = 0.5
    connection_timeout_seconds: float = 10.0
    device: str = "cuda:0"
    portable_root: Optional[Path] = None
    adapter_factory: Optional[Callable[[], Any]] = None

    _server: Optional[socket.socket] = field(default=None, init=False, repr=False)
    _thread: Optional[threading.Thread] = field(default=None, init=False, repr=False)
    _stop: threading.Event = field(default_factory=threading.Event, init=False, repr=False)
    _adapter: Optional[Any] = field(default=None, init=False, repr=False)

    @property
    def bound_port(self) -> int:
        if self._server is None:
            raise RuntimeError("runner not started")
        return self._server.getsockname()[1]

    def start(self) -> "RealGuardFrameRunner":
        if self.host != proto.DEFAULT_BIND_ADDRESS:
            raise ValueError(
                f"refusing to bind host={self.host!r}: this runner is loopback-only and "
                f"may only bind {proto.DEFAULT_BIND_ADDRESS!r} "
                f"(TCP_SCOPE=LOOPBACK_ONLY, 0.0.0.0=FORBIDDEN)"
            )
        if self._thread is not None or self._server is not None:
            raise RuntimeError("runner already started or not fully stopped")

        inserted_path_this_attempt: Optional[str] = None
        server: Optional[socket.socket] = None
        try:
            adapter, inserted_path_this_attempt = self._build_adapter_with_startup_metadata()

            server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server.bind((self.host, self.port))
            server.listen(5)
            server.settimeout(self.accept_timeout_seconds)

            self._adapter = adapter
            self._server = server
            self._stop.clear()
            thread = threading.Thread(target=self._serve_forever, daemon=True)
            self._thread = thread
            thread.start()
        except Exception:
            if server is not None:
                try:
                    server.close()
                except OSError:
                    pass
            self._server = None
            self._thread = None
            self._adapter = None
            if inserted_path_this_attempt is not None:
                try:
                    sys.path.remove(inserted_path_this_attempt)
                except ValueError:
                    pass
            raise
        return self

    def _build_adapter_with_startup_metadata(self) -> tuple:
        """Returns (adapter, inserted_sys_path_entry_or_None).

        The returned path entry (if any) is only the one *this* call
        inserted into sys.path -- callers use it to roll back exactly that
        entry if a later startup step fails, without touching any
        pre-existing or successfully-completed sys.path state.
        """
        if self.adapter_factory is not None:
            return self.adapter_factory(), None
        return self._build_production_adapter()

    def _build_production_adapter(self) -> tuple:
        """Import the frozen portable package from a configured root only,
        verifying the imported module origins actually resolve underneath
        that root before trusting anything it constructs.

        `sys.path` insertion alone does not prove import origin: if a
        package of the same name is already cached in sys.modules from an
        unrelated location, a plain `import` returns that cached module
        regardless of what was just added to sys.path. Both risks are
        checked explicitly. On any failure *internal to this method* (bad
        root, import failure, origin mismatch, adapter construction
        failure) it rolls back its own sys.path insertion itself and fails
        closed; on success it hands the inserted-entry bookkeeping back to
        the caller instead, since a later startup step might still fail.
        """
        if self.portable_root is None:
            raise RealRunnerStartupError(
                "portable_root is required when adapter_factory is not supplied"
            )
        portable_root_resolved = self.portable_root.resolve()
        if not portable_root_resolved.is_dir():
            raise RealRunnerStartupError(
                f"portable_root does not resolve to a directory: {portable_root_resolved}"
            )

        path_entry = str(portable_root_resolved)
        inserted_by_this_attempt = False

        def _rollback_path_entry() -> None:
            if inserted_by_this_attempt:
                try:
                    sys.path.remove(path_entry)
                except ValueError:
                    pass

        package_module = sys.modules.get("guardframe_synthetic_v3")
        if package_module is not None:
            existing_origin = Path(package_module.__file__).resolve()
            if portable_root_resolved not in existing_origin.parents:
                raise RealRunnerStartupError(
                    "guardframe_synthetic_v3 already loaded from a conflicting origin: "
                    f"{existing_origin}, expected under {portable_root_resolved}"
                )
        else:
            if path_entry not in sys.path:
                sys.path.insert(0, path_entry)
                inserted_by_this_attempt = True
            try:
                import guardframe_synthetic_v3 as package_module  # noqa: F811
            except Exception as exc:
                _rollback_path_entry()
                raise RealRunnerStartupError(
                    f"failed to import guardframe_synthetic_v3 from {portable_root_resolved}: {exc}"
                ) from exc

            imported_origin = Path(package_module.__file__).resolve()
            if portable_root_resolved not in imported_origin.parents:
                _rollback_path_entry()
                raise RealRunnerStartupError(
                    "guardframe_synthetic_v3 imported from unexpected origin: "
                    f"{imported_origin}, expected under {portable_root_resolved}"
                )

        try:
            from guardframe_synthetic_v3 import external_adapter as _external_adapter_module
        except Exception as exc:
            _rollback_path_entry()
            raise RealRunnerStartupError(
                f"failed to import guardframe_synthetic_v3.external_adapter: {exc}"
            ) from exc

        external_adapter_origin = Path(_external_adapter_module.__file__).resolve()
        if portable_root_resolved not in external_adapter_origin.parents:
            _rollback_path_entry()
            raise RealRunnerStartupError(
                "guardframe_synthetic_v3.external_adapter imported from unexpected origin: "
                f"{external_adapter_origin}, expected under {portable_root_resolved}"
            )

        try:
            adapter = _external_adapter_module.build_production_external_adapter(device=self.device)
        except Exception as exc:
            _rollback_path_entry()
            raise RealRunnerStartupError(
                f"failed to construct production external adapter: {exc}"
            ) from exc

        return adapter, (path_entry if inserted_by_this_attempt else None)

    def stop(self) -> None:
        self._stop.set()
        if self._server is not None:
            try:
                self._server.close()
            except OSError:
                pass
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            if self._thread.is_alive():
                raise RuntimeError("runner did not stop within timeout")
        self._server = None
        self._thread = None
        self._adapter = None

    def __enter__(self) -> "RealGuardFrameRunner":
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
            except Exception as exc:  # noqa: BLE001 - one bad connection must not kill the accept loop
                print(f"[real_runner] unexpected connection-handler failure: {exc!r}", file=sys.stderr)
            finally:
                conn.close()

    def _handle_connection(self, conn: socket.socket) -> None:
        request_id = "unknown"

        try:
            conn.settimeout(self.connection_timeout_seconds)
            header, payload = proto.read_message_from_stream(make_socket_read_exact(conn))
            request_id = header.get("request_id") or "unknown"
            message_type = header.get("message_type")

            if message_type == proto.MessageType.HEALTH.value:
                proto.validate_health_request(header)
            elif message_type == proto.MessageType.ASSESS.value:
                frames_meta = proto.validate_assess_request(header, payload)
            else:
                raise proto.GuardFrameProtocolError(
                    proto.ProtocolErrorCode.MALFORMED_HEADER,
                    f"unknown message_type={message_type!r}",
                )
        except proto.GuardFrameProtocolError as exc:
            self._send_error_best_effort(conn, request_id, exc.code, exc.message)
            return
        except (socket.timeout, OSError):
            return
        except Exception as exc:  # noqa: BLE001 - failure before request validation completed
            print(
                f"[real_runner] pre-validation error request_id={request_id}: {exc!r}",
                file=sys.stderr,
            )
            self._send_error_best_effort(
                conn,
                request_id,
                proto.ProtocolErrorCode.RUNNER_INTERNAL_ERROR,
                "Internal runner error",
            )
            return

        # The incoming request is now fully validated. Materialization,
        # adapter execution, adapter-result validation, response-header
        # construction, AND response serialization (pack_message) are all
        # internal runner work from here -- a separate try block from
        # request validation above, so a failure here is never misreported
        # as a client protocol error regardless of its exception type.
        try:
            if message_type == proto.MessageType.HEALTH.value:
                response_header = proto.build_health_response(
                    request_id, source=proto.REAL_SOURCE_MARKER
                )
            else:
                frames_bgr = _materialize_frames_bgr(payload, frames_meta)
                result = self._adapter.assess_sampled_frames(frames_bgr, authorities=None)
                fake_probability, top_signals = _validate_adapter_result(result)
                response_header = proto.build_assess_response(
                    request_id, fake_probability, top_signals, source=proto.REAL_SOURCE_MARKER
                )
            packed_response = proto.pack_message(response_header)
        except Exception as exc:  # noqa: BLE001 - internal failure must never crash the serve loop
            print(
                f"[real_runner] internal error request_id={request_id}: {exc!r}",
                file=sys.stderr,
            )
            self._send_error_best_effort(
                conn,
                request_id,
                proto.ProtocolErrorCode.RUNNER_INTERNAL_ERROR,
                "Internal runner error",
            )
            return

        try:
            conn.sendall(packed_response)
        except OSError:
            pass  # peer gone; best-effort only, no recursive error response

    @staticmethod
    def _send_error_best_effort(
        conn: socket.socket, request_id: str, code: proto.ProtocolErrorCode, message: str
    ) -> None:
        """Truly best-effort: nothing here may escape and kill the serving thread,
        including failures inside build_error_response/pack_message themselves."""
        try:
            response = proto.build_error_response(
                request_id, code, message, source=proto.REAL_SOURCE_MARKER
            )
            packed = proto.pack_message(response)
            conn.sendall(packed)
        except Exception:  # noqa: BLE001 - error-path failures must never escalate
            pass
