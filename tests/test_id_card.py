"""image_utils/id_card.py 的測試。

用程式畫的矩形色塊模擬「乾淨背景上的一張卡片」，Canny 能抓出清楚邊緣，
不需要真的相機或真的證件照片。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np
import pytest

import config
from image_utils import id_card


def _draw_card(size=1000, angle_deg=8.0, w=428, h=270, color=(200, 200, 200)):
    """畫一張背景全黑、中央有一個（可旋轉的）矩形卡片的合成測試圖。"""
    img = np.zeros((size, size, 3), dtype=np.uint8)
    center = (size / 2.0, size / 2.0)
    box = cv2.boxPoints(((center[0], center[1]), (w, h), angle_deg))
    cv2.fillConvexPoly(img, box.astype(np.int32), color)
    return img


# --------------------------------------------------------------------------
# _order_corners
# --------------------------------------------------------------------------


def test_order_corners_sorts_shuffled_points():
    # 打亂順序：右上、左上、右下、左下
    pts = np.array([[10.0, 0.0], [0.0, 0.0], [10.0, 10.0], [0.0, 10.0]])
    tl, tr, br, bl = id_card._order_corners(pts)
    assert tl.tolist() == [0.0, 0.0]
    assert tr.tolist() == [10.0, 0.0]
    assert br.tolist() == [10.0, 10.0]
    assert bl.tolist() == [0.0, 10.0]


# --------------------------------------------------------------------------
# _compute_confidence
# --------------------------------------------------------------------------


def test_compute_confidence_high_for_standard_id_ratio():
    w, h = config.ID_CARD_OUTPUT_WIDTH, config.ID_CARD_OUTPUT_HEIGHT
    ordered = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float64)
    assert id_card._compute_confidence(ordered) == pytest.approx(1.0, abs=0.01)


def test_compute_confidence_lower_for_square():
    ordered = np.array([[0, 0], [100, 0], [100, 100], [0, 100]], dtype=np.float64)
    assert id_card._compute_confidence(ordered) < 0.7


def test_compute_confidence_zero_for_degenerate_points():
    ordered = np.array([[0, 0], [0, 0], [0, 0], [0, 0]], dtype=np.float64)
    assert id_card._compute_confidence(ordered) == 0.0


# --------------------------------------------------------------------------
# rectify_id_card：端到端
# --------------------------------------------------------------------------


def test_rectify_id_card_succeeds_on_clean_rectangle():
    img = _draw_card()
    result = id_card.rectify_id_card(img)

    assert result["success"] is True
    assert result["message"] == ""
    assert result["rectified"] is not None
    assert result["rectified"].shape == (
        config.ID_CARD_OUTPUT_HEIGHT,
        config.ID_CARD_OUTPUT_WIDTH,
        3,
    )
    assert result["corners"] is not None
    assert len(result["corners"]) == 4
    assert result["confidence"] > 0.7


def test_rectify_id_card_works_regardless_of_rotation():
    for angle in (0.0, 15.0, -20.0, 45.0):
        result = id_card.rectify_id_card(_draw_card(angle_deg=angle))
        assert result["success"] is True, f"angle={angle} 應該要能偵測到"


def test_rectify_id_card_fails_on_blank_image():
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    result = id_card.rectify_id_card(img)

    assert result["success"] is False
    assert result["rectified"] is None
    assert result["corners"] is None
    assert result["confidence"] == 0.0
    assert result["message"] != ""


def test_rectify_id_card_handles_none_image():
    result = id_card.rectify_id_card(None)
    assert result["success"] is False
    assert result["message"] != ""


def test_rectify_id_card_handles_empty_array():
    result = id_card.rectify_id_card(np.array([]))
    assert result["success"] is False
    assert result["message"] != ""


def test_rectify_id_card_never_raises_on_garbage_input():
    """故意丟一張沒有證件的雜訊圖，程式不該掛掉（PLAN.md B任務二的完成標準）。"""
    rng = np.random.default_rng(0)
    noisy = rng.integers(0, 255, size=(300, 300, 3), dtype=np.uint8)
    result = id_card.rectify_id_card(noisy)
    assert isinstance(result, dict)
    assert "success" in result
