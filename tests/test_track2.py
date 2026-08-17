"""Track 2 對外契約與容錯測試。

驗的是 analyze_rppg() 的回傳結構是否符合 CONVENTIONS.md §4.4，
以及各種壞輸入會不會讓程式掛掉。

需要真實影片的端到端測試等錄好素材後另外補；
這裡只跑不需要 MediaPipe 模型檔的路徑。
"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config
from track2_rppg import analyzer
from track2_rppg import signal_utils as su

CONTRACT_KEYS = {
    "detected",
    "heartRate",
    "snr",
    "roiConsistency",
    "checks",
    "waveform",
    "spectrum",
}


def assert_matches_contract(result):
    """§4.4 規定的欄位與型別，一項都不能少或多。"""
    assert set(result) == CONTRACT_KEYS, f"欄位對不上：{set(result) ^ CONTRACT_KEYS}"

    assert isinstance(result["detected"], bool)
    assert result["heartRate"] is None or isinstance(result["heartRate"], float)
    assert isinstance(result["snr"], float)
    assert isinstance(result["roiConsistency"], float)
    assert 0.0 <= result["roiConsistency"] <= 1.0

    assert isinstance(result["checks"], list)
    assert len(result["checks"]) == 3, "checks 固定 3 項"
    for check in result["checks"]:
        assert set(check) == {"label", "passed"}
        assert isinstance(check["label"], str) and check["label"]
        assert isinstance(check["passed"], bool)

    assert isinstance(result["waveform"], list)
    assert isinstance(result["spectrum"], list)


# --------------------------------------------------------------------------
# 壞輸入不能讓程式掛掉
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "frames, fps",
    [
        ([], 30.0),
        (None, 30.0),
        ([np.zeros((64, 64, 3), np.uint8)] * 100, 0.0),
        ([np.zeros((64, 64, 3), np.uint8)] * 100, -5.0),
        ([np.zeros((64, 64, 3), np.uint8)] * 10, 30.0),  # 影格數不足
    ],
)
def test_bad_input_returns_valid_structure(frames, fps):
    """壞輸入要回傳格式正確的失敗結果，不能拋例外。"""
    result = analyzer.analyze_rppg(frames, fps)

    assert_matches_contract(result)
    assert result["detected"] is False
    assert result["heartRate"] is None
    assert result["waveform"] == []
    assert result["spectrum"] == []
    assert all(not c["passed"] for c in result["checks"])


def test_missing_model_raises_with_download_url(monkeypatch, tmp_path):
    """模型檔不存在時要明確報錯，並在訊息裡附上下載網址。

    這是唯一會拋例外的路徑。環境沒裝好卻靜默回傳 detected=False 的話，
    人會跑去 debug 演算法，找很久才發現只是少一個檔案。
    """
    monkeypatch.setattr(config, "MEDIAPIPE_FACE_MODEL", tmp_path / "nope.task")

    frames = [np.zeros((64, 64, 3), np.uint8)] * (config.RPPG_MIN_FRAMES + 10)

    with pytest.raises(analyzer.ModelNotFoundError) as excinfo:
        analyzer.analyze_rppg(frames, 30.0)

    assert config.MEDIAPIPE_FACE_MODEL_URL in str(excinfo.value)


def test_check_labels_are_fixed_and_ordered():
    """§4.4 說 checks 固定 3 項且順序不可變，前端與資料庫都吃這個順序。"""
    result = analyzer.analyze_rppg([], 30.0)

    assert [c["label"] for c in result["checks"]] == list(analyzer.CHECK_LABELS)


# --------------------------------------------------------------------------
# detected 必須三項判定全過（2026-08-14 修正的安全邊界）
#
# 真人 vs 攻擊樣本的分離度，roiConsistency（2.3-2.6 倍）比 SNR（1.6-2 dB）
# 穩定得多，見 PHASE1_NOTES.md §5.4。如果 detected 只看 a、b 兩項，
# 一支 SNR 剛好壓線過關、但 roiConsistency 很差的攻擊樣本就會被誤判為
# detected=True —— 這裡用 monkeypatch 直接控制三個 ROI 的心率與 SNR，
# 不需要真的影片就能驗證這個邊界。
# --------------------------------------------------------------------------


def _patch_roi_pipeline(monkeypatch, roi_results_in_order):
    """讓 analyze_rppg 的三個 ROI 依序回傳指定的 (heart_rate, snr)，跳過真的訊號處理。"""
    frames = [np.zeros((64, 64, 3), np.uint8)] * (config.RPPG_MIN_FRAMES + 10)
    landmarks = [np.zeros((478, 2))] * len(frames)

    monkeypatch.setattr(analyzer, "extract_landmarks", lambda f, fps: landmarks)
    monkeypatch.setattr(
        su, "extract_roi_signal", lambda f, lms, idx: np.zeros((len(f), 3))
    )

    results = iter(
        {
            "heart_rate": hr,
            "snr": snr,
            "filtered": np.zeros(10),
            "psd": np.ones(10),
            "freqs": np.linspace(0, 4, 10),
        }
        for hr, snr in roi_results_in_order
    )
    monkeypatch.setattr(analyzer, "_analyze_single_roi", lambda sig, fps: next(results))

    return frames


def test_detected_false_when_snr_passes_but_consistency_fails(monkeypatch):
    """SNR 壓線過關但三 ROI 心率差很遠時，detected 不能是 True。

    對應 ROI_DEFINITIONS 的固定順序（額頭、左頰、右頰）：
    左頰的 SNR 全場最高（會被選為代表值），但心率跟另外兩個差了 26 bpm。
    45.0 仍在 0.7-4 Hz 帶通範圍內（42-240 bpm），確保卡住的是一致性判定，
    不是主頻範圍判定。
    """
    frames = _patch_roi_pipeline(
        monkeypatch,
        [(70.0, 1.0), (45.0, 5.0), (71.0, 1.2)],  # 額頭、左頰、右頰
    )

    result = analyzer.analyze_rppg(frames, 30.0)

    assert result["heartRate"] == pytest.approx(45.0), "代表值仍應取 SNR 最高的 ROI"
    assert result["snr"] == pytest.approx(5.0)
    assert result["roiConsistency"] < config.RPPG_ROI_CONSISTENCY_MIN
    assert result["checks"][1]["passed"] is True, "b. SNR 這項單獨看是過的"
    assert result["checks"][2]["passed"] is False, "c. 一致性沒過"
    assert result["detected"] is False, "即使 a、b 都過，c 沒過就不能是 detected=True"


def test_detected_true_when_all_three_checks_pass(monkeypatch):
    """反例：三項都過時 detected 才應該是 True，避免上面的修正矯枉過正。"""
    frames = _patch_roi_pipeline(
        monkeypatch,
        [(70.0, 4.0), (71.0, 5.0), (69.5, 4.5)],
    )

    result = analyzer.analyze_rppg(frames, 30.0)

    assert result["roiConsistency"] >= config.RPPG_ROI_CONSISTENCY_MIN
    assert all(c["passed"] for c in result["checks"])
    assert result["detected"] is True


# --------------------------------------------------------------------------
# ROI 索引的健全性（不需要模型檔就能驗）
# --------------------------------------------------------------------------


def test_roi_definitions_are_sane():
    """三組 ROI 索引都要落在 478 點的範圍內，且組內不重複。"""
    assert set(analyzer.ROI_DEFINITIONS) == {"forehead", "left_cheek", "right_cheek"}

    for name, indices in analyzer.ROI_DEFINITIONS.items():
        assert len(indices) >= 3, f"{name} 至少要 3 點才圍得出區域"
        assert len(set(indices)) == len(indices), f"{name} 有重複索引"
        assert all(0 <= i < 478 for i in indices), f"{name} 索引超出 478 點範圍"


def test_rois_do_not_overlap_each_other():
    """三個 ROI 不能共用關鍵點，否則三組訊號不獨立，一致性判定就沒意義了。"""
    seen = set()
    for name, indices in analyzer.ROI_DEFINITIONS.items():
        clash = seen & set(indices)
        assert not clash, f"{name} 與其他 ROI 共用索引 {clash}"
        seen |= set(indices)


def test_cheek_rois_are_mirror_pairs():
    """左右頰必須是一一對應的鏡像點。

    MediaPipe 的左右對稱點索引差固定落在 220-230，
    這是從官方 FACE_LANDMARKS_LEFT/RIGHT_EYEBROW 清單推導出來的。
    對不上就表示選錯點，兩頰量的不是對稱位置。
    """
    left = analyzer.LEFT_CHEEK_INDICES
    right = analyzer.RIGHT_CHEEK_INDICES

    assert len(left) == len(right), "左右頰點數不一致"
    for l, r in zip(left, right):
        assert 220 <= r - l <= 230, f"{l} 與 {r} 不是鏡像對（差 {r - l}）"


def test_rois_avoid_eyes_and_mouth():
    """ROI 不能碰到眼睛與嘴唇。

    眨眼與說話造成的像素變化比心跳大兩個數量級，
    ROI 只要沾到一點就會把心跳訊號淹掉。
    """
    pytest.importorskip("mediapipe")
    from mediapipe.tasks.python.vision import FaceLandmarksConnections as C

    def points_of(connections):
        return {c.start for c in connections} | {c.end for c in connections}

    forbidden = (
        points_of(C.FACE_LANDMARKS_LEFT_EYE)
        | points_of(C.FACE_LANDMARKS_RIGHT_EYE)
        | points_of(C.FACE_LANDMARKS_LIPS)
        | points_of(C.FACE_LANDMARKS_LEFT_IRIS)
        | points_of(C.FACE_LANDMARKS_RIGHT_IRIS)
    )

    for name, indices in analyzer.ROI_DEFINITIONS.items():
        clash = forbidden & set(indices)
        assert not clash, f"{name} 碰到眼睛或嘴唇：{clash}"


def test_cheek_rois_avoid_nose_and_face_oval():
    """雙頰要落在臉部內側，不能沾到鼻子或臉部輪廓。

    輪廓點在臉的邊緣，容易框到背景；鼻子是立體的，受光角度與臉頰不同。
    額頭不在這項檢查裡 —— 它本來就是拿髮際線輪廓與眉毛當上下界圍出來的。
    """
    pytest.importorskip("mediapipe")
    from mediapipe.tasks.python.vision import FaceLandmarksConnections as C

    def points_of(connections):
        return {c.start for c in connections} | {c.end for c in connections}

    forbidden = points_of(C.FACE_LANDMARKS_NOSE) | points_of(
        C.FACE_LANDMARKS_FACE_OVAL
    )

    for name in ("left_cheek", "right_cheek"):
        clash = forbidden & set(analyzer.ROI_DEFINITIONS[name])
        assert not clash, f"{name} 碰到鼻子或臉部輪廓：{clash}"


# --------------------------------------------------------------------------
# ROI 一致度的映射
# --------------------------------------------------------------------------


def test_roi_consistency_mapping():
    """一致度公式要與 config 的門檻對得上。

    設計目標：差 5 bpm 剛好等於 RPPG_ROI_CONSISTENCY_MIN(0.75)，
    這樣「互相差異 < 5 bpm」與「consistency >= 0.75」是同一條線。
    """
    assert analyzer._roi_consistency([72.0, 72.0, 72.0]) == pytest.approx(1.0)
    assert analyzer._roi_consistency([70.0, 72.0, 75.0]) == pytest.approx(
        config.RPPG_ROI_CONSISTENCY_MIN
    )
    assert analyzer._roi_consistency([60.0, 72.0, 90.0]) == pytest.approx(0.0)
    assert analyzer._roi_consistency([40.0, 72.0, 140.0]) == 0.0  # 不會變成負的
    assert analyzer._roi_consistency([72.0]) == 0.0  # 只有一組沒有一致性可言


def test_roi_consistency_uses_worst_pair():
    """兩個 ROI 很接近、第三個離群時要扣分，不能被平均掩蓋。

    這正是換臉的破綻：只換了臉部核心區，額頭與臉頰的訊號就會分家。
    """
    tight = analyzer._roi_consistency([72.0, 72.5, 73.0])
    outlier = analyzer._roi_consistency([72.0, 72.5, 88.0])

    assert tight > 0.9
    assert outlier < config.RPPG_ROI_CONSISTENCY_MIN


# --------------------------------------------------------------------------
# 端到端：需要 MediaPipe 模型檔
#
# 用程式畫一張臉、讓皮膚區域的綠通道隨心跳週期變化，合成一段「有心跳」的影片。
# 不需要攝影機也不需要真人，但涵蓋了 MediaPipe 偵測 → ROI 定位 → 訊號處理
# → 契約輸出的完整路徑。
# --------------------------------------------------------------------------

requires_model = pytest.mark.skipif(
    not config.MEDIAPIPE_FACE_MODEL.exists(),
    reason=f"缺少 MediaPipe 模型檔：{config.MEDIAPIPE_FACE_MODEL}",
)

E2E_BPM = 72.0
E2E_FPS = 30.0


def _draw_face(w=320, h=320):
    """畫一張 MediaPipe 認得出來的臉。"""
    import cv2

    img = np.full((h, w, 3), 235, np.uint8)
    cv2.ellipse(img, (160, 167), (87, 117), 0, 0, 360, (205, 170, 145), -1)
    for cx in (130, 190):
        cv2.ellipse(img, (cx, 143), (17, 10), 0, 0, 360, (250, 250, 250), -1)
        cv2.circle(img, (cx, 143), 7, (60, 40, 30), -1)
        cv2.circle(img, (cx, 143), 3, (0, 0, 0), -1)
        cv2.ellipse(img, (cx, 127), (20, 7), 0, 180, 360, (70, 50, 40), 3)
    cv2.ellipse(img, (160, 177), (11, 20), 0, 0, 180, (170, 135, 115), 2)
    cv2.ellipse(img, (160, 213), (32, 16), 0, 0, 180, (140, 80, 80), 3)
    return img


def _synthetic_face_video(bpm=E2E_BPM, fps=E2E_FPS, duration=20.0, pulse_amplitude=2.5):
    """合成一段臉部隨心跳變色的影片。

    只有皮膚區域跟著脈動，背景不動 —— 真實 rPPG 就是這樣。
    振幅 2.5 相當於基準值的 1.5%，接近真實影片裡心跳造成的變化量。
    """
    import cv2

    base = _draw_face()
    skin = np.zeros(base.shape[:2], np.uint8)
    cv2.ellipse(skin, (160, 167), (87, 117), 0, 0, 360, 255, -1)
    skin_mask = skin > 0

    rng = np.random.default_rng(0)
    frames = []
    for t in np.arange(0.0, duration, 1.0 / fps):
        frame = base.astype(np.float32)
        frame[skin_mask, 1] += pulse_amplitude * np.sin(2.0 * np.pi * (bpm / 60.0) * t)
        frame += rng.normal(0, 0.6, frame.shape)  # 感測器雜訊
        frame += 3.0 * t / duration  # 環境光緩慢漂移
        frames.append(np.clip(frame, 0, 255).astype(np.uint8))

    return frames


@pytest.fixture(scope="module")
def synthetic_video():
    return _synthetic_face_video()


@requires_model
def test_end_to_end_recovers_heart_rate(synthetic_video):
    """完整跑一次 analyze_rppg，心率誤差要在專案目標的 5 bpm 內。"""
    result = analyzer.analyze_rppg(synthetic_video, E2E_FPS)

    assert_matches_contract(result)
    assert result["detected"] is True, f"沒偵測到心跳，snr={result['snr']:.2f}"

    error = abs(result["heartRate"] - E2E_BPM)
    assert error < 5.0, f"估算 {result['heartRate']:.2f} bpm，目標 {E2E_BPM}，誤差 {error:.2f}"

    assert result["snr"] >= config.RPPG_SNR_MIN
    assert len(result["waveform"]) == config.RPPG_WAVEFORM_POINTS
    assert len(result["spectrum"]) == config.RPPG_SPECTRUM_POINTS
    assert all(c["passed"] for c in result["checks"])


@requires_model
def test_end_to_end_rois_agree(synthetic_video):
    """三個 ROI 量的是同一顆心臟，一致度要接近 1.0。"""
    result = analyzer.analyze_rppg(synthetic_video, E2E_FPS)

    assert result["roiConsistency"] >= config.RPPG_ROI_CONSISTENCY_MIN


@requires_model
def test_analyze_rppg_is_reusable(synthetic_video):
    """連續呼叫兩次要得到相同結果。

    回歸測試：MediaPipe 的 VIDEO 模式要求 timestamp 嚴格遞增，
    如果把 FaceLandmarker 快取成全域變數，第二次呼叫的 timestamp
    又從 0 開始，整支影片的影格會被 MediaPipe 全部丟掉，
    結果靜默變成 detected=False。API 每個請求處理一支影片，
    快取的話第二個請求就壞了。
    """
    first = analyzer.analyze_rppg(synthetic_video, E2E_FPS)
    second = analyzer.analyze_rppg(synthetic_video, E2E_FPS)

    assert second["detected"] == first["detected"] is True
    assert second["heartRate"] == pytest.approx(first["heartRate"], abs=0.01)


@requires_model
def test_no_face_returns_not_detected():
    """畫面裡沒有臉時要回傳 detected=False，不能拋例外。"""
    rng = np.random.default_rng(1)
    frames = [rng.integers(0, 255, (240, 320, 3), dtype=np.uint8) for _ in range(120)]

    result = analyzer.analyze_rppg(frames, E2E_FPS)

    assert_matches_contract(result)
    assert result["detected"] is False
    assert result["heartRate"] is None
