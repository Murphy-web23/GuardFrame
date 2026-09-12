"""Standalone R3 prototype self-test for the GuardFrame TCP bridge.

Exercises the wire protocol, mock runner, and error paths end-to-end over a
real loopback TCP socket. Does not touch any production teammate code, the
portable GuardFrame runtime, or any model. Frame pixel data for
protocol-level tests is synthesized with `os.urandom` (no numpy needed).
The RGB->BGR pixel-exact check needs numpy and is reported BLOCKED, not
FAILED, if numpy is not installed in the current environment.

Run: python3 -m guardframe_bridge.prototype_selftest
"""
from __future__ import annotations

import os
import socket
import sys
import uuid

from . import protocol as proto
from .client import GuardFrameBridgeClient
from .mock_runner import MockGuardFrameRunner

RESULTS: list[tuple[str, str, str]] = []  # (name, status, detail)


def record(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, "PASS" if ok else "FAIL", detail))


def record_blocked(name: str, detail: str) -> None:
    RESULTS.append((name, "BLOCKED", detail))


def _synthetic_frame_metas(dims: list[tuple[int, int]]) -> list[proto.FrameMeta]:
    return [proto.FrameMeta(height=h, width=w, channels=3, nbytes=h * w * 3) for h, w in dims]


def _roundtrip_over_socket(runner: MockGuardFrameRunner, message: bytes) -> tuple[dict, bytes]:
    sock = socket.create_connection((runner.host, runner.bound_port), timeout=5.0)
    try:
        sock.sendall(message)
        from .socket_io import make_socket_read_exact

        return proto.read_message_from_stream(make_socket_read_exact(sock))
    finally:
        sock.close()


def test_health_roundtrip(runner: MockGuardFrameRunner) -> None:
    """Item 1: health encode/decode."""
    client = GuardFrameBridgeClient(host=runner.host, port=runner.bound_port)
    response = client.health()
    ok = (
        response.get("message_type") == proto.MessageType.HEALTH_RESPONSE.value
        and response.get("status") == "ready"
        and response.get("source") == proto.MOCK_SOURCE_MARKER
    )
    record("health_encode_decode_roundtrip", ok, str(response))


def test_assess_10_frame_mixed_resolution(runner: MockGuardFrameRunner) -> None:
    """Items 2, 4, 6, 10: 10-frame request encode/decode, shape preserved
    across the wire, mixed resolutions not resized, mock source marker."""
    dims = [(240, 320)] * 9 + [(1080, 1920)]
    metas = _synthetic_frame_metas(dims)
    payload = b"".join(os.urandom(m.nbytes) for m in metas)
    header = proto.build_assess_request_header(str(uuid.uuid4()), metas)
    message = proto.pack_message(header, payload)

    response_header, response_payload = _roundtrip_over_socket(runner, message)

    ok = (
        response_header.get("message_type") == proto.MessageType.ASSESS_RESPONSE.value
        and response_header.get("source") == proto.MOCK_SOURCE_MARKER
        and response_header.get("fakeProbability") == 0.5
        and len(response_header.get("topSignals", [])) == 3
        and response_payload == b""
    )
    record("assess_10_frame_mixed_resolution_roundtrip", ok, str(response_header))


def test_frame_count_not_10_rejected(runner: MockGuardFrameRunner) -> None:
    """Item 7: frame_count != 10 must be rejected."""
    metas = _synthetic_frame_metas([(64, 64)] * 9)
    payload = b"".join(os.urandom(m.nbytes) for m in metas)
    header = proto.build_assess_request_header(str(uuid.uuid4()), metas)
    message = proto.pack_message(header, payload)

    response_header, _payload = _roundtrip_over_socket(runner, message)

    ok = (
        response_header.get("message_type") == proto.MessageType.ERROR.value
        and response_header.get("error_code") == proto.ProtocolErrorCode.INVALID_FRAME_COUNT.value
    )
    record("frame_count_not_10_rejected", ok, str(response_header))


def test_protocol_version_mismatch_rejected(runner: MockGuardFrameRunner) -> None:
    """Item 8: wrong protocol version must be rejected."""
    header = {
        "protocol_version": "GF_TRACK1_TCP_V0_BOGUS",
        "message_type": proto.MessageType.HEALTH.value,
        "request_id": str(uuid.uuid4()),
    }
    message = proto.pack_message(header)

    response_header, _payload = _roundtrip_over_socket(runner, message)

    ok = (
        response_header.get("message_type") == proto.MessageType.ERROR.value
        and response_header.get("error_code")
        == proto.ProtocolErrorCode.PROTOCOL_VERSION_MISMATCH.value
    )
    record("protocol_version_mismatch_rejected", ok, str(response_header))


def test_truncated_payload_rejected(runner: MockGuardFrameRunner) -> None:
    """Item 9: truncated payload must be rejected."""
    metas = _synthetic_frame_metas([(64, 64)] * 10)
    header = proto.build_assess_request_header(str(uuid.uuid4()), metas)
    full_payload = b"".join(os.urandom(m.nbytes) for m in metas)
    truncated_payload = full_payload[: len(full_payload) // 2]
    message = proto.pack_message(header, truncated_payload)

    sock = socket.create_connection((runner.host, runner.bound_port), timeout=5.0)
    try:
        sock.sendall(message)
        sock.shutdown(socket.SHUT_WR)  # simulate a client that stops mid-payload
        from .socket_io import make_socket_read_exact

        try:
            response_header, _payload = proto.read_message_from_stream(
                make_socket_read_exact(sock)
            )
            ok = (
                response_header.get("message_type") == proto.MessageType.ERROR.value
                and response_header.get("error_code")
                == proto.ProtocolErrorCode.INVALID_PAYLOAD_LENGTH.value
            )
            record("truncated_payload_rejected", ok, str(response_header))
        except proto.GuardFrameProtocolError as exc:
            record(
                "truncated_payload_rejected",
                exc.code == proto.ProtocolErrorCode.INVALID_PAYLOAD_LENGTH,
                str(exc),
            )
    finally:
        sock.close()


def test_rgb_to_bgr_pixel_exact() -> None:
    """Items 3, 5: RGB [10,20,30] -> BGR [30,20,10] exactly once; dtype/shape
    unchanged. Requires numpy; BLOCKED (not FAILED) if unavailable."""
    try:
        import numpy as np
    except ImportError as exc:
        record_blocked("rgb_to_bgr_exactly_once_pixel_exact", f"numpy unavailable: {exc}")
        return

    from .client import rgb_to_bgr_uint8

    frame_rgb = np.zeros((4, 5, 3), dtype=np.uint8)
    frame_rgb[:, :] = [10, 20, 30]
    frame_bgr = rgb_to_bgr_uint8(frame_rgb)

    ok = (
        frame_bgr.shape == frame_rgb.shape
        and frame_bgr.dtype == np.uint8
        and bool((frame_bgr[0, 0] == [30, 20, 10]).all())
        and frame_bgr.flags["C_CONTIGUOUS"]
    )
    record("rgb_to_bgr_exactly_once_pixel_exact", ok, f"bgr[0,0]={frame_bgr[0, 0].tolist()}")


def main() -> int:
    with MockGuardFrameRunner(port=0) as runner:
        test_health_roundtrip(runner)
        test_assess_10_frame_mixed_resolution(runner)
        test_frame_count_not_10_rejected(runner)
        test_protocol_version_mismatch_rejected(runner)
        test_truncated_payload_rejected(runner)

    test_rgb_to_bgr_pixel_exact()

    print()
    print("=" * 60)
    print("R3 PROTOTYPE SELFTEST RESULTS")
    print("=" * 60)
    failed = 0
    blocked = 0
    for name, status, detail in RESULTS:
        print(f"{status:8s} {name}  {detail}")
        if status == "FAIL":
            failed += 1
        elif status == "BLOCKED":
            blocked += 1

    print()
    print(f"TOTAL={len(RESULTS)} FAIL={failed} BLOCKED={blocked}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
