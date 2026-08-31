"""快速測試 id_card_detector/weights/best.pt 這個 YOLO-pose 模型，拿之前
造成古典 CV 方法出錯的真實照片跑一遍，看新模型的角點偵測準不準。

不是正式系統的一部分，是驗證訓練成果用的一次性腳本。

用法：
    python id_card_detector/test_model.py
"""

import sys
from pathlib import Path

import cv2
from ultralytics import YOLO

BASE_DIR = Path(__file__).parent.parent
WEIGHTS_PATH = Path(__file__).parent / "weights" / "best.pt"
OUT_DIR = Path(__file__).parent / "test_predictions"

# 之前造成古典 CV 方法出問題的真實照片，見跟使用者的討論紀錄：
# - 手指蓋住卡片角落（應該要能猜出正確角落位置）
# - 光線昏暗＋背景雜物（應該不會像古典方法一樣選錯區域）
# - 手只是拿著邊緣，沒蓋住角（正常案例，應該要抓得準）
TEST_CASES = [
    ("data/_debug_id_card_skewed/20260827_222118_904352_orig.jpg", "手指蓋角"),
    ("data/_debug_id_card_skewed/20260827_222122_656489_orig.jpg", "手指蓋角"),
    ("data/_debug_id_card_skewed/20260827_225254_308482_orig.jpg", "太暗+背景雜物"),
    ("data/_debug_id_card_skewed/20260827_225235_805296_orig.jpg", "太暗+背景雜物"),
    ("data/_debug_id_card_failures/20260827_231551_721154.jpg", "手拿邊緣，正常"),
]


def main():
    if not WEIGHTS_PATH.exists():
        print(f"找不到權重檔：{WEIGHTS_PATH}")
        sys.exit(1)

    model = YOLO(str(WEIGHTS_PATH))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for rel_path, note in TEST_CASES:
        img_path = BASE_DIR / rel_path
        if not img_path.exists():
            print(f"[跳過] 找不到 {img_path}")
            continue

        results = model.predict(str(img_path), verbose=False)
        r = results[0]

        if r.keypoints is None or len(r.keypoints.xy) == 0:
            print(f"{note:12s} {img_path.name}：沒偵測到任何卡片")
            continue

        conf = float(r.boxes.conf[0]) if r.boxes is not None and len(r.boxes) > 0 else None
        kpts = r.keypoints.xy[0].tolist()
        print(f"{note:12s} {img_path.name}：偵測到，box confidence={conf:.3f}")
        print(f"             四個角點座標：{kpts}")

        annotated = r.plot()
        out_path = OUT_DIR / f"{img_path.stem}_pred.jpg"
        cv2.imwrite(str(out_path), annotated)
        print(f"             標註結果存到：{out_path}")
        print()


if __name__ == "__main__":
    main()
