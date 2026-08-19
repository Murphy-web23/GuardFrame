"""POST /api/id-card/rectify 的測試（§4.7、§5.5）。無狀態端點，不碰
資料庫，不需要 requires_db 這套 skip 機制，隨時能跑。
"""

import base64
import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

import config
from api.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _draw_card(size=1000, angle_deg=8.0, w=428, h=270, color=(200, 200, 200)):
    """跟 tests/test_id_card.py 同一套合成卡片畫法。"""
    img = np.zeros((size, size, 3), dtype=np.uint8)
    center = (size / 2.0, size / 2.0)
    box = cv2.boxPoints(((center[0], center[1]), (w, h), angle_deg))
    cv2.fillConvexPoly(img, box.astype(np.int32), color)
    return img


def _encode_jpeg(img):
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return BytesIO(buf.tobytes())


def test_rectify_succeeds_and_returns_base64_image(client):
    jpeg = _encode_jpeg(_draw_card())
    response = client.post(
        "/api/id-card/rectify", files={"image": ("card.jpg", jpeg, "image/jpeg")}
    )
    assert response.status_code == 200
    body = response.json()

    assert body["success"] is True
    assert body["message"] == ""
    assert len(body["corners"]) == 4
    assert body["confidence"] > 0.7

    assert body["rectified"].startswith("data:image/jpeg;base64,")
    raw = base64.b64decode(body["rectified"].split(",", 1)[1])
    decoded = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == (config.ID_CARD_OUTPUT_HEIGHT, config.ID_CARD_OUTPUT_WIDTH, 3)


def test_rectify_fails_on_blank_image_without_leaking_any_image_data(client):
    blank = np.zeros((200, 200, 3), dtype=np.uint8)
    jpeg = _encode_jpeg(blank)
    response = client.post(
        "/api/id-card/rectify", files={"image": ("blank.jpg", jpeg, "image/jpeg")}
    )
    assert response.status_code == 200
    body = response.json()

    assert body["success"] is False
    assert body["rectified"] is None
    assert body["corners"] is None
    assert body["confidence"] == 0.0
    assert body["message"] != ""


def test_rectify_handles_garbage_bytes_without_crashing(client):
    garbage = BytesIO(b"not a real image file")
    response = client.post(
        "/api/id-card/rectify", files={"image": ("garbage.jpg", garbage, "image/jpeg")}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert body["rectified"] is None
