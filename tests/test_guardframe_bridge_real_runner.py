"""R5-R3 model-free tests for guardframe_bridge.real_runner.

Every test here uses an injected `adapter_factory` (a small in-process
fake), never the production portable-runtime path. guardframe_synthetic_v3,
torch, and onnxruntime are never imported by this file or by real_runner.py
under test -- an autouse fixture poisons sys.modules for those three names
so any accidental import attempt fails loudly instead of silently
succeeding.
"""

import importlib
import io
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pytest

from guardframe_bridge import protocol as proto
from guardframe_bridge import real_runner
from guardframe_bridge.client import GuardFrameBridgeClient, rgb_to_bgr_uint8
from guardframe_bridge.socket_io import make_socket_read_exact


@pytest.fixture(autouse=True)
def _forbid_portable_and_model_runtime_imports(monkeypatch):
    for forbidden_module in ("guardframe_synthetic_v3", "torch", "onnxruntime"):
        monkeypatch.setitem(sys.modules, forbidden_module, None)
    yield


# ---------------------------------------------------------------------------
# Fakes / helpers
# ---------------------------------------------------------------------------


class RecordingFakeAdapter:
    """Fake external adapter that records every assess_sampled_frames call."""

    def __init__(self, result):
        self.result = result
        self.calls = []

    def assess_sampled_frames(self, frames_bgr, authorities=None):
        self.calls.append({"frames_bgr": frames_bgr, "authorities": authorities})
        return self.result


class QueuedFakeAdapter:
    """Fake external adapter returning/raising a pre-configured sequence of results."""

    def __init__(self, results):
        self._results = list(results)
        self.calls = []

    def assess_sampled_frames(self, frames_bgr, authorities=None):
        self.calls.append({"frames_bgr": frames_bgr, "authorities": authorities})
        result = self._results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result


class RaisingFakeAdapter:
    """Fake external adapter that always raises the given exception."""

    def __init__(self, exc):
        self._exc = exc

    def assess_sampled_frames(self, frames_bgr, authorities=None):
        raise self._exc


class FakeConn:
    """Minimal socket.socket stand-in exposing only sendall(), for isolated
    _send_error_best_effort tests that need no real socket."""

    def __init__(self, raise_on_sendall=None):
        self.sent = []
        self._raise_on_sendall = raise_on_sendall

    def sendall(self, data):
        if self._raise_on_sendall is not None:
            raise self._raise_on_sendall
        self.sent.append(data)


def _mixed_resolution_dims():
    return [
        (240, 320),
        (241, 321),
        (100, 100),
        (480, 640),
        (50, 200),
        (720, 1280),
        (99, 401),
        (180, 240),
        (33, 77),
        (500, 500),
    ]


def _mixed_resolution_frames_rgb():
    frames = []
    for idx, (h, w) in enumerate(_mixed_resolution_dims()):
        frame = np.empty((h, w, 3), dtype=np.uint8)
        frame[:, :] = [idx, idx + 1, idx + 2]
        frames.append(frame)
    return frames


def _expected_bgr_frames(rgb_frames):
    return [np.ascontiguousarray(frame[:, :, ::-1]) for frame in rgb_frames]


def _valid_result(fake_probability, labels=("SIGNAL_A", "SIGNAL_B", "SIGNAL_C")):
    return {
        "fakeProbability": fake_probability,
        "topSignals": [
            {"label": labels[0], "weight": 0.9},
            {"label": labels[1], "weight": 0.6},
            {"label": labels[2], "weight": 0.3},
        ],
    }


def _raw_roundtrip(runner, message_bytes, timeout=5.0):
    sock = socket.create_connection((runner.host, runner.bound_port), timeout=timeout)
    try:
        sock.sendall(message_bytes)
        return proto.read_message_from_stream(make_socket_read_exact(sock))
    finally:
        sock.close()


def _connect_and_capture_raw(runner, message_bytes, timeout=5.0, recv_chunk=65536):
    sock = socket.create_connection((runner.host, runner.bound_port), timeout=timeout)
    try:
        sock.sendall(message_bytes)
        sock.settimeout(timeout)
        chunks = []
        try:
            while True:
                chunk = sock.recv(recv_chunk)
                if not chunk:
                    break
                chunks.append(chunk)
        except socket.timeout:
            pass
        return b"".join(chunks)
    finally:
        sock.close()


def _read_exact_from_bytes(data: bytes):
    buf = io.BytesIO(data)

    def _read_exact(n):
        chunk = buf.read(n)
        if len(chunk) != n:
            raise proto.GuardFrameProtocolError(
                proto.ProtocolErrorCode.INVALID_PAYLOAD_LENGTH, "short read in test buffer"
            )
        return chunk

    return _read_exact


def _pack_assess_message(rgb_frames, request_id="test-request"):
    frames_bgr = [rgb_to_bgr_uint8(frame) for frame in rgb_frames]
    metas = [
        proto.FrameMeta(height=f.shape[0], width=f.shape[1], channels=3, nbytes=f.nbytes)
        for f in frames_bgr
    ]
    header = proto.build_assess_request_header(request_id, metas)
    payload = b"".join(f.tobytes() for f in frames_bgr)
    return proto.pack_message(header, payload)


# ---------------------------------------------------------------------------
# 1. Import boundary
# ---------------------------------------------------------------------------


def test_importing_real_runner_does_not_import_portable_or_model_runtime():
    """Re-executes real_runner's module body while guardframe_synthetic_v3,
    torch, and onnxruntime are poisoned in sys.modules (via the autouse
    fixture above). If real_runner.py ever gained an accidental module-scope
    `import guardframe_synthetic_v3` / `import torch` / `import onnxruntime`,
    this reload would raise ImportError and fail the test; a clean reload is
    the proof that none of those names are imported at module scope.
    """
    importlib.reload(real_runner)


# ---------------------------------------------------------------------------
# 2. Loopback bind guard precedes adapter/socket work
# ---------------------------------------------------------------------------


def test_non_loopback_host_rejected_before_adapter_and_socket(monkeypatch):
    factory_calls = []

    def factory():
        factory_calls.append(True)
        return RecordingFakeAdapter(result=_valid_result(0.2))

    socket_calls = []

    def guard_socket(*args, **kwargs):
        socket_calls.append((args, kwargs))
        raise AssertionError("socket.socket must not be constructed for a rejected host")

    monkeypatch.setattr(real_runner.socket, "socket", guard_socket)

    runner = real_runner.RealGuardFrameRunner(host="0.0.0.0", port=0, adapter_factory=factory)
    with pytest.raises(ValueError):
        runner.start()

    assert factory_calls == []
    assert socket_calls == []


# ---------------------------------------------------------------------------
# 3. Real HEALTH response
# ---------------------------------------------------------------------------


def test_real_health_response_shape():
    fake_adapter = RecordingFakeAdapter(result=_valid_result(0.2))
    runner = real_runner.RealGuardFrameRunner(port=0, adapter_factory=lambda: fake_adapter)
    runner.start()
    try:
        client = GuardFrameBridgeClient(host=runner.host, port=runner.bound_port)
        response = client.health()

        assert response["protocol_version"] == proto.PROTOCOL_VERSION
        assert response["message_type"] == proto.MessageType.HEALTH_RESPONSE.value
        assert response["status"] == "ready"
        assert response["source"] == proto.REAL_SOURCE_MARKER
    finally:
        runner.stop()


# ---------------------------------------------------------------------------
# 4-9. Exact 10-frame, mixed-resolution, ordered, pixel-exact, non-writeable,
# authorities=None BGR materialization
# ---------------------------------------------------------------------------


def test_assess_materializes_exact_mixed_resolution_bgr_frames_in_order():
    fake_adapter = RecordingFakeAdapter(result=_valid_result(0.5))
    runner = real_runner.RealGuardFrameRunner(port=0, adapter_factory=lambda: fake_adapter)
    runner.start()
    try:
        rgb_frames = _mixed_resolution_frames_rgb()
        client = GuardFrameBridgeClient(host=runner.host, port=runner.bound_port)
        client.assess(rgb_frames)

        assert len(fake_adapter.calls) == 1
        call = fake_adapter.calls[0]
        assert call["authorities"] is None

        received_frames = call["frames_bgr"]
        expected_frames = _expected_bgr_frames(rgb_frames)
        assert len(received_frames) == proto.FIXED_ASSESS_FRAME_COUNT
        assert len(received_frames) == len(expected_frames)

        for received, expected, (h, w) in zip(
            received_frames, expected_frames, _mixed_resolution_dims()
        ):
            assert received.dtype == np.uint8
            assert received.ndim == 3
            assert received.shape == (h, w, 3)
            assert received.flags.writeable is False
            assert np.array_equal(received, expected)
    finally:
        runner.stop()


# ---------------------------------------------------------------------------
# 10-11. fakeProbability / topSignals passthrough
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("fake_probability", [0.2, 0.5, 0.8])
def test_fake_probability_and_top_signals_passthrough(fake_probability):
    expected_result = _valid_result(fake_probability)
    fake_adapter = RecordingFakeAdapter(result=expected_result)
    runner = real_runner.RealGuardFrameRunner(port=0, adapter_factory=lambda: fake_adapter)
    runner.start()
    try:
        client = GuardFrameBridgeClient(host=runner.host, port=runner.bound_port)
        response = client.assess(_mixed_resolution_frames_rgb())

        assert response["source"] == proto.REAL_SOURCE_MARKER
        assert response["fakeProbability"] == fake_probability
        assert response["topSignals"] == expected_result["topSignals"]
        assert [s["weight"] for s in response["topSignals"]] == [0.9, 0.6, 0.3]
    finally:
        runner.stop()


# ---------------------------------------------------------------------------
# 12. Malformed adapter result -> RUNNER_INTERNAL_ERROR / "Internal runner error"
# ---------------------------------------------------------------------------


_MALFORMED_ADAPTER_RESULTS = [
    ("result_not_dict", ["not", "a", "dict"]),
    ("missing_top_level_key", {"fakeProbability": 0.5}),
    ("extra_top_level_key", {**_valid_result(0.5), "confidence": 0.99}),
    (
        "bool_fake_probability",
        {"fakeProbability": True, "topSignals": _valid_result(0.5)["topSignals"]},
    ),
    (
        "non_finite_fake_probability",
        {"fakeProbability": float("nan"), "topSignals": _valid_result(0.5)["topSignals"]},
    ),
    (
        "disallowed_fake_probability",
        {"fakeProbability": 0.6, "topSignals": _valid_result(0.5)["topSignals"]},
    ),
    ("top_signals_not_list", {"fakeProbability": 0.5, "topSignals": "not-a-list"}),
    (
        "top_signals_wrong_length",
        {"fakeProbability": 0.5, "topSignals": _valid_result(0.5)["topSignals"][:2]},
    ),
    (
        "signal_not_dict",
        {
            "fakeProbability": 0.5,
            "topSignals": [
                "not-a-dict",
                {"label": "b", "weight": 0.6},
                {"label": "c", "weight": 0.3},
            ],
        },
    ),
    (
        "missing_signal_key",
        {
            "fakeProbability": 0.5,
            "topSignals": [
                {"label": "a"},
                {"label": "b", "weight": 0.6},
                {"label": "c", "weight": 0.3},
            ],
        },
    ),
    (
        "extra_signal_key",
        {
            "fakeProbability": 0.5,
            "topSignals": [
                {"label": "a", "weight": 0.9, "extra": 1},
                {"label": "b", "weight": 0.6},
                {"label": "c", "weight": 0.3},
            ],
        },
    ),
    (
        "non_string_label",
        {
            "fakeProbability": 0.5,
            "topSignals": [
                {"label": 123, "weight": 0.9},
                {"label": "b", "weight": 0.6},
                {"label": "c", "weight": 0.3},
            ],
        },
    ),
    (
        "bool_weight",
        {
            "fakeProbability": 0.5,
            "topSignals": [
                {"label": "a", "weight": True},
                {"label": "b", "weight": 0.6},
                {"label": "c", "weight": 0.3},
            ],
        },
    ),
    (
        "non_finite_weight",
        {
            "fakeProbability": 0.5,
            "topSignals": [
                {"label": "a", "weight": float("inf")},
                {"label": "b", "weight": 0.6},
                {"label": "c", "weight": 0.3},
            ],
        },
    ),
    (
        "wrong_presentation_weight_order",
        {
            "fakeProbability": 0.5,
            "topSignals": [
                {"label": "a", "weight": 0.3},
                {"label": "b", "weight": 0.6},
                {"label": "c", "weight": 0.9},
            ],
        },
    ),
]


@pytest.mark.parametrize(
    "case_name, malformed_result",
    _MALFORMED_ADAPTER_RESULTS,
    ids=[name for name, _ in _MALFORMED_ADAPTER_RESULTS],
)
def test_malformed_adapter_result_maps_to_sanitized_internal_error(case_name, malformed_result):
    fake_adapter = RecordingFakeAdapter(result=malformed_result)
    runner = real_runner.RealGuardFrameRunner(port=0, adapter_factory=lambda: fake_adapter)
    runner.start()
    try:
        client = GuardFrameBridgeClient(host=runner.host, port=runner.bound_port)
        with pytest.raises(proto.GuardFrameProtocolError) as excinfo:
            client.assess(_mixed_resolution_frames_rgb())

        assert excinfo.value.code == proto.ProtocolErrorCode.RUNNER_INTERNAL_ERROR
        assert excinfo.value.message == "Internal runner error"
    finally:
        runner.stop()


# ---------------------------------------------------------------------------
# 13. Adapter exception with secret text must not reach the wire
# ---------------------------------------------------------------------------


def test_adapter_exception_secret_text_not_exposed_on_wire():
    secret_message = "SECRET_INTERNAL_PATH=/tmp/never-expose/checkpoint.pt"
    fake_adapter = RaisingFakeAdapter(RuntimeError(secret_message))
    runner = real_runner.RealGuardFrameRunner(port=0, adapter_factory=lambda: fake_adapter)
    runner.start()
    try:
        message_bytes = _pack_assess_message(_mixed_resolution_frames_rgb())
        raw_response = _connect_and_capture_raw(runner, message_bytes)

        assert secret_message.encode("utf-8") not in raw_response
        assert b"never-expose" not in raw_response
        assert b"checkpoint.pt" not in raw_response

        header, _payload = proto.read_message_from_stream(_read_exact_from_bytes(raw_response))
        assert header["message_type"] == proto.MessageType.ERROR.value
        assert header["error_code"] == proto.ProtocolErrorCode.RUNNER_INTERNAL_ERROR.value
        assert header["error_message"] == "Internal runner error"
    finally:
        runner.stop()


# ---------------------------------------------------------------------------
# 14. Malformed incoming protocol request keeps its existing structured error
# ---------------------------------------------------------------------------


def test_malformed_incoming_protocol_request_returns_structured_protocol_error():
    fake_adapter = RecordingFakeAdapter(result=_valid_result(0.2))
    runner = real_runner.RealGuardFrameRunner(port=0, adapter_factory=lambda: fake_adapter)
    runner.start()
    try:
        dims = _mixed_resolution_dims()[:9]  # 9 frames -> INVALID_FRAME_COUNT, not 10
        metas = [
            proto.FrameMeta(height=h, width=w, channels=3, nbytes=h * w * 3) for h, w in dims
        ]
        payload = b"".join(bytes(m.nbytes) for m in metas)
        header = proto.build_assess_request_header("bad-frame-count", metas)
        message = proto.pack_message(header, payload)

        header_out, _payload_out = _raw_roundtrip(runner, message)

        assert header_out["message_type"] == proto.MessageType.ERROR.value
        assert header_out["error_code"] == proto.ProtocolErrorCode.INVALID_FRAME_COUNT.value
        assert fake_adapter.calls == []
    finally:
        runner.stop()


# ---------------------------------------------------------------------------
# 15. A failed request does not prevent a later valid request from succeeding
# ---------------------------------------------------------------------------


def test_request_level_failure_does_not_prevent_later_success():
    fake_adapter = QueuedFakeAdapter([RuntimeError("boom"), _valid_result(0.8)])
    runner = real_runner.RealGuardFrameRunner(port=0, adapter_factory=lambda: fake_adapter)
    runner.start()
    try:
        client = GuardFrameBridgeClient(host=runner.host, port=runner.bound_port)
        rgb_frames = _mixed_resolution_frames_rgb()

        with pytest.raises(proto.GuardFrameProtocolError) as excinfo:
            client.assess(rgb_frames)
        assert excinfo.value.code == proto.ProtocolErrorCode.RUNNER_INTERNAL_ERROR

        response = client.assess(rgb_frames)
        assert response["fakeProbability"] == 0.8
        assert response["source"] == proto.REAL_SOURCE_MARKER
    finally:
        runner.stop()


# ---------------------------------------------------------------------------
# 16-18. stop / start-while-active / restart lifecycle
# ---------------------------------------------------------------------------


def test_stop_normal_lifecycle_clears_state_and_stops_serving():
    fake_adapter = RecordingFakeAdapter(result=_valid_result(0.2))
    runner = real_runner.RealGuardFrameRunner(port=0, adapter_factory=lambda: fake_adapter)
    runner.start()
    bound_port = runner.bound_port

    runner.stop()

    assert runner._thread is None
    assert runner._server is None
    assert runner._adapter is None

    with pytest.raises(proto.GuardFrameProtocolError) as excinfo:
        GuardFrameBridgeClient(host=runner.host, port=bound_port, timeout_seconds=1.0).health()
    assert excinfo.value.code == proto.ProtocolErrorCode.CONNECTION_REFUSED


def test_start_while_already_active_is_rejected():
    fake_adapter = RecordingFakeAdapter(result=_valid_result(0.2))
    runner = real_runner.RealGuardFrameRunner(port=0, adapter_factory=lambda: fake_adapter)
    runner.start()
    try:
        with pytest.raises(RuntimeError, match="already started or not fully stopped"):
            runner.start()
    finally:
        runner.stop()


def test_restart_after_complete_stop_succeeds():
    fake_adapter = RecordingFakeAdapter(result=_valid_result(0.2))
    runner = real_runner.RealGuardFrameRunner(port=0, adapter_factory=lambda: fake_adapter)
    runner.start()
    runner.stop()

    runner.start()
    try:
        client = GuardFrameBridgeClient(host=runner.host, port=runner.bound_port)
        response = client.health()
        assert response["status"] == "ready"
        assert response["source"] == proto.REAL_SOURCE_MARKER
    finally:
        runner.stop()


# ---------------------------------------------------------------------------
# 19. Incomplete-stop protection, without a genuinely hanging thread
# ---------------------------------------------------------------------------


def test_incomplete_stop_blocks_restart_without_hanging():
    fake_adapter = RecordingFakeAdapter(result=_valid_result(0.2))
    runner = real_runner.RealGuardFrameRunner(port=0, adapter_factory=lambda: fake_adapter)
    runner.start()
    real_thread = runner._thread
    real_server = runner._server

    class _NeverDyingThread:
        def join(self, timeout=None):
            return None

        def is_alive(self):
            return True

    runner._thread = _NeverDyingThread()

    with pytest.raises(RuntimeError, match="did not stop within timeout"):
        runner.stop()

    assert runner._thread is not None
    assert runner._server is not None

    with pytest.raises(RuntimeError, match="already started or not fully stopped"):
        runner.start()

    # Real cleanup: swap the fake thread back out and shut the real
    # server/thread down directly, bypassing the (still-faked) stop().
    runner._thread = real_thread
    runner._stop.set()
    try:
        real_server.close()
    except OSError:
        pass
    real_thread.join(timeout=2.0)
    runner._server = None
    runner._thread = None
    runner._adapter = None


# ---------------------------------------------------------------------------
# 20-22. protocol.py builder backward/forward compatibility
# ---------------------------------------------------------------------------


def test_build_mock_assess_response_external_behavior_unchanged():
    response = proto.build_mock_assess_response("req-mock")
    assert response == {
        "protocol_version": proto.PROTOCOL_VERSION,
        "message_type": proto.MessageType.ASSESS_RESPONSE.value,
        "request_id": "req-mock",
        "source": proto.MOCK_SOURCE_MARKER,
        "fakeProbability": 0.5,
        "topSignals": [
            {"label": "MOCK_ONLY_1", "weight": 0.9},
            {"label": "MOCK_ONLY_2", "weight": 0.6},
            {"label": "MOCK_ONLY_3", "weight": 0.3},
        ],
    }


def test_build_health_response_default_source_is_mock():
    response = proto.build_health_response("req-health")
    assert response["source"] == proto.MOCK_SOURCE_MARKER
    assert response["status"] == "ready"


def test_build_error_response_default_source_is_mock():
    response = proto.build_error_response(
        "req-error", proto.ProtocolErrorCode.TIMEOUT, "timed out"
    )
    assert response["source"] == proto.MOCK_SOURCE_MARKER


def test_real_source_overrides_use_real_marker():
    health = proto.build_health_response("req-health", source=proto.REAL_SOURCE_MARKER)
    assert health["source"] == proto.REAL_SOURCE_MARKER

    assess = proto.build_assess_response(
        "req-assess", 0.5, _valid_result(0.5)["topSignals"], source=proto.REAL_SOURCE_MARKER
    )
    assert assess["source"] == proto.REAL_SOURCE_MARKER
    assert assess["message_type"] == proto.MessageType.ASSESS_RESPONSE.value

    error = proto.build_error_response(
        "req-error",
        proto.ProtocolErrorCode.RUNNER_INTERNAL_ERROR,
        "Internal runner error",
        source=proto.REAL_SOURCE_MARKER,
    )
    assert error["source"] == proto.REAL_SOURCE_MARKER


# ---------------------------------------------------------------------------
# 23. _send_error_best_effort must never escape
# ---------------------------------------------------------------------------


def test_send_error_best_effort_survives_build_error_response_failure(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("build_error_response exploded")

    monkeypatch.setattr(real_runner.proto, "build_error_response", boom)
    conn = FakeConn()

    real_runner.RealGuardFrameRunner._send_error_best_effort(
        conn, "req", proto.ProtocolErrorCode.RUNNER_INTERNAL_ERROR, "Internal runner error"
    )
    assert conn.sent == []


def test_send_error_best_effort_survives_pack_message_failure(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("pack_message exploded")

    monkeypatch.setattr(real_runner.proto, "pack_message", boom)
    conn = FakeConn()

    real_runner.RealGuardFrameRunner._send_error_best_effort(
        conn, "req", proto.ProtocolErrorCode.RUNNER_INTERNAL_ERROR, "Internal runner error"
    )
    assert conn.sent == []


def test_send_error_best_effort_survives_sendall_failure():
    conn = FakeConn(raise_on_sendall=OSError("broken pipe"))

    real_runner.RealGuardFrameRunner._send_error_best_effort(
        conn, "req", proto.ProtocolErrorCode.RUNNER_INTERNAL_ERROR, "Internal runner error"
    )
    assert conn.sent == []


# ---------------------------------------------------------------------------
# 24. Post-validation server response-pack failure -> sanitized internal
# error, distinguished from client-side request packing, and the serving
# lifecycle survives it
# ---------------------------------------------------------------------------


def test_post_validation_pack_message_failure_maps_to_internal_error_and_survives(monkeypatch):
    fake_adapter = RecordingFakeAdapter(result=_valid_result(0.2))
    runner = real_runner.RealGuardFrameRunner(port=0, adapter_factory=lambda: fake_adapter)
    runner.start()
    try:
        original_pack_message = real_runner.proto.pack_message
        failed = {"done": False}

        def flaky_pack_message(header, payload=b""):
            if (
                not failed["done"]
                and header.get("message_type") == proto.MessageType.ASSESS_RESPONSE.value
                and header.get("source") == proto.REAL_SOURCE_MARKER
            ):
                failed["done"] = True
                raise RuntimeError("boom")
            return original_pack_message(header, payload)

        monkeypatch.setattr(real_runner.proto, "pack_message", flaky_pack_message)

        client = GuardFrameBridgeClient(host=runner.host, port=runner.bound_port)
        rgb_frames = _mixed_resolution_frames_rgb()

        with pytest.raises(proto.GuardFrameProtocolError) as excinfo:
            client.assess(rgb_frames)
        assert excinfo.value.code == proto.ProtocolErrorCode.RUNNER_INTERNAL_ERROR
        assert excinfo.value.message == "Internal runner error"

        response = client.assess(rgb_frames)
        assert response["fakeProbability"] == 0.2
        assert response["source"] == proto.REAL_SOURCE_MARKER

        assert failed["done"] is True
    finally:
        runner.stop()
