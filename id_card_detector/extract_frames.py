"""從一支影片均勻取樣切出照片，準備給 CVAT 標註用。

不是正式系統的一部分，只是收集 id_card_detector 訓練資料用的一次性
小工具，跟 GuardFrame 主程式沒有相依關係。

用法：
    python id_card_detector/extract_frames.py <影片路徑> [--count 200] [--out id_card_detector/dataset/images/train]

建議錄影時把手機/鏡頭對著示範卡片，慢慢改變角度、距離、光線，
中間刻意用手指蓋住卡片角落幾秒——這樣切出來的照片才會涵蓋
README.md 裡建議的各種變異度（角度、光線、遮擋）。
"""

import argparse
from pathlib import Path

import cv2


def extract_frames(video_path: Path, out_dir: Path, count: int) -> int:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise FileNotFoundError(f"無法開啟影片檔：{video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0:
        raise ValueError(f"讀不到影格數，影片可能損壞：{video_path}")

    count = min(count, total_frames)
    # 均勻取樣整支影片的影格索引，跟影片長度無關，指定要幾張就切幾張。
    indices = sorted(set(int(i * total_frames / count) for i in range(count)))

    out_dir.mkdir(parents=True, exist_ok=True)
    stem = video_path.stem
    saved = 0
    frame_idx = 0
    idx_pointer = 0

    while idx_pointer < len(indices):
        ok, frame = cap.read()
        if not ok:
            break
        if frame_idx == indices[idx_pointer]:
            out_path = out_dir / f"{stem}_{frame_idx:06d}.jpg"
            cv2.imwrite(str(out_path), frame)
            saved += 1
            idx_pointer += 1
        frame_idx += 1

    cap.release()
    return saved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path, help="輸入影片路徑")
    parser.add_argument("--count", type=int, default=200, help="要切出的照片張數（預設 200）")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("id_card_detector/dataset/images/train"),
        help="輸出目錄（預設 id_card_detector/dataset/images/train）",
    )
    args = parser.parse_args()

    if not args.video.exists():
        raise SystemExit(f"找不到影片檔：{args.video}")

    saved = extract_frames(args.video, args.out, args.count)
    print(f"完成，切出 {saved} 張照片，存在 {args.out.resolve()}")


if __name__ == "__main__":
    main()
