"""TCP client for the GF_TRACK1_TCP_V1 prototype bridge.

Windows teammate backend side. This module owns the single point where
sampled RGB frames are converted to BGR before crossing the wire — see
`rgb_to_bgr_uint8`. No resize, face detection, CropB35, or model
preprocessing happens here; that all stays inside the (future) portable
GuardFrame runtime, on the far side of this bridge.

numpy is imported lazily inside `rgb_to_bgr_uint8`/`_frame_meta` call sites
rather than at module level, so this module (and package import) does not
require numpy to be installed just to exercise health()/protocol paths.
"""
from __future__ import annotations

import socket
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Sequence

from . import protocol as proto
from .socket_io import make_socket_read_exact

if TYPE_CHECKING:
    import numpy as np


def rgb_to_bgr_uint8(frame_rgb: "np.ndarray") -> "np.ndarray":
    """Convert one full-resolution RGB uint8 HWC frame to BGR uint8 HWC.

    Swaps channels 0 and 2 only: no resize, no dtype change, no
    normalization. This is the single, exclusive RGB->BGR conversion point
    for frames crossing the teammate -> GuardFrame bridge
    (BRIDGE_COLOR_CONVERSION_COUNT = EXACTLY_ONCE). Do not add a second
    channel-reversal anywhere else in the bridge or client code.
    """
    import numpy as np

    if frame_rgb.dtype != np.uint8:
        raise ValueError(f"expected uint8 frame, got dtype={frame_rgb.dtype}")
    if frame_rgb.ndim != 3 or frame_rgb.shape[2] != 3:
        raise ValueError(f"expected HWC RGB frame with 3 channels, got shape={frame_rgb.shape}")
    return np.ascontiguousarray(frame_rgb[:, :, ::-1])


def _frame_meta(frame_bgr: "np.ndarray") -> proto.FrameMeta:
    height, width, channels = frame_bgr.shape
    return proto.FrameMeta(height=height, width=width, channels=channels, nbytes=frame_bgr.nbytes)


@dataclass
class GuardFrameBridgeClient:
    """Short-lived-connection-per-call client for the mock/real GuardFrame TCP runner."""

    host: str = proto.DEFAULT_BIND_ADDRESS
    port: int = proto.DEFAULT_PORT
    timeout_seconds: float = 10.0

    def _connect(self) -> socket.socket:
        try:
            sock = socket.create_connection((self.host, self.port), timeout=self.timeout_seconds)
        except ConnectionRefusedError as exc:
            raise proto.GuardFrameProtocolError(
                proto.ProtocolErrorCode.CONNECTION_REFUSED,
                f"connection refused at {self.host}:{self.port}",
            ) from exc
        except socket.timeout as exc:
            raise proto.GuardFrameProtocolError(
                proto.ProtocolErrorCode.TIMEOUT,
                f"timed out connecting to {self.host}:{self.port}",
            ) from exc
        sock.settimeout(self.timeout_seconds)
        return sock

    def _send_and_receive(
        self, header: dict, expected_message_type: str, payload: bytes = b""
    ) -> dict:
        request_id = header["request_id"]
        message = proto.pack_message(header, payload)
        sock = self._connect()
        try:
            response_header, _response_payload = self._transmit(sock, message)
        finally:
            sock.close()

        self._validate_response_identity(response_header, request_id, expected_message_type)
        return response_header

    @staticmethod
    def _transmit(sock: socket.socket, message: bytes) -> tuple[dict, bytes]:
        """sendall + read one framed response, with transport failures normalized.

        socket.timeout -> TIMEOUT. Any other OSError raised after a
        successful connect (connection reset, broken pipe, etc.) -> the
        closest existing transport-failure code, CONNECTION_REFUSED (see
        R3 Return for the documented mapping rationale). Errors already
        raised as GuardFrameProtocolError (e.g. from read_message_from_stream)
        pass through unchanged.
        """
        try:
            sock.sendall(message)
            return proto.read_message_from_stream(make_socket_read_exact(sock))
        except proto.GuardFrameProtocolError:
            raise
        except socket.timeout as exc:
            raise proto.GuardFrameProtocolError(
                proto.ProtocolErrorCode.TIMEOUT, "timed out communicating with runner"
            ) from exc
        except OSError as exc:
            raise proto.GuardFrameProtocolError(
                proto.ProtocolErrorCode.CONNECTION_REFUSED,
                f"transport failure communicating with runner: {exc}",
            ) from exc

    @staticmethod
    def _validate_response_identity(
        response_header: dict, request_id: str, expected_message_type: str
    ) -> None:
        if response_header.get("protocol_version") != proto.PROTOCOL_VERSION:
            raise proto.GuardFrameProtocolError(
                proto.ProtocolErrorCode.PROTOCOL_VERSION_MISMATCH,
                f"response protocol_version={response_header.get('protocol_version')!r}, "
                f"expected {proto.PROTOCOL_VERSION!r}",
            )

        response_request_id = response_header.get("request_id")
        if not response_request_id or response_request_id != request_id:
            raise proto.GuardFrameProtocolError(
                proto.ProtocolErrorCode.MALFORMED_HEADER,
                f"response request_id={response_request_id!r} does not match "
                f"request request_id={request_id!r}",
            )

        message_type = response_header.get("message_type")
        if message_type == proto.MessageType.ERROR.value:
            raw_code = response_header.get("error_code")
            try:
                code = proto.ProtocolErrorCode(raw_code)
            except (ValueError, TypeError):
                code = proto.ProtocolErrorCode.RUNNER_INTERNAL_ERROR
            raise proto.GuardFrameProtocolError(
                code, response_header.get("error_message", "unspecified runner error")
            )

        if message_type != expected_message_type:
            raise proto.GuardFrameProtocolError(
                proto.ProtocolErrorCode.MALFORMED_HEADER,
                f"unexpected response message_type={message_type!r}, "
                f"expected {expected_message_type!r}",
            )

    def health(self) -> dict:
        request_id = str(uuid.uuid4())
        header = proto.build_health_request(request_id)
        return self._send_and_receive(header, proto.MessageType.HEALTH_RESPONSE.value)

    def assess(self, frames_rgb: Sequence["np.ndarray"]) -> dict:
        """Send full-resolution RGB frames; converts each to BGR exactly once."""
        if len(frames_rgb) != proto.FIXED_ASSESS_FRAME_COUNT:
            raise proto.GuardFrameProtocolError(
                proto.ProtocolErrorCode.INVALID_FRAME_COUNT,
                f"expected {proto.FIXED_ASSESS_FRAME_COUNT} frames, got {len(frames_rgb)}",
            )

        frames_bgr = [rgb_to_bgr_uint8(frame) for frame in frames_rgb]
        metas = [_frame_meta(frame) for frame in frames_bgr]
        request_id = str(uuid.uuid4())
        header = proto.build_assess_request_header(request_id, metas)
        payload = b"".join(frame.tobytes() for frame in frames_bgr)

        return self._send_and_receive(
            header,
            proto.MessageType.ASSESS_RESPONSE.value,
            payload,
        )
