"""Track 4｜遮擋一致性：手部追蹤與進出臉部循環偵測。

契約見 CONVENTIONS.md §4.6、PLAN.md 階段2 Track4。

用 MediaPipe Hands 追蹤手部關鍵點的重心，判定它相對一個「臉部參考框」
的進出，抓出完整的「進入→離開」循環。不指定方向——反覆揮手本身就會
產生多次進出循環，每一次都是一個偵測機會，不需要像早期設計那樣要求
使用者往特定方向掃過。

臉部參考框不是每格重新偵測：遮擋當下（手正好蓋住臉）InsightFace 通常
偵測不到臉，沒有即時 bbox 可用。做法是用 identity.py 在「有偵測到臉」
的那些影格算出的 bbox 取中位數，當作這整段 7 秒裡臉大致的位置——
使用者揮手時通常不會大幅度移動位置，這個假設在這個挑戰的設計前提下
是合理的。

這裡也做層級檢查（layerScore）：比較「手臉重疊區域」跟「臉本身」的
顏色，重疊區域看起來還是像臉的話，代表遮擋物底下的臉「透」了出來——
換臉演算法在遮擋時管線斷裂的典型破綻。
"""

import numpy as np

import config


class ModelNotFoundError(RuntimeError):
    """MediaPipe Hand 模型檔不存在。"""


def _create_hand_landmarker():
    """建立 MediaPipe Hand Landmarker。

    跟 common/landmarks.py 的 Face Landmarker 同樣的理由：不快取成全域
    變數。VIDEO 模式要求 timestamp 嚴格遞增，重用實例分析第二支影片時
    timestamp 又從 0 開始，MediaPipe 會把整支影片的影格全部丟掉。
    """
    if not config.MEDIAPIPE_HAND_MODEL.exists():
        raise ModelNotFoundError(
            f"找不到 MediaPipe Hand 模型檔：{config.MEDIAPIPE_HAND_MODEL}\n"
            f"下載位置：{config.MEDIAPIPE_HAND_MODEL_URL}"
        )

    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import (
        HandLandmarker,
        HandLandmarkerOptions,
        RunningMode,
    )

    options = HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(config.MEDIAPIPE_HAND_MODEL)),
        running_mode=RunningMode.VIDEO,
        # 挑戰設計上只需要單手在臉前揮動，抓一隻手就好——兩隻手都入鏡時
        # 抓兩隻反而會在後續「手部中心」判斷上製造混淆。
        num_hands=1,
        min_hand_detection_confidence=config.MEDIAPIPE_HAND_MIN_DETECTION_CONFIDENCE,
        min_hand_presence_confidence=config.MEDIAPIPE_HAND_MIN_PRESENCE_CONFIDENCE,
        min_tracking_confidence=config.MEDIAPIPE_HAND_MIN_TRACKING_CONFIDENCE,
    )
    return HandLandmarker.create_from_options(options)


def extract_hand_landmarks(frames, fps):
    """逐格抽手部關鍵點，回傳每格的重心座標與外接框。

    參數:
        frames: list[np.ndarray]，RGB，uint8
        fps: float

    回傳:
        list[dict | None]，長度同 frames
        每格是 {"center": np.ndarray(2,), "bbox": (x1,y1,x2,y2)}（像素座標），
        沒偵測到手時為 None
    """
    import mediapipe as mp

    landmarker = _create_hand_landmarker()
    results = []

    try:
        for i, frame in enumerate(frames):
            try:
                h, w = frame.shape[:2]
                image = mp.Image(
                    image_format=mp.ImageFormat.SRGB,
                    data=np.ascontiguousarray(frame, dtype=np.uint8),
                )
                timestamp_ms = int(i * 1000.0 / fps)
                detection = landmarker.detect_for_video(image, timestamp_ms)

                if not detection.hand_landmarks:
                    results.append(None)
                    continue

                points = np.array(
                    [[lm.x * w, lm.y * h] for lm in detection.hand_landmarks[0]],
                    dtype=np.float64,
                )
                bbox = (
                    float(points[:, 0].min()),
                    float(points[:, 1].min()),
                    float(points[:, 0].max()),
                    float(points[:, 1].max()),
                )
                results.append({"center": points.mean(axis=0), "bbox": bbox})
            except Exception:
                results.append(None)
    finally:
        landmarker.close()

    return results


def expand_bbox(bbox, margin):
    """把 bbox 往外擴張，每邊各擴張 margin 比例的寬/高。"""
    x1, y1, x2, y2 = bbox
    w, h = x2 - x1, y2 - y1
    return (x1 - w * margin, y1 - h * margin, x2 + w * margin, y2 + h * margin)


def _is_inside(point, bbox):
    if point is None:
        return False
    x, y = point
    x1, y1, x2, y2 = bbox
    return x1 <= x <= x2 and y1 <= y <= y2


def detect_wave_cycles(hand_data, face_region):
    """依手部中心座標相對臉部參考框的進出，偵測完整的「進入→離開」循環。

    只計算完整循環（有進有出）；影格結束時手還沒離開的最後一段不算——
    §4.6 要求的是「至少 2 次完整循環」，沒收尾的遮擋無法確認使用者
    真的把手移開過，不該算數。手部缺偵測的格一律視為「不在區域內」，
    這是簡化但保守的規則：漏算比誤算安全（不會把雜訊當成循環）。

    參數:
        hand_data: list[dict | None]，extract_hand_landmarks 的輸出
        face_region: (x1, y1, x2, y2)，臉部參考框（通常已經過 expand_bbox 擴張）

    回傳:
        list[[int, int]]，每個完整循環的 [進入影格索引, 離開影格索引]
    """
    segments = []
    inside_start = None
    for i, hand in enumerate(hand_data):
        center = hand["center"] if hand is not None else None
        inside = _is_inside(center, face_region)
        if inside and inside_start is None:
            inside_start = i
        elif not inside and inside_start is not None:
            segments.append([inside_start, i])
            inside_start = None
    return segments


def _bbox_intersection(a, b):
    """兩個 bbox 的交集區域，沒有交集時回傳 None。"""
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    if x2 <= x1 or y2 <= y1:
        return None
    return (x1, y1, x2, y2)


def _region_mean_color(frame, bbox):
    """bbox 範圍內的平均 RGB 顏色，bbox 會先跟畫面邊界夾好。"""
    h, w = frame.shape[:2]
    x1 = int(max(0, bbox[0]))
    y1 = int(max(0, bbox[1]))
    x2 = int(min(w, bbox[2]))
    y2 = int(min(h, bbox[3]))
    if x2 <= x1 or y2 <= y1:
        return None
    region = frame[y1:y2, x1:x2]
    return region.reshape(-1, 3).mean(axis=0)


def _reference_face_color(frames, hand_data, face_region):
    """挑一格「手不在臉部參考框內」的影格，算臉部參考框的平均顏色。

    要挑手不在裡面的那格，避免參考色本身就被手汙染。
    """
    for i, frame in enumerate(frames):
        hand = hand_data[i] if i < len(hand_data) else None
        occluded = hand is not None and _bbox_intersection(hand["bbox"], face_region) is not None
        if occluded:
            continue
        color = _region_mean_color(frame, face_region)
        if color is not None:
            return color
    return None


def layer_consistency_score(frames, hand_data, face_region, segments):
    """遮擋層級檢查：每次循環的手臉重疊區域顏色，是否明顯不同於臉本身的膚色。

    做法：對每個循環取中間影格，算「手部外接框 ∩ 臉部參考框」這塊區域的
    平均顏色，跟遮擋前（手不在框內時）的臉部參考顏色比較歐氏距離。
    距離越大代表遮擋物跟臉的顏色差異越明顯，越像真的有東西擋住；距離小
    代表遮擋區域看起來還是像臉——即使手在畫面上蓋住了那個位置，換臉
    演算法卻讓底層的臉「透」了出來，這是即時換臉在遮擋時管線斷裂的
    典型破綻。

    參數:
        frames: list[np.ndarray]，RGB
        hand_data: list[dict | None]，extract_hand_landmarks 的輸出
        face_region: (x1, y1, x2, y2)
        segments: list[[int, int]]，detect_wave_cycles 的輸出

    回傳:
        float，layerScore，0.0-1.0。沒有任何完整循環、或算不出參考顏色/
        重疊區域時回傳 0.0——沒有證據支持「有東西確實擋住臉」，不能
        預設給高分。
    """
    reference_color = _reference_face_color(frames, hand_data, face_region)
    if reference_color is None or not segments:
        return 0.0

    distances = []
    for start, end in segments:
        mid = (start + end) // 2
        if mid >= len(hand_data) or hand_data[mid] is None:
            continue
        overlap = _bbox_intersection(hand_data[mid]["bbox"], face_region)
        if overlap is None:
            continue
        occ_color = _region_mean_color(frames[mid], overlap)
        if occ_color is None:
            continue
        distances.append(float(np.linalg.norm(occ_color - reference_color)))

    if not distances:
        return 0.0

    avg_distance = float(np.mean(distances))
    return float(np.clip(avg_distance / config.OCC_LAYER_COLOR_REFERENCE, 0.0, 1.0))
