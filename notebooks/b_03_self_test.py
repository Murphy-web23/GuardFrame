"""自我測試診斷工具。

在正式跟 A 錄「合併點二」的 100 段資料之前，先錄一小段自己的影片，
用這支腳本快速檢查幾件事：

    1. landmark 疊圖對不對——額頭/雙頰/眼睛/鼻樑/臉頰邊緣的框有沒有框對
    2. 眨眼/轉左/轉右有沒有被正確判定為通過（不是只看訊號的圖，
       是真的呼叫跟正式管線一樣的判定函式）
    3. （影片夠長的話）rPPG 心率跟手錶量的準不準
    4. Track 4 的揮手循環偵測跟身分穩定度合不合理

用法：
    venv\\Scripts\\python.exe notebooks\\b_03_self_test.py 你的影片.mp4
    venv\\Scripts\\python.exe notebooks\\b_03_self_test.py 你的影片.mp4 --track4-range 15 22

    --track4-range 開始秒數 結束秒數
        只把這個時間範圍內的影格交給 Track 4 分析，不用整支影片跑。
        Track 4 用 InsightFace 逐格偵測，CPU 上處理整支長影片可能要
        好幾分鐘；只給揮手那幾秒可以快很多。不指定的話還是跑整支影片。

輸出（存在跟輸入影片同一個資料夾）：
    《檔名》_landmarks.jpg   —— Track 2 ROI + 對照組關鍵點疊圖
    《檔名》_geometry.jpg    —— Track 3 立體幾何四區疊圖
    《檔名》_timeline.png    —— EAR／yaw_ratio 隨時間變化的圖
    終端機印出對照組／rPPG／Track4 的判定結果
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Windows 終端機預設編碼不一定是 UTF-8，中文 print() 沒特別處理會變亂碼。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import cv2
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

# matplotlib 預設字型不含中文字形，存圖裡的中文會變成方塊——
# Windows 內建的微軟正黑體可以正常顯示，跟 notebooks/track3_light_test.html
# 用同一套字型家族。
matplotlib.rcParams["font.sans-serif"] = ["Microsoft JhengHei", "Microsoft YaHei", "SimHei"]
matplotlib.rcParams["axes.unicode_minus"] = False

import config
from baseline_challenge.analyzer import (
    LEFT_EYE_INDICES,
    LEFT_FACE_EDGE_INDEX,
    NOSE_TIP_INDEX,
    RIGHT_EYE_INDICES,
    RIGHT_FACE_EDGE_INDEX,
    _average_ear,
    _check_blink,
    _check_turn_left,
    _check_turn_right,
    _yaw_ratio,
)
from common.face_utils import extract_frames
from common.landmarks import ModelNotFoundError, extract_landmarks
from track2_rppg.analyzer import analyze_rppg
from track2_rppg.analyzer import draw_roi_overlay as draw_rppg_overlay
from track3_photometric.geometry import draw_geometry_overlay
from track4_occlusion.analyzer import analyze_occlusion


def _draw_baseline_points(frame, landmarks):
    """把對照組用到的關鍵點（眼睛六點、鼻尖、左右臉頰邊緣）疊在影格上。"""
    overlay = frame.copy()
    for idx in RIGHT_EYE_INDICES:
        cv2.circle(overlay, tuple(landmarks[idx].astype(int)), 3, (0, 255, 255), -1)
    for idx in LEFT_EYE_INDICES:
        cv2.circle(overlay, tuple(landmarks[idx].astype(int)), 3, (255, 255, 0), -1)
    cv2.circle(overlay, tuple(landmarks[NOSE_TIP_INDEX].astype(int)), 5, (255, 0, 255), -1)
    cv2.circle(overlay, tuple(landmarks[LEFT_FACE_EDGE_INDEX].astype(int)), 5, (0, 255, 0), -1)
    cv2.circle(overlay, tuple(landmarks[RIGHT_FACE_EDGE_INDEX].astype(int)), 5, (0, 0, 255), -1)
    return overlay


def main(video_path, track4_range=None):
    video_path = Path(video_path)
    stem = video_path.parent / video_path.stem

    print(f"讀取影片：{video_path}")
    frames, fps = extract_frames(str(video_path))
    print(f"共 {len(frames)} 格，fps={fps:.1f}，長度約 {len(frames) / fps:.1f} 秒")

    try:
        landmarks_list = extract_landmarks(frames, fps)
    except ModelNotFoundError as e:
        print(f"缺少 MediaPipe 模型檔：{e}")
        return

    detected_count = sum(lm is not None for lm in landmarks_list)
    print(f"臉部偵測率：{detected_count}/{len(frames)} ({detected_count / len(frames):.0%})")
    if detected_count == 0:
        print("整支影片都沒偵測到臉，後面的分析沒有意義，先確認光線/角度後重錄。")
        return

    # 1. landmark 疊圖：挑一格有偵測到臉的（從中間開始找），
    #    疊上 Track2 的三個 ROI + 對照組的眼睛/鼻尖/臉頰邊緣關鍵點。
    mid_valid_idx = next(
        i for i in range(len(frames) // 2, len(frames)) if landmarks_list[i] is not None
    )
    frame, landmarks = frames[mid_valid_idx], landmarks_list[mid_valid_idx]

    overlay = draw_rppg_overlay(frame, landmarks)
    overlay = _draw_baseline_points(overlay, landmarks)
    landmarks_path = f"{stem}_landmarks.jpg"
    cv2.imwrite(landmarks_path, cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR))
    print(f"\n已存 landmark 疊圖：{landmarks_path}")
    print("  打開看：黃色/青色點應該在眼睛周圍，紫色點在鼻尖，")
    print("  綠色點在左邊臉頰邊緣、紅色點在右邊臉頰邊緣，")
    print("  額頭/雙頰應該各有一塊半透明色塊。位置不對的話後面數字都不可信。")

    geo_overlay = draw_geometry_overlay(frame, landmarks)
    geometry_path = f"{stem}_geometry.jpg"
    cv2.imwrite(geometry_path, cv2.cvtColor(geo_overlay, cv2.COLOR_RGB2BGR))
    print(f"\n已存 Track 3 幾何區域疊圖：{geometry_path}")
    print("  打開看：綠=額頭、黃=鼻樑、紅=左頰、藍=右頰。")

    # 2. 時間序列：EAR、yaw_ratio，方便對照「幾秒做了什麼動作」
    #    正負號對應見 baseline_challenge.analyzer._YAW_SIGN
    #    （2026-08-18 已用真實影片驗證過：左轉是負值、右轉是正值）。
    times, ear_values, yaw_values = [], [], []
    for i, lm in enumerate(landmarks_list):
        if lm is None:
            continue
        times.append(i / fps)
        ear_values.append(_average_ear(lm))
        yaw_values.append(_yaw_ratio(lm))

    fig, axes = plt.subplots(2, 1, figsize=(10, 6), sharex=True)

    axes[0].plot(times, ear_values)
    axes[0].axhline(
        config.BASELINE_EAR_THRESHOLD, color="red", linestyle="--",
        label=f"閾值 {config.BASELINE_EAR_THRESHOLD}",
    )
    axes[0].set_ylabel("EAR（眨眼）")
    axes[0].set_title("低於紅線的區間 = 判定為「閉眼」")
    axes[0].legend()

    axes[1].plot(times, yaw_values)
    axes[1].axhline(0, color="gray", linewidth=0.8)
    axes[1].axhline(
        config.BASELINE_YAW_RATIO_MIN, color="orange", linestyle="--",
        label=f"turn_right 門檻 +{config.BASELINE_YAW_RATIO_MIN}",
    )
    axes[1].axhline(
        -config.BASELINE_YAW_RATIO_MIN, color="red", linestyle="--",
        label=f"turn_left 門檻 -{config.BASELINE_YAW_RATIO_MIN}",
    )
    axes[1].set_ylabel("yaw_ratio（轉頭）")
    axes[1].set_xlabel("時間（秒）")
    axes[1].set_title("負值超過紅線 = 判定為 turn_left，正值超過橘線 = 判定為 turn_right")
    axes[1].legend()

    plt.tight_layout()
    timeline_path = f"{stem}_timeline.png"
    plt.savefig(timeline_path, dpi=120)
    print(f"\n已存時間序列圖：{timeline_path}")

    # 3. 對照組：眨眼/左轉/右轉是否「有通過」——直接呼叫跟正式管線一樣的
    #    判定函式跑整支影片，不是只看訊號的圖形猜。揮手判定沒有放在這裡，
    #    因為它需要另外偵測手部，跟下面的 Track 4 一起看即可。
    print("\n對照組判定（用整支影片，不分窗——正式管線會依 challenges 切窗，")
    print("這裡只是想知道『這個動作有沒有在影片裡的任何時刻被偵測到』）：")
    print(f"  眨眼（blink）：{'✓ 通過' if _check_blink(frames, fps) else '✗ 沒偵測到'}")
    print(f"  左轉（turn_left）：{'✓ 通過' if _check_turn_left(frames, fps) else '✗ 沒偵測到'}")
    print(f"  右轉（turn_right）：{'✓ 通過' if _check_turn_right(frames, fps) else '✗ 沒偵測到'}")
    print("  這三個結果如果跟你實際做的動作對不起來（例如你有轉左但顯示沒偵測到，")
    print("  或者兩個方向都顯示通過），代表門檻或方向還有問題，回頭看 timeline 圖。")

    # 4. rPPG（心率）
    if len(frames) >= config.RPPG_MIN_FRAMES:
        print("\n跑 Track 2（心率）...")
        rppg = analyze_rppg(frames, fps)
        print(f"  估算心率：{rppg['heartRate']}")
        print(f"  SNR：{rppg['snr']:.2f} dB（門檻 {config.RPPG_SNR_MIN}）")
        print(
            f"  roiConsistency：{rppg['roiConsistency']:.3f}"
            f"（門檻 {config.RPPG_ROI_CONSISTENCY_MIN}）"
        )
        print(f"  detected：{rppg['detected']}")
        print("  跟你手錶/手機同時量到的心率對一下，誤差在 5 bpm 內算正常。")
        print("  注意：這是整支影片的訊號，如果影片裡有轉頭/揮手等大動作，")
        print("  動作造成的雜訊會蓋過心跳訊號，測不準是預期的，不代表演算法有問題。")
    else:
        print(f"\n影片太短（{len(frames)} 格 < {config.RPPG_MIN_FRAMES} 格），跳過 Track 2。")

    # 5. Track 4（遮擋一致性）。不指定 --track4-range 的話用整支影片，
    #    但 InsightFace 逐格偵測在 CPU 上很慢，長影片建議指定範圍。
    if track4_range:
        start_sec, end_sec = track4_range
        start_frame = max(0, int(start_sec * fps))
        end_frame = min(len(frames), int(end_sec * fps))
        track4_frames = frames[start_frame:end_frame]
        print(
            f"\n跑 Track 4（遮擋，只取 {start_sec}-{end_sec} 秒，"
            f"共 {len(track4_frames)} 格）..."
        )
    else:
        track4_frames = frames
        print(f"\n跑 Track 4（遮擋，用整支影片 {len(frames)} 格——")
        print("  InsightFace 在 CPU 上逐格跑，格數多的話會等好幾分鐘，")
        print("  下次可以加 --track4-range 開始秒 結束秒 只跑揮手那一段）...")

    occ = analyze_occlusion(track4_frames, fps)
    print(f"  偵測到 {occ['waveCyclesDetected']} 次揮手循環")
    print(
        f"  身分穩定度：{occ['identityStability']:.3f}"
        f"（門檻 {config.OCC_IDENTITY_STABILITY_MIN}）"
    )
    print(f"  最大突降：{occ['maxIdentityDrop']:.3f}（門檻 {config.OCC_MAX_DROP_THRESHOLD}）")
    print(f"  layerScore：{occ['layerScore']:.3f}（門檻 {config.OCC_LAYER_SCORE_MIN}）")
    if occ["waveCyclesDetected"] == 0:
        print("  沒偵測到揮手循環——如果你影片裡有揮手，代表手部追蹤或臉部參考框有問題。")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print("用法：python notebooks/b_03_self_test.py 你的影片.mp4 [--track4-range 開始秒 結束秒]")
        sys.exit(1)

    video_arg = args[0]
    range_arg = None
    if "--track4-range" in args:
        idx = args.index("--track4-range")
        range_arg = (float(args[idx + 1]), float(args[idx + 2]))

    main(video_arg, track4_range=range_arg)
