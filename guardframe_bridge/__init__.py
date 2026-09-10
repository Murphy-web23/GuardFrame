"""Prototype-only GuardFrame TCP bridge for Track 1 synthetic detection.

R3 scope: wire protocol (protocol.py), a socket adapter (socket_io.py), a
teammate-side TCP client (client.py), and a real loopback TCP mock runner
(mock_runner.py). Independent of production teammate code — not wired into
api/routes.py or track1_synthetic/detector.py yet — and independent of the
portable GuardFrame runtime (no SCRFD/CropB35/DINOv2/SigLIP2/CUDA here).

See GF_V3_TEAMMATE_GUARDFRAME_INTEGRATION_R3_TCP_MOCK_PROTOTYPE_RETURN.md
for scope and verification status.
"""
from .client import GuardFrameBridgeClient, rgb_to_bgr_uint8
from .mock_runner import MockGuardFrameRunner
from .protocol import (
    DEFAULT_BIND_ADDRESS,
    DEFAULT_PORT,
    FIXED_ASSESS_FRAME_COUNT,
    MAX_HEADER_BYTES,
    MAX_REQUEST_BYTES,
    MOCK_SOURCE_MARKER,
    PROTOCOL_VERSION,
    FrameMeta,
    GuardFrameProtocolError,
    MessageType,
    ProtocolErrorCode,
)

__all__ = [
    "PROTOCOL_VERSION",
    "DEFAULT_BIND_ADDRESS",
    "DEFAULT_PORT",
    "MAX_HEADER_BYTES",
    "MAX_REQUEST_BYTES",
    "FIXED_ASSESS_FRAME_COUNT",
    "MOCK_SOURCE_MARKER",
    "MessageType",
    "ProtocolErrorCode",
    "GuardFrameProtocolError",
    "FrameMeta",
    "GuardFrameBridgeClient",
    "rgb_to_bgr_uint8",
    "MockGuardFrameRunner",
]
