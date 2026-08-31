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
    """畫一張背景中灰、中央有一個（可旋轉的）矩形卡片的合成測試圖。

    2026-08-27：`rectify_id_card()` 新增了文字密度檢查（見
    `image_utils/id_card.py` `_count_text_regions()` 的說明），純色
    矩形不再算成功——這裡在卡片內部畫幾排小色塊模擬印刷文字欄位，
    讓這個 fixture 繼續代表「像證件的東西」，不是在繞過新加的檢查。

    2026-08-27：同時新增了亮度檢查（`config.ID_CARD_MIN_BRIGHTNESS`），
    背景改成全黑的話，整張圖平均亮度會被大面積黑背景拉到門檻以下——
    背景改成中灰色，這個 fixture 才能同時代表「一張合理曝光的照片」。
    """
    img = np.full((size, size, 3), 90, dtype=np.uint8)
    center = (size / 2.0, size / 2.0)

    # 先在角度 0（軸對齊）畫卡片本體＋文字，最後才整張圖一起旋轉——
    # 這樣文字一定落在卡片矩形內部，不用另外處理旋轉座標轉換。
    card_left = int(center[0] - w / 2)
    card_top = int(center[1] - h / 2)
    cv2.rectangle(
        img,
        (card_left, card_top),
        (card_left + w, card_top + h),
        color,
        thickness=-1,
    )
    text_color = (60, 60, 60)
    rng = np.random.default_rng(0)
    for row in range(6):
        y = card_top + 20 + row * 35
        x = card_left + 20
        for col in range(8):
            cell_w = int(rng.integers(10, 22))
            cv2.rectangle(
                img, (x, y), (x + cell_w, y + 14), text_color, thickness=-1
            )
            x += cell_w + int(rng.integers(6, 14))
            if x > card_left + w - 20:
                break

    if angle_deg != 0.0:
        matrix = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
        img = cv2.warpAffine(img, matrix, (size, size), borderValue=(0, 0, 0))

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
