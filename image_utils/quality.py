"""影像品質前置檢查（CONVENTIONS.md §4.7）。

擺在錄影完成之後、五層分析之前。畫面太暗、太糊、過曝或臉太小，
後面四層算出來的數字都不可信 —— 與其產生一個看似有效的錯誤判定，
不如在這裡就退回要求重錄。
"""

import cv2
import numpy as np

import config

# 抽幾格來算就夠了。單一格可能剛好在眨眼或手晃到，
# 均勻抽樣取中位數比較能代表整段影片的品質。
_SAMPLE_COUNT = 10

_face_app = None
_face_app_failed = False


def _get_face_app():
    """延遲載入 InsightFace 偵測器。

    第一次呼叫會下載 buffalo_l 模型（約 300MB），所以不在 import 時就載。
    載不起來（沒網路、模型檔損壞）時記下來不再重試，讓品質檢查繼續跑完
    ——faceRatio 拿不到不該讓整個檢查掛掉。

    註：InsightFace 的封裝之後要搬進 common/face_utils.py 統一管理，
    現階段 common/ 還沒動工，先在這裡放一份最小版本。
    """
    global _face_app, _face_app_failed

    if _face_app is not None or _face_app_failed:
        return _face_app

    try:
        from insightface.app import FaceAnalysis

        app = FaceAnalysis(name="buffalo_l", allowed_modules=["detection"])
        app.prepare(ctx_id=-1, det_size=(640, 640))  # ctx_id=-1 走 CPU
        _face_app = app
    except Exception:
        _face_app_failed = True

    return _face_app


def _sample_indices(total, count):
    if total <= count:
        return list(range(total))
    return np.linspace(0, total - 1, count).astype(int).tolist()


def _largest_face_ratio(frame_rgb):
    """回傳最大臉部框佔畫面的面積比例，偵測不到或模型不可用時為 0.0。"""
    app = _get_face_app()
    if app is None:
        return 0.0

    try:
        # InsightFace 期待 BGR（它內部走 OpenCV 的慣例）
        faces = app.get(cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR))
    except Exception:
        return 0.0

    if not faces:
        return 0.0

    h, w = frame_rgb.shape[:2]
    areas = []
    for face in faces:
        x1, y1, x2, y2 = face.bbox
        areas.append(max(0.0, x2 - x1) * max(0.0, y2 - y1))

    return float(max(areas) / (h * w))


def check_image_quality(frames: list) -> dict:
    """影像品質前置檢查，不合格則退回要求重錄。

    參數:
        frames: list[np.ndarray]
            原始影格，RGB，uint8，shape = (H, W, 3)
            會均勻抽最多 10 格計算，各項指標取中位數

    回傳:
        {
            "passed": bool,
            "blurScore": float,            # Laplacian 變異數
            "brightness": float,           # 灰階平均值
            "contrast": float,             # 灰階標準差
            "overexposedRatio": float,     # 0.0-1.0
            "faceRatio": float,            # 臉部框面積 / 畫面面積
            "message": str                 # 不合格時說明原因
        }
    """
    empty = {
        "passed": False,
        "blurScore": 0.0,
        "brightness": 0.0,
        "contrast": 0.0,
        "overexposedRatio": 0.0,
        "faceRatio": 0.0,
        "message": "沒有可分析的影格",
    }
    if not frames:
        return empty

    blur_scores, brightness_values, contrast_values, overexposed_ratios = [], [], [], []

    for i in _sample_indices(len(frames), _SAMPLE_COUNT):
        frame = np.asarray(frames[i])
        if frame.ndim == 3:
            gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
        else:
            gray = frame.astype(np.uint8)

        # Laplacian 是二階微分，對邊緣敏感。清晰的畫面邊緣多、
        # 二階微分的變異數就大；失焦的畫面邊緣糊掉，變異數小。
        blur_scores.append(float(cv2.Laplacian(gray, cv2.CV_64F).var()))
        brightness_values.append(float(gray.mean()))
        contrast_values.append(float(gray.std()))
        overexposed_ratios.append(
            float((gray >= config.QUALITY_OVEREXPOSED_LEVEL).sum() / gray.size)
        )

    blur_score = float(np.median(blur_scores))
    brightness = float(np.median(brightness_values))
    contrast = float(np.median(contrast_values))
    overexposed_ratio = float(np.median(overexposed_ratios))

    # 臉部偵測只在中間那格跑一次，CPU 上每格都跑太慢，
    # 而使用者的位置在整段錄影中不會差太多。
    face_ratio = _largest_face_ratio(np.asarray(frames[len(frames) // 2]))

    reasons = []
    if blur_score < config.QUALITY_BLUR_MIN:
        reasons.append(f"畫面模糊（清晰度 {blur_score:.1f}，需 {config.QUALITY_BLUR_MIN:.0f} 以上）")
    if brightness < config.QUALITY_BRIGHTNESS_MIN:
        reasons.append(f"畫面過暗（亮度 {brightness:.1f}，需 {config.QUALITY_BRIGHTNESS_MIN} 以上）")
    elif brightness > config.QUALITY_BRIGHTNESS_MAX:
        reasons.append(f"畫面過亮（亮度 {brightness:.1f}，需 {config.QUALITY_BRIGHTNESS_MAX} 以下）")
    if contrast < config.QUALITY_CONTRAST_MIN:
        reasons.append(f"對比不足（對比度 {contrast:.1f}，需 {config.QUALITY_CONTRAST_MIN:.0f} 以上）")
    if overexposed_ratio > config.QUALITY_OVEREXPOSED_MAX:
        reasons.append(f"畫面過曝（過曝比例 {overexposed_ratio:.1%}）")
    if face_ratio < config.QUALITY_FACE_RATIO_MIN:
        reasons.append(f"臉部太小或未入鏡（佔畫面 {face_ratio:.1%}，需 {config.QUALITY_FACE_RATIO_MIN:.0%} 以上）")

    return {
        "passed": not reasons,
        "blurScore": blur_score,
        "brightness": brightness,
        "contrast": contrast,
        "overexposedRatio": overexposed_ratio,
        "faceRatio": face_ratio,
        "message": "；".join(reasons),
    }
