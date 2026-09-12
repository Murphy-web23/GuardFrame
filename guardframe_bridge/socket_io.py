"""Socket <-> byte-exact-read adapter, kept separate from wire parsing.

Both `client.py` and `mock_runner.py` use `make_socket_read_exact` to turn a
real TCP socket into the `read_exact(n) -> bytes` callable that
`protocol.read_message_from_stream` expects. `protocol.py` itself never
imports `socket`, so it stays testable with in-memory buffers.
"""
from __future__ import annotations

import socket

from . import protocol as proto


def make_socket_read_exact(sock: socket.socket) -> proto.ReadExact:
    def _read_exact(n: int) -> bytes:
        if n == 0:
            return b""
        chunks: list[bytes] = []
        remaining = n
        try:
            while remaining > 0:
                chunk = sock.recv(remaining)
                if not chunk:
                    raise proto.GuardFrameProtocolError(
                        proto.ProtocolErrorCode.INVALID_PAYLOAD_LENGTH,
                        f"connection closed after {n - remaining} of {n} expected bytes",
                    )
                chunks.append(chunk)
                remaining -= len(chunk)
        except socket.timeout as exc:
            raise proto.GuardFrameProtocolError(
                proto.ProtocolErrorCode.TIMEOUT, f"timed out reading {n} bytes"
            ) from exc
        return b"".join(chunks)

    return _read_exact
