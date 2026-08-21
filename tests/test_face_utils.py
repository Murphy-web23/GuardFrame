"""common/face_utils.py 的測試。

用 cv2.VideoWriter 現場產生小測試影片，不需要真的攝影機或素材檔案。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np
import pytest

from common import face_utils


def _write_video(path, num_frames, fps=10.0, size=32, bgr_colors=None):
    """寫一支測試影片，每格可指定不同的 BGR 顏色（預設遞增灰階）。"""
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (size, size))
    try:
        for i in range(num_frames):
            if bgr_colors is not None:
                color = bgr_colors[i % len(bgr_colors)]
            else:
                color = (i * 20 % 256,) * 3
            frame = np.full((size, size, 3), color, dtype=np.uint8)
            writer.write(frame)
    finally:
        writer.release()


def test_extract_frames_reads_all_frames_in_order(tmp_path):
    video_path = tmp_path / "test.mp4"
    _write_video(video_path, num_frames=5, fps=10.0)

    frames, fps = face_utils.extract_frames(video_path)

    assert len(frames) == 5
    assert fps == pytest.approx(10.0, abs=0.5)
    assert frames[0].shape == (32, 32, 3)


def test_extract_frames_converts_bgr_to_rgb():
    """寫入時故意用 BGR 純紅（B=0,G=0,R=255），讀回來的 RGB 應該是
    [255,0,0] 附近（容忍編碼壓縮造成的些微失真）。"""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        video_path = Path(tmp) / "red.mp4"
        _write_video(video_path, num_frames=3, bgr_colors=[(0, 0, 255)])

        frames, _ = face_utils.extract_frames(video_path)

        pixel = frames[0][16, 16].astype(int)
        assert pixel[0] > 200  # R 通道應該接近 255
        assert pixel[1] < 50   # G 通道應該接近 0
        assert pixel[2] < 50   # B 通道應該接近 0


def test_extract_frames_downsamples_to_target_fps(tmp_path):
    video_path = tmp_path / "test.mp4"
    _write_video(video_path, num_frames=30, fps=30.0)

    frames, fps = face_utils.extract_frames(video_path, target_fps=10.0)

    assert fps == pytest.approx(10.0, abs=0.5)
    # 30 格 @ 30fps 降到約 10fps，每 3 格取 1 格，約剩 10 格
    assert 8 <= len(frames) <= 11


def test_extract_frames_no_downsample_when_target_above_source(tmp_path):
    video_path = tmp_path / "test.mp4"
    _write_video(video_path, num_frames=5, fps=10.0)

    frames, fps = face_utils.extract_frames(video_path, target_fps=60.0)

    assert len(frames) == 5  # target 比原始 fps 高，不做降採樣
    assert fps == pytest.approx(10.0, abs=0.5)


def test_extract_frames_raises_file_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        face_utils.extract_frames(tmp_path / "nonexistent.mp4")


def test_extract_frames_raises_value_error_on_corrupt_file(tmp_path):
    bad_file = tmp_path / "corrupt.mp4"
    bad_file.write_bytes(b"this is not a real video file")

    with pytest.raises(ValueError):
        face_utils.extract_frames(bad_file)
