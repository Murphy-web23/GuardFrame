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
    """跟 tests/test_id_card.py 同一套合成卡片畫法（含模擬印刷文字、
    中灰背景，見該檔案 `_draw_card()` 的說明——`rectify_id_card()`
    新增了文字密度檢查跟亮度檢查，純色矩形／全黑背景不再算成功）。"""
    img = np.full((size, size, 3), 90, dtype=np.uint8)
    center = (size / 2.0, size / 2.0)

    card_left = int(center[0] - w / 2)
    card_top = int(center[1] - h / 2)
    cv2.rectangle(
        img, (card_left, card_top), (card_left + w, card_top + h), color, thickness=-1
    )

    text_color = (60, 60, 60)
    rng = np.random.default_rng(0)
    for row in range(6):
        y = card_top + 20 + row * 35
        x = card_left + 20
        for col in range(8):
            cell_w = int(rng.integers(10, 22))
            cv2.rectangle(img, (x, y), (x + cell_w, y + 14), text_color, thickness=-1)
            x += cell_w + int(rng.integers(6, 14))
            if x > card_left + w - 20:
                break

    if angle_deg != 0.0:
        matrix = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
        img = cv2.warpAffine(img, matrix, (size, size), borderValue=(0, 0, 0))

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
