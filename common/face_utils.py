"""共用｜抽影格。

不在 CONVENTIONS §4 固定契約清單裡，但 SAD 模組圖列為共用模組。

**目前只實作「從影片抽出原始影格」這塊**——這是 B 串接 /verify 端點時，
對照組、Track 2-4 共同需要的前置（每個 analyzer 的第一個參數都是
`frames: list`）。跟 A 的 Track 1 對齊/CLIP 特徵抽取（PLAN.md 階段1
「A 的任務」提到的 `extract_face()`/`extract_clip_features()`，把
InsightFace 五點對齊裁切成 224×224、再過 CLIP 抽 768 維特徵）是不同的
需求，那塊留給 A 實作 Track 1 時再補進這個檔案，這裡先不越界代寫。
"""

from pathlib import Path

import cv2

import config


def extract_frames(video_path, target_fps=None):
    """讀取影片檔，抽出所有影格。

    參數:
        video_path: str | Path，影片檔路徑
        target_fps: float | None
            若指定且低於影片原始 fps，等間隔抽樣降到這個 fps（省記憶體、
            加快後續分析）；None 或 >= 原始 fps 時抽出全部影格

    回傳:
        (frames, fps)
        frames: list[np.ndarray]，RGB，uint8，依時間順序排列
        fps: float，實際回傳影格對應的取樣率——有做降採樣時是
            downsample 後的等效 fps，否則是影片的原始 fps

    例外:
        FileNotFoundError：影片檔不存在
        ValueError：檔案存在但 OpenCV 無法開啟（毀損或格式不支援）
    """
    path = Path(video_path)
    if not path.exists():
        raise FileNotFoundError(f"找不到影片檔：{video_path}")

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"無法開啟影片檔（可能毀損或格式不支援）：{video_path}")

    try:
        source_fps = cap.get(cv2.CAP_PROP_FPS)
        if source_fps <= 0:
            # 部分編碼器/容器讀不到 fps 中繼資料，退回設定值而不是 0
            # （fps=0 會讓下游所有訊號處理的時間換算全部壞掉）
            source_fps = float(config.TARGET_FPS)

        step = 1
        output_fps = source_fps
        if target_fps and target_fps < source_fps:
            step = max(int(round(source_fps / target_fps)), 1)
            output_fps = source_fps / step

        frames = []
        index = 0
        last_pos_msec = 0.0
        while True:
            ok, frame_bgr = cap.read()
            if not ok:
                break
            if index % step == 0:
                frames.append(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
            index += 1
            last_pos_msec = cap.get(cv2.CAP_PROP_POS_MSEC)

        # 暫時的診斷 log（2026-08-21）：容器中繼資料宣告的 fps 不一定等於
        # 實際錄影達成的 fps（尤其瀏覽器端 MediaRecorder），這裡額外算一次
        # 「格數 ÷ 影片實際時長」作對照，純粹多印一行，不影響回傳值或任何
        # 判斷邏輯。等確認真的有落差、且落差有意義後再考慮要不要拿這個數字
        # 去做格數換算修正，見 PHASE1_NOTES.md fps 假設風險章節。
        if last_pos_msec > 0:
            measured_fps = index / (last_pos_msec / 1000.0)
            drift_pct = abs(measured_fps - source_fps) / source_fps * 100 if source_fps else 0.0
            print(
                f"[fps 診斷] {path.name}：容器聲稱 fps={source_fps:.2f}，總格數={index}，"
                f"量到時長={last_pos_msec / 1000.0:.2f}s，換算實測 fps={measured_fps:.2f}"
                f"（落差 {drift_pct:.1f}%）"
            )

        return frames, float(output_fps)
    finally:
        cap.release()
