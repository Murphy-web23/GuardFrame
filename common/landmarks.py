"""MediaPipe Face Landmarker 封裝，供各 track 共用。

原本是 track2_rppg/analyzer.py 的內部函式，Track 3 也需要同一份臉部關鍵點
才能定位額頭／鼻樑／臉頰做立體幾何檢查，因此搬到這裡共用，避免兩邊各寫一份
容易在版本升級或除錯時漏改一邊。搬移時邏輯逐字保留，不是重寫。
"""

import numpy as np

import config


class ModelNotFoundError(RuntimeError):
    """MediaPipe 模型檔不存在。"""


def _create_landmarker():
    """每次呼叫都建立一個全新的 MediaPipe Face Landmarker。

    MediaPipe 1.0.0 拿掉了舊的 mp.solutions.face_mesh，只剩 Tasks API，
    而 Tasks API 需要自備 .task 模型檔。參數名稱都對照實際安裝的版本確認過。

    **不要把它快取成全域變數。** VIDEO 模式要求 timestamp 嚴格遞增，
    重用同一個實例分析第二支影片時，timestamp 又從 0 開始，
    MediaPipe 會把整支影片的影格全部丟掉，呼叫端會靜默拿到空結果。
    每個請求處理一支影片，快取的話第二個請求就壞了。
    建立成本約 2.4 秒，相對於數百格的分析時間可以接受。
    """
    if not config.MEDIAPIPE_FACE_MODEL.exists():
        raise ModelNotFoundError(
            f"找不到 MediaPipe 模型檔：{config.MEDIAPIPE_FACE_MODEL}\n"
            f"下載位置：{config.MEDIAPIPE_FACE_MODEL_URL}"
        )

    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import (
        FaceLandmarker,
        FaceLandmarkerOptions,
        RunningMode,
    )

    options = FaceLandmarkerOptions(
        base_options=BaseOptions(
            model_asset_path=str(config.MEDIAPIPE_FACE_MODEL)
        ),
        # VIDEO 模式會利用前一格的結果做追蹤，比每格獨立偵測穩定也快
        running_mode=RunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=config.MEDIAPIPE_MIN_DETECTION_CONFIDENCE,
        min_face_presence_confidence=config.MEDIAPIPE_MIN_PRESENCE_CONFIDENCE,
        min_tracking_confidence=config.MEDIAPIPE_MIN_TRACKING_CONFIDENCE,
    )
    return FaceLandmarker.create_from_options(options)


def extract_landmarks(frames, fps):
    """逐格抽臉部關鍵點，回傳像素座標。

    參數:
        frames: list[np.ndarray]，RGB，uint8
        fps: float

    回傳:
        list[np.ndarray | None]，長度同 frames
        每格是 (478, 2) 的像素座標，沒偵測到臉時為 None
    """
    import mediapipe as mp

    landmarker = _create_landmarker()
    results = []

    try:
        for i, frame in enumerate(frames):
            try:
                h, w = frame.shape[:2]
                image = mp.Image(
                    image_format=mp.ImageFormat.SRGB,
                    data=np.ascontiguousarray(frame, dtype=np.uint8),
                )
                # timestamp 必須嚴格遞增，VIDEO 模式靠它判斷影格順序
                timestamp_ms = int(i * 1000.0 / fps)
                detection = landmarker.detect_for_video(image, timestamp_ms)

                if not detection.face_landmarks:
                    results.append(None)
                    continue

                # Tasks API 回傳的是正規化座標（0-1），乘回像素
                points = np.array(
                    [[lm.x * w, lm.y * h] for lm in detection.face_landmarks[0]],
                    dtype=np.float64,
                )
                results.append(points)
            except Exception:
                # 單格失敗不能拖垮整段分析，記成缺失格繼續跑
                results.append(None)
    finally:
        landmarker.close()

    return results
