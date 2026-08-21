"""影像處理｜證件四角偵測與透視矯正。

契約見 CONVENTIONS.md §4.7。

流程：灰階 → 高斯模糊 → Canny 邊緣 → findContours 找輪廓 → 依面積排序
→ approxPolyDP 逼近四邊形 → 角點排序 → 透視變換。全部是古典 OpenCV
技術，不需要深度學習模型，也不判讀顏色語意——BGR/RGB 對這個模組的
正確性沒有影響，矯正只搬動像素，輸出影像沿用輸入的通道順序。

找不到四邊形時的容錯很重要：使用者可能拍到桌面反光、證件被手指遮住、
背景太雜——這是實際使用時最常遇到的情況，回傳 success=False 加訊息，
不拋例外、不回傳任何影像（CONVENTIONS §10.3 明確禁止的行為之一）。
"""

import cv2
import numpy as np

import config


def _order_corners(pts):
    """把四個角排成左上、右上、右下、左下。

    approxPolyDP 回傳的四個點順序不固定，做透視變換前必須排好，
    否則影像會被扭曲成奇怪的樣子。

    參數:
        pts: np.ndarray，可為 (4, 2) 或 (4, 1, 2)
    回傳:
        np.ndarray，shape (4, 2)，float32，順序為 [左上, 右上, 右下, 左下]
    """
    pts = pts.reshape(4, 2).astype("float32")
    rect = np.zeros((4, 2), dtype="float32")

    s = pts.sum(axis=1)  # x+y 最小是左上，最大是右下
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]

    d = np.diff(pts, axis=1)  # y-x 最小是右上，最大是左下
    rect[1] = pts[np.argmin(d)]
    rect[3] = pts[np.argmax(d)]

    return rect


def _find_quad_contour(edges):
    """在邊緣圖裡找面積最大的四邊形輪廓。

    參數:
        edges: np.ndarray，Canny 輸出的二值邊緣圖
    回傳:
        np.ndarray | None，approxPolyDP 的輸出，找不到四頂點輪廓時回傳 None
    """
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[
        : config.ID_CARD_CONTOUR_TOP_N
    ]

    for c in contours:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, config.ID_CARD_APPROX_EPSILON_RATIO * peri, True)
        if len(approx) == 4:
            return approx

    return None


def _compute_confidence(ordered_corners):
    """依偵測到的四邊形長寬比跟 ISO/IEC 7810 ID-1 規格（856:540）的接近
    程度，估計偵測結果的可信度。

    比對長寬比而不是絕對面積或角度：使用者跟證件的距離、拍攝角度都會
    讓面積跟角的量測值變動很大，但正常拍攝下卡片本身的長寬比不會變。
    偏離標準比例越多，越可能是誤抓到別的矩形（桌面、書本封面等），
    不是真的證件邊界。

    參數:
        ordered_corners: np.ndarray，shape (4, 2)，_order_corners 的輸出
    回傳:
        float，0.0-1.0
    """
    tl, tr, br, bl = ordered_corners
    width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2.0
    height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2.0
    if height < 1e-6 or width < 1e-6:
        return 0.0

    aspect_ratio = max(width, height) / min(width, height)
    deviation = abs(aspect_ratio - config.ID_CARD_ASPECT_RATIO) / config.ID_CARD_ASPECT_RATIO
    return float(max(0.0, 1.0 - deviation))


def rectify_id_card(image: np.ndarray) -> dict:
    """偵測證件四角並做透視變換矯正。

    參數:
        image: np.ndarray，原始影像，shape (H, W, 3)

    回傳:
        {
            "success": bool,                # 是否成功偵測到四邊形
            "rectified": np.ndarray | None, # 矯正後影像，856×540
                                             # success 為 False 時為 None
            "corners": list | None,         # 四個角座標 [[x,y]×4]，原圖座標，失敗為 None
            "confidence": float,            # 0.0-1.0
            "message": str                  # 供前端顯示的失敗訊息
        }

    實作要點:
        - 灰階 → 高斯模糊 → Canny → findContours → 依面積排序
        - approxPolyDP 逼近四邊形，須確認頂點數為 4
        - 角點依左上/右上/右下/左下排序後才能做透視變換
        - 找不到四邊形時，rectified 與 corners 皆回傳 None，success=False，
          並附上清楚的 message，前端僅顯示此訊息，不顯示任何影像。不拋例外
    """
    if image is None or image.size == 0:
        return {
            "success": False,
            "rectified": None,
            "corners": None,
            "confidence": 0.0,
            "message": "未收到有效影像，請重新拍攝",
        }

    orig = image
    h, w = orig.shape[:2]
    ratio = min(1.0, config.ID_CARD_RESIZE_WIDTH / w)
    small = cv2.resize(orig, None, fx=ratio, fy=ratio) if ratio < 1.0 else orig.copy()

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY) if small.ndim == 3 else small
    blurred = cv2.GaussianBlur(gray, config.ID_CARD_BLUR_KERNEL, 0)
    edges = cv2.Canny(blurred, config.ID_CARD_CANNY_LOW, config.ID_CARD_CANNY_HIGH)

    quad = _find_quad_contour(edges)
    if quad is None:
        return {
            "success": False,
            "rectified": None,
            "corners": None,
            "confidence": 0.0,
            "message": "未偵測到證件邊界，請確認證件完整入鏡、背景單純後重新拍攝",
        }

    ordered_small = _order_corners(quad)
    ordered_orig = ordered_small / ratio  # 換算回原圖尺寸

    confidence = _compute_confidence(ordered_orig)

    output_w, output_h = config.ID_CARD_OUTPUT_WIDTH, config.ID_CARD_OUTPUT_HEIGHT
    dst = np.array(
        [[0, 0], [output_w - 1, 0], [output_w - 1, output_h - 1], [0, output_h - 1]],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(ordered_orig.astype("float32"), dst)
    rectified = cv2.warpPerspective(orig, matrix, (output_w, output_h))

    return {
        "success": True,
        "rectified": rectified,
        "corners": ordered_orig.tolist(),
        "confidence": confidence,
        "message": "",
    }
