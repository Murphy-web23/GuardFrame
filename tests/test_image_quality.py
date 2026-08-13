"""影像品質檢查（CONVENTIONS.md §4.7）的驗證。

用程式生成的測試圖，不需要真實人臉照片。
臉部偵測的部分獨立出來：InsightFace 第一次使用會下載約 300MB 的模型，
測試裡一律停用，改成驗證「拿不到臉部框時其餘指標仍算得出數字」。
"""

import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config
from image_utils import quality

CONTRACT_KEYS = {
    "passed",
    "blurScore",
    "brightness",
    "contrast",
    "overexposedRatio",
    "faceRatio",
    "message",
}

H, W = 240, 320


@pytest.fixture(autouse=True)
def no_insightface(monkeypatch):
    """停用 InsightFace，避免測試觸發模型下載。"""
    monkeypatch.setattr(quality, "_get_face_app", lambda: None)


def make_sharp_image(brightness=128, contrast=60):
    """棋盤格 + 雜訊，模擬對焦準確、細節豐富的畫面。"""
    rng = np.random.default_rng(0)
    yy, xx = np.mgrid[0:H, 0:W]
    checker = (((yy // 8) + (xx // 8)) % 2) * 2.0 - 1.0
    gray = brightness + checker * contrast + rng.normal(0, 3, (H, W))
    gray = np.clip(gray, 0, 255).astype(np.uint8)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2RGB)


def assert_matches_contract(result):
    assert set(result) == CONTRACT_KEYS, f"欄位對不上：{set(result) ^ CONTRACT_KEYS}"
    assert isinstance(result["passed"], bool)
    for key in ("blurScore", "brightness", "contrast", "overexposedRatio", "faceRatio"):
        assert isinstance(result[key], float), f"{key} 應該是 float"
        assert np.isfinite(result[key]), f"{key} 算出 {result[key]}"
    assert isinstance(result["message"], str)
    assert 0.0 <= result["overexposedRatio"] <= 1.0
    assert 0.0 <= result["faceRatio"] <= 1.0


# --------------------------------------------------------------------------
# 四項指標都要算得出數字
# --------------------------------------------------------------------------


def test_all_metrics_produce_numbers():
    """清晰的測試圖：模糊度、亮度、對比度、過曝比例四項都要有合理數值。"""
    result = quality.check_image_quality([make_sharp_image()] * 3)

    assert_matches_contract(result)
    assert result["blurScore"] > config.QUALITY_BLUR_MIN
    assert config.QUALITY_BRIGHTNESS_MIN < result["brightness"] < config.QUALITY_BRIGHTNESS_MAX
    assert result["contrast"] > config.QUALITY_CONTRAST_MIN
    assert result["overexposedRatio"] < config.QUALITY_OVEREXPOSED_MAX


def test_blur_score_separates_sharp_from_blurred():
    """失焦畫面的 Laplacian 變異數要明顯低於清晰畫面。"""
    sharp = make_sharp_image()
    blurred = cv2.GaussianBlur(sharp, (31, 31), 10)

    sharp_score = quality.check_image_quality([sharp])["blurScore"]
    blurred_score = quality.check_image_quality([blurred])["blurScore"]

    assert sharp_score > config.QUALITY_BLUR_MIN
    assert blurred_score < config.QUALITY_BLUR_MIN
    assert sharp_score > blurred_score * 10


@pytest.mark.parametrize(
    "level, expect_reason",
    [(20, "過暗"), (240, "過亮")],
)
def test_brightness_out_of_range_is_rejected(level, expect_reason):
    """太暗或太亮都要退回，並在 message 說清楚是哪一種。"""
    flat = np.full((H, W, 3), level, dtype=np.uint8)

    result = quality.check_image_quality([flat])

    assert result["passed"] is False
    assert result["brightness"] == pytest.approx(level, abs=1.0)
    assert expect_reason in result["message"]


def test_overexposed_ratio_counts_blown_pixels():
    """過曝比例要對得上實際的死白像素佔比。"""
    img = make_sharp_image()
    img[: H // 2] = 255  # 上半部整片死白

    result = quality.check_image_quality([img])

    assert result["overexposedRatio"] == pytest.approx(0.5, abs=0.02)
    assert result["passed"] is False
    assert "過曝" in result["message"]


def test_low_contrast_is_rejected():
    """對比不足（例如逆光糊成一片灰）要退回。"""
    rng = np.random.default_rng(1)
    flat = np.clip(128 + rng.normal(0, 2, (H, W)), 0, 255).astype(np.uint8)

    result = quality.check_image_quality([cv2.cvtColor(flat, cv2.COLOR_GRAY2RGB)] * 3)

    assert result["contrast"] < config.QUALITY_CONTRAST_MIN
    assert result["passed"] is False
    assert "對比" in result["message"]


# --------------------------------------------------------------------------
# 容錯
# --------------------------------------------------------------------------


def test_empty_frames_does_not_crash():
    result = quality.check_image_quality([])

    assert_matches_contract(result)
    assert result["passed"] is False
    assert result["message"]


def test_face_ratio_zero_when_detector_unavailable():
    """InsightFace 不可用時 faceRatio 給 0.0，其餘指標照算。

    臉部偵測掛掉不該讓整個品質檢查失效 —— 前四項指標仍然有診斷價值。
    """
    result = quality.check_image_quality([make_sharp_image()])

    assert result["faceRatio"] == 0.0
    assert result["blurScore"] > 0
    assert "臉部太小或未入鏡" in result["message"]


def test_grayscale_input_does_not_crash():
    """萬一收到單通道影像也要能處理。"""
    gray = np.full((H, W), 128, dtype=np.uint8)

    result = quality.check_image_quality([gray])

    assert_matches_contract(result)


def test_passed_requires_every_criterion():
    """任何一項不合格，passed 就是 False，且 message 不為空。"""
    good = make_sharp_image()
    result = quality.check_image_quality([good])

    # 這張圖唯一不合格的是 faceRatio（偵測器停用），所以應該被擋下
    assert result["passed"] is False
    assert result["message"]


def test_message_empty_when_everything_passes(monkeypatch):
    """全部合格時 message 要是空字串（§5.1 的範例就是 ""）。"""
    monkeypatch.setattr(quality, "_largest_face_ratio", lambda frame: 0.31)

    result = quality.check_image_quality([make_sharp_image()] * 3)

    assert result["passed"] is True
    assert result["message"] == ""
    assert result["faceRatio"] == pytest.approx(0.31)


def test_samples_multiple_frames():
    """指標取多格的中位數，單一格失焦不該讓整段被判不合格。"""
    frames = [make_sharp_image()] * 9
    frames.insert(4, cv2.GaussianBlur(frames[0], (31, 31), 10))  # 混一格失焦的

    result = quality.check_image_quality(frames)

    assert result["blurScore"] > config.QUALITY_BLUR_MIN
