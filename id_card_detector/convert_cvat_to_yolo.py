"""把 CVAT「CVAT for images 1.1」格式匯出的 annotations.xml 轉成
Ultralytics YOLO-pose 需要的 txt 標註，順便切 train/val。

不是正式系統的一部分，是收集 id_card_detector 訓練資料用的一次性
轉換工具，跟 GuardFrame 主程式沒有相依關係。

前提：
- annotations.xml 裡標的 4 個點，順序已經是固定的
  [左上, 右上, 右下, 左下]（見 README.md 的標註規範）
- 對應的圖片檔案已經存在 dataset/images/train/ 底下（extract_frames.py
  切出來的那批），這支腳本只是重新分配到 train/val，不會真的複製
  圖片內容
- CVAT 這裡用的是 Points 形狀（不是 Skeleton），沒有單點層級的
  occluded 標記，所以每個點的 visibility 統一寫成 2（可見）——見
  跟使用者的討論，這是已知、可接受的簡化

用法：
    python id_card_detector/convert_cvat_to_yolo.py annotations.xml [--val-ratio 0.1]
"""

import argparse
import random
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

BASE_DIR = Path(__file__).parent
IMAGES_TRAIN_DIR = BASE_DIR / "dataset" / "images" / "train"
IMAGES_VAL_DIR = BASE_DIR / "dataset" / "images" / "val"
LABELS_TRAIN_DIR = BASE_DIR / "dataset" / "labels" / "train"
LABELS_VAL_DIR = BASE_DIR / "dataset" / "labels" / "val"


def parse_annotations(xml_path: Path):
    """回傳 list[(filename, width, height, [(x,y)*4])]，沒標點的圖片跳過。"""
    tree = ET.parse(xml_path)
    root = tree.getroot()

    items = []
    for image_el in root.findall("image"):
        points_el = image_el.find("points")
        if points_el is None:
            continue  # 沒標的（構圖不好跳過的那些），不進訓練集

        filename = image_el.get("name")
        width = float(image_el.get("width"))
        height = float(image_el.get("height"))

        raw_points = points_el.get("points")  # "x1,y1;x2,y2;x3,y3;x4,y4"
        pairs = raw_points.split(";")
        if len(pairs) != 4:
            print(f"[跳過] {filename}：點數不是 4 個（{len(pairs)}），標註可能沒做完")
            continue

        coords = []
        for pair in pairs:
            x_str, y_str = pair.split(",")
            coords.append((float(x_str), float(y_str)))

        items.append((filename, width, height, coords))

    return items


def to_yolo_pose_line(width, height, coords):
    xs = [x for x, _ in coords]
    ys = [y for _, y in coords]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)

    cx = (x_min + x_max) / 2 / width
    cy = (y_min + y_max) / 2 / height
    box_w = (x_max - x_min) / width
    box_h = (y_max - y_min) / height

    parts = [f"0 {cx:.6f} {cy:.6f} {box_w:.6f} {box_h:.6f}"]
    for x, y in coords:
        # visibility 統一填 2（可見）——這個 CVAT 匯出沒有單點遮擋資訊，
        # 見檔案開頭的說明。
        parts.append(f"{x / width:.6f} {y / height:.6f} 2")
    return " ".join(parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xml_path", type=Path, help="CVAT 匯出的 annotations.xml 路徑")
    parser.add_argument("--val-ratio", type=float, default=0.1, help="切去驗證集的比例（預設 0.1）")
    parser.add_argument("--seed", type=int, default=0, help="切 train/val 用的隨機種子")
    args = parser.parse_args()

    items = parse_annotations(args.xml_path)
    print(f"總共 {len(items)} 張有標註的圖片")

    rng = random.Random(args.seed)
    rng.shuffle(items)
    val_count = max(1, round(len(items) * args.val_ratio))
    val_items = items[:val_count]
    train_items = items[val_count:]
    print(f"train: {len(train_items)} 張，val: {len(val_items)} 張")

    for out_dir in (IMAGES_TRAIN_DIR, IMAGES_VAL_DIR, LABELS_TRAIN_DIR, LABELS_VAL_DIR):
        out_dir.mkdir(parents=True, exist_ok=True)

    missing = []
    for split_name, split_items, images_out, labels_out in (
        ("train", train_items, IMAGES_TRAIN_DIR, LABELS_TRAIN_DIR),
        ("val", val_items, IMAGES_VAL_DIR, LABELS_VAL_DIR),
    ):
        for filename, width, height, coords in split_items:
            # extract_frames.py 一律把圖片存進 images/train/，val 的圖片
            # 這裡要從那邊搬過去（用 move，不是 copy，避免同一張圖同時
            # 出現在 train 跟 val 兩邊）。
            src = IMAGES_TRAIN_DIR / filename
            if not src.exists():
                missing.append(filename)
                continue

            if split_name == "val":
                dst = images_out / filename
                if src != dst:
                    shutil.move(str(src), str(dst))

            label_path = labels_out / (Path(filename).stem + ".txt")
            label_path.write_text(to_yolo_pose_line(width, height, coords) + "\n", encoding="utf-8")

    if missing:
        print(f"警告：{len(missing)} 個檔名在 annotations.xml 裡有標註，但圖片檔案找不到：")
        for name in missing[:10]:
            print(f"  - {name}")

    print("完成。")


if __name__ == "__main__":
    main()
