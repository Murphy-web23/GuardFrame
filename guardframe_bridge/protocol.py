"""GF_TRACK1_TCP_V1 wire protocol: framing, validation, message builders.

Transport-agnostic on purpose: every function here takes or returns plain
`dict`/`bytes`/a caller-supplied `read_exact(n) -> bytes` callable, never a
`socket.socket`. Socket-specific I/O lives in `socket_io.py` so this module
can be exercised with in-memory buffers in tests.

R3 prototype only. Not wired into any production teammate code path
(api/routes.py, track1_synthetic/detector.py) yet, and does not touch the
portable GuardFrame runtime or any model.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Sequence

PROTOCOL_VERSION = "GF_TRACK1_TCP_V1"

MAGIC = b"GFT1"
MAGIC_LENGTH = len(MAGIC)
HEADER_LENGTH_FIELD_SIZE = 4  # unsigned big-endian uint32 prefix for the JSON header length

# Centralized network + payload safety limits for this prototype. Import
# these rather than hardcoding alternates elsewhere.
DEFAULT_BIND_ADDRESS = "127.0.0.1"
DEFAULT_PORT = 48173
MAX_HEADER_BYTES = 65_536  # 64 KiB: JSON metadata only, never carries pixel data
MAX_REQUEST_BYTES = 512 * 1024 * 1024  # 512 MiB: bounds full-resolution 10-frame payloads

FIXED_ASSESS_FRAME_COUNT = 10
REQUIRED_DTYPE = "uint8"
REQUIRED_CHANNELS = 3
REQUIRED_ASSESS_COLOR_ORDER = "BGR"

MOCK_SOURCE_MARKER = "MOCK_GUARDFRAME_RUNNER"

ReadExact = Callable[[int], bytes]


class MessageType(str, Enum):
    HEALTH = "health"
    HEALTH_RESPONSE = "health_response"
    ASSESS = "assess"
    ASSESS_RESPONSE = "assess_response"
    ERROR = "error"


class ProtocolErrorCode(str, Enum):
    PROTOCOL_VERSION_MISMATCH = "PROTOCOL_VERSION_MISMATCH"
    INVALID_FRAME_COUNT = "INVALID_FRAME_COUNT"
    INVALID_DTYPE = "INVALID_DTYPE"
    INVALID_SHAPE = "INVALID_SHAPE"
    INVALID_COLOR_ORDER = "INVALID_COLOR_ORDER"
    INVALID_PAYLOAD_LENGTH = "INVALID_PAYLOAD_LENGTH"
    MALFORMED_HEADER = "MALFORMED_HEADER"
    REQUEST_TOO_LARGE = "REQUEST_TOO_LARGE"
    TIMEOUT = "TIMEOUT"
    CONNECTION_REFUSED = "CONNECTION_REFUSED"
    RUNNER_INTERNAL_ERROR = "RUNNER_INTERNAL_ERROR"


class GuardFrameProtocolError(Exception):
    def __init__(self, code: ProtocolErrorCode, message: str) -> None:
        super().__init__(f"{code.value}: {message}")
        self.code = code
        self.message = message


@dataclass(frozen=True)
class FrameMeta:
    height: int
    width: int
    channels: int
    nbytes: int

    def to_dict(self) -> dict:
        return {
            "height": self.height,
            "width": self.width,
            "channels": self.channels,
            "nbytes": self.nbytes,
        }

    @staticmethod
    def from_dict(data: dict) -> "FrameMeta":
        try:
            return FrameMeta(
                height=int(data["height"]),
                width=int(data["width"]),
                channels=int(data["channels"]),
                nbytes=int(data["nbytes"]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise GuardFrameProtocolError(
                ProtocolErrorCode.MALFORMED_HEADER,
                f"invalid frame metadata entry: {exc}",
            ) from exc


def pack_message(header: dict, payload: bytes = b"") -> bytes:
    header_bytes = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(header_bytes) > MAX_HEADER_BYTES:
        raise GuardFrameProtocolError(
            ProtocolErrorCode.MALFORMED_HEADER,
            f"header is {len(header_bytes)} bytes, exceeds MAX_HEADER_BYTES={MAX_HEADER_BYTES}",
        )
    total = MAGIC_LENGTH + HEADER_LENGTH_FIELD_SIZE + len(header_bytes) + len(payload)
    if total > MAX_REQUEST_BYTES:
        raise GuardFrameProtocolError(
            ProtocolErrorCode.REQUEST_TOO_LARGE,
            f"message is {total} bytes, exceeds MAX_REQUEST_BYTES={MAX_REQUEST_BYTES}",
        )
    return b"".join(
        [
            MAGIC,
            len(header_bytes).to_bytes(HEADER_LENGTH_FIELD_SIZE, "big", signed=False),
            header_bytes,
            payload,
        ]
    )


def read_message_from_stream(read_exact: ReadExact) -> tuple[dict, bytes]:
    """Read one framed message using a caller-supplied exact-byte reader.

    `read_exact(n)` must return exactly n bytes or raise `GuardFrameProtocolError`;
    this keeps parsing independent of the transport (real socket vs. an
    in-memory buffer in tests).
    """
    magic = read_exact(MAGIC_LENGTH)
    if magic != MAGIC:
        raise GuardFrameProtocolError(ProtocolErrorCode.MALFORMED_HEADER, f"bad magic: {magic!r}")

    header_len = int.from_bytes(read_exact(HEADER_LENGTH_FIELD_SIZE), "big", signed=False)
    if header_len > MAX_HEADER_BYTES:
        raise GuardFrameProtocolError(
            ProtocolErrorCode.MALFORMED_HEADER,
            f"declared header length {header_len} exceeds MAX_HEADER_BYTES={MAX_HEADER_BYTES}",
        )

    header_bytes = read_exact(header_len)
    try:
        header = json.loads(header_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GuardFrameProtocolError(
            ProtocolErrorCode.MALFORMED_HEADER, f"invalid JSON header: {exc}"
        ) from exc
    if not isinstance(header, dict):
        raise GuardFrameProtocolError(
            ProtocolErrorCode.MALFORMED_HEADER, "header JSON is not an object"
        )

    payload_len = _expected_payload_length(header)
    if payload_len > MAX_REQUEST_BYTES:
        raise GuardFrameProtocolError(
            ProtocolErrorCode.REQUEST_TOO_LARGE,
            f"declared payload length {payload_len} exceeds MAX_REQUEST_BYTES={MAX_REQUEST_BYTES}",
        )
    payload = read_exact(payload_len) if payload_len else b""
    return header, payload


def _expected_payload_length(header: dict) -> int:
    frames = header.get("frames") or []
    return sum(FrameMeta.from_dict(entry).nbytes for entry in frames)


def validate_common_header(header: dict) -> None:
    if header.get("protocol_version") != PROTOCOL_VERSION:
        raise GuardFrameProtocolError(
            ProtocolErrorCode.PROTOCOL_VERSION_MISMATCH,
            f"expected {PROTOCOL_VERSION!r}, got {header.get('protocol_version')!r}",
        )
    if not header.get("request_id"):
        raise GuardFrameProtocolError(ProtocolErrorCode.MALFORMED_HEADER, "missing request_id")


def validate_health_request(header: dict) -> None:
    validate_common_header(header)
    if header.get("message_type") != MessageType.HEALTH.value:
        raise GuardFrameProtocolError(
            ProtocolErrorCode.MALFORMED_HEADER,
            f"expected message_type={MessageType.HEALTH.value!r}",
        )


def validate_assess_request(header: dict, payload: bytes) -> list[FrameMeta]:
    validate_common_header(header)

    if header.get("message_type") != MessageType.ASSESS.value:
        raise GuardFrameProtocolError(
            ProtocolErrorCode.MALFORMED_HEADER,
            f"expected message_type={MessageType.ASSESS.value!r}",
        )
    if header.get("dtype") != REQUIRED_DTYPE:
        raise GuardFrameProtocolError(
            ProtocolErrorCode.INVALID_DTYPE,
            f"expected dtype={REQUIRED_DTYPE!r}, got {header.get('dtype')!r}",
        )
    if header.get("color_order") != REQUIRED_ASSESS_COLOR_ORDER:
        raise GuardFrameProtocolError(
            ProtocolErrorCode.INVALID_COLOR_ORDER,
            f"expected color_order={REQUIRED_ASSESS_COLOR_ORDER!r}, got {header.get('color_order')!r}",
        )

    frames_raw = header.get("frames")
    frame_count = header.get("frame_count")
    if not isinstance(frames_raw, list) or frame_count != len(frames_raw):
        raise GuardFrameProtocolError(
            ProtocolErrorCode.MALFORMED_HEADER,
            "frame_count does not match length of frames[]",
        )
    if frame_count != FIXED_ASSESS_FRAME_COUNT:
        raise GuardFrameProtocolError(
            ProtocolErrorCode.INVALID_FRAME_COUNT,
            f"expected frame_count={FIXED_ASSESS_FRAME_COUNT}, got {frame_count}",
        )

    frames = [FrameMeta.from_dict(entry) for entry in frames_raw]
    for index, meta in enumerate(frames):
        if meta.channels != REQUIRED_CHANNELS:
            raise GuardFrameProtocolError(
                ProtocolErrorCode.INVALID_SHAPE,
                f"frame[{index}] channels={meta.channels}, expected {REQUIRED_CHANNELS}",
            )
        if meta.height <= 0 or meta.width <= 0:
            raise GuardFrameProtocolError(
                ProtocolErrorCode.INVALID_SHAPE,
                f"frame[{index}] has non-positive dimensions ({meta.height}x{meta.width})",
            )
        if meta.nbytes != meta.height * meta.width * meta.channels:
            raise GuardFrameProtocolError(
                ProtocolErrorCode.INVALID_SHAPE,
                f"frame[{index}] nbytes={meta.nbytes} != height*width*channels="
                f"{meta.height * meta.width * meta.channels}",
            )

    expected_payload_len = sum(meta.nbytes for meta in frames)
    if len(payload) != expected_payload_len:
        raise GuardFrameProtocolError(
            ProtocolErrorCode.INVALID_PAYLOAD_LENGTH,
            f"payload is {len(payload)} bytes, expected {expected_payload_len}",
        )

    return frames


def build_health_request(request_id: str) -> dict:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "message_type": MessageType.HEALTH.value,
        "request_id": request_id,
    }


def build_health_response(request_id: str) -> dict:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "message_type": MessageType.HEALTH_RESPONSE.value,
        "request_id": request_id,
        "source": MOCK_SOURCE_MARKER,
        "status": "ready",
    }


def build_assess_request_header(request_id: str, frames: Sequence[FrameMeta]) -> dict:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "message_type": MessageType.ASSESS.value,
        "request_id": request_id,
        "frame_count": len(frames),
        "dtype": REQUIRED_DTYPE,
        "color_order": REQUIRED_ASSESS_COLOR_ORDER,
        "frames": [meta.to_dict() for meta in frames],
    }


def build_mock_assess_response(request_id: str) -> dict:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "message_type": MessageType.ASSESS_RESPONSE.value,
        "request_id": request_id,
        "source": MOCK_SOURCE_MARKER,
        "fakeProbability": 0.5,
        "topSignals": [
            {"label": "MOCK_ONLY_1", "weight": 0.9},
            {"label": "MOCK_ONLY_2", "weight": 0.6},
            {"label": "MOCK_ONLY_3", "weight": 0.3},
        ],
    }


def build_error_response(request_id: str, code: ProtocolErrorCode, message: str) -> dict:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "message_type": MessageType.ERROR.value,
        "request_id": request_id,
        "source": MOCK_SOURCE_MARKER,
        "error_code": code.value,
        "error_message": message,
    }
