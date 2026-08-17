"""對照組｜隨機動作挑戰對外入口。

契約見 CONVENTIONS.md §4.3。

傳統活體偵測：依序驗證使用者是否完成眨眼、左轉、右轉、揮手四個動作。
四個動作固定時長、一律播滿，只有出現順序隨機——判定方式是「該動作的
時間視窗內，是否在任一時刻偵測到符合條件」，不要求動作發生在視窗的
特定位置。

**這一組必須認真實作，不得刻意做弱**——它要是一個合理有效的傳統活體
偵測，被新型攻擊（即時換臉）繞過才有說服力，這是整個系統論證的起點。

技術選擇：頭部左右轉沒有照 PLAN.md 建議的「讀取頭部變換矩陣的 yaw 角」，
改用鼻尖到左右臉頰邊緣的距離不對稱比例。理由：MediaPipe 的
facial_transformation_matrixes 是一個 4x4 剛體變換矩陣，要從中解出 yaw
角需要知道 MediaPipe 內部用的是哪一種歐拉角分解慣例（旋轉軸順序、
正負號方向），這件事無法只憑文件確認，需要一支真的轉頭的影片、
已知轉頭方向去對照才能驗證解出來的角度對不對——而現在沒有這樣的影片。
改用關鍵點幾何比例後，正確性可以直接用合成座標驗證（見
tests/test_baseline.py），不用等真實影片。代價是這是自創的量化方式，
沒有文獻參考值，方向與門檻都必須在有真實轉頭影片後重新驗證，
見 config.BASELINE_YAW_RATIO_MIN 的註解。
"""

import numpy as np

import config
from common.landmarks import ModelNotFoundError, extract_landmarks
from track4_occlusion import hand_tracking as ht
from track4_occlusion import identity as idt

ACTION_NAMES = {
    "blink": "眨眼",
    "turn_left": "頭部向左轉",
    "turn_right": "頭部向右轉",
    "wave_hand": "臉前揮手",
}

STANDARD_LABEL = "ISO/IEC 30107-3 動作挑戰"

# --------------------------------------------------------------------------
# 眨眼：EAR（Eye Aspect Ratio）
#
# 六點公式：p1、p4 是眼角（水平），p2/p3 是上眼瞼，p5/p6 是下眼瞼。
# EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)，睜眼時上下眼瞼距離大、
# EAR 較高；閉眼時上下眼瞼幾乎貼在一起、EAR 驟降。
#
# 索引取自 MediaPipe FaceMesh 478 點拓撲裡最常被引用的六點眼部子集，
# 跟 track2_rppg/analyzer.py 的額頭/臉頰索引一樣尚未用真實影片目視驗證
# 過，第一次用真實影片跑之前建議先確認一次。
# --------------------------------------------------------------------------

RIGHT_EYE_INDICES = (33, 160, 158, 133, 153, 144)
LEFT_EYE_INDICES = (362, 385, 387, 263, 373, 380)


def _ear(landmarks, indices):
    p1, p2, p3, p4, p5, p6 = (landmarks[i] for i in indices)
    vertical = np.linalg.norm(p2 - p6) + np.linalg.norm(p3 - p5)
    horizontal = np.linalg.norm(p1 - p4)
    if horizontal < 1e-6:
        return 1.0  # 退化成一個點時，給一個不會被誤判成眨眼的高值
    return float(vertical / (2.0 * horizontal))


def _average_ear(landmarks):
    return (_ear(landmarks, LEFT_EYE_INDICES) + _ear(landmarks, RIGHT_EYE_INDICES)) / 2.0


def _has_blink_pattern(ear_values, threshold):
    """序列中是否存在「睜眼→閉眼→睜眼」的完整型態。

    只要求「曾經低於閾值、之後又回到閾值以上」，不要求從睜眼狀態開始——
    3 秒視窗一開始眼睛剛好在閉合中也算合理。

    參數:
        ear_values: np.ndarray，可能含 np.nan（缺偵測的格）
        threshold: float
    回傳:
        bool
    """
    valid = ear_values[~np.isnan(ear_values)]
    if len(valid) < 3:
        return False

    closed = False
    for value in valid:
        if value < threshold:
            closed = True
        elif closed:
            return True
    return False


def _check_blink(frames, fps):
    landmarks_list = extract_landmarks(frames, fps)
    ear_values = np.array(
        [_average_ear(lm) if lm is not None else np.nan for lm in landmarks_list]
    )
    return _has_blink_pattern(ear_values, config.BASELINE_EAR_THRESHOLD)


# --------------------------------------------------------------------------
# 左轉／右轉：鼻尖到左右臉頰邊緣的距離不對稱比例
#
# 正面時鼻尖大致落在左右臉頰邊緣的中點，兩側距離幾乎相等。頭轉向一側時，
# 透視效果讓「轉向的那一側」在畫面上被壓縮，鼻尖到該側邊緣的距離變短，
# 另一側則相對變長，兩者的不對稱程度隨轉頭幅度變大。
#
# 索引同樣是 MediaPipe FaceMesh 常見的鼻尖／臉頰邊緣點，方向與門檻都
# 待真實影片驗證，見模組頂部與 config.BASELINE_YAW_RATIO_MIN 的說明。
# --------------------------------------------------------------------------

NOSE_TIP_INDEX = 1
LEFT_FACE_EDGE_INDEX = 234
RIGHT_FACE_EDGE_INDEX = 454

# 動作名稱到不對稱比例正負號的對應——哪個方向算「正」是目前的假設，
# 待真實影片驗證方向是否正確，見模組頂部說明。
_YAW_SIGN = {"turn_left": 1.0, "turn_right": -1.0}


def _yaw_ratio(landmarks):
    """頭部左右轉的不對稱比例，範圍理論上在 -1 到 1 之間。

    正值：鼻尖比較靠近 LEFT_FACE_EDGE_INDEX 那一側（d_left 較小、
    d_right 較大）。負值則相反，鼻尖比較靠近 RIGHT_FACE_EDGE_INDEX 那側。

    這只是「鼻尖偏向畫面裡的哪一側」的數學方向，跟 challenges 裡
    turn_left／turn_right 這兩個動作標籤實際對應哪個正負號，是另一回事
    ——見模組頂部與 config.BASELINE_YAW_RATIO_MIN 的說明，那個對應
    目前是待真實影片驗證的假設，不是這裡在驗證的東西。
    """
    nose = landmarks[NOSE_TIP_INDEX]
    left_edge = landmarks[LEFT_FACE_EDGE_INDEX]
    right_edge = landmarks[RIGHT_FACE_EDGE_INDEX]

    d_left = np.linalg.norm(nose - left_edge)
    d_right = np.linalg.norm(nose - right_edge)
    total = d_left + d_right
    if total < 1e-6:
        return 0.0
    return float((d_right - d_left) / total)


def _check_turn(action, frames, fps):
    landmarks_list = extract_landmarks(frames, fps)
    ratios = [_yaw_ratio(lm) for lm in landmarks_list if lm is not None]
    if not ratios:
        return False

    sign = _YAW_SIGN[action]
    return any(sign * r >= config.BASELINE_YAW_RATIO_MIN for r in ratios)


def _check_turn_left(frames, fps):
    return _check_turn("turn_left", frames, fps)


def _check_turn_right(frames, fps):
    return _check_turn("turn_right", frames, fps)


# --------------------------------------------------------------------------
# 揮手：重用 track4_occlusion 的手部循環偵測
#
# §4.3 只要求判定「是否偵測到有效的揮手動作」（手部進入/離開臉部區域
# 至少 2 次循環），這跟 Track 4 的 detect_wave_cycles() 是同一件事，
# 差別只在這裡不需要 Track 4 額外做的身分連續性與層級檢查。直接重用
# 已經驗證過的邏輯，不要重新寫一份——這段影格之後還會另外整段交給
# analyze_occlusion() 做完整分析，兩邊各自獨立呼叫，會重算一次臉部/
# 手部偵測，這是介面契約本身的設計（各自接收 frames 各跑一次），
# 效能優化留待階段3。
# --------------------------------------------------------------------------


def _check_wave_hand(frames, fps):
    face_data = idt.extract_face_data(frames)
    hand_data = ht.extract_hand_landmarks(frames, fps)

    boxes = [d["bbox"] for d in face_data if d is not None]
    if not boxes:
        return False

    face_region = ht.expand_bbox(
        tuple(np.median(np.array(boxes), axis=0)), config.OCC_FACE_REGION_MARGIN
    )
    segments = ht.detect_wave_cycles(hand_data, face_region)
    return len(segments) >= 2


_CHECKS = {
    "blink": _check_blink,
    "turn_left": _check_turn_left,
    "turn_right": _check_turn_right,
    "wave_hand": _check_wave_hand,
}


def _reject_result(challenges):
    """輸入本身無效時的回傳值：四項都標記未通過。"""
    return {
        "standard": STANDARD_LABEL,
        "challenges": [
            {
                "action": c.get("action"),
                "name": ACTION_NAMES.get(c.get("action"), ""),
                "durationSec": c.get("durationSec"),
                "passed": False,
            }
            for c in (challenges or [])
        ],
        "verdict": "reject",
        "verdictLabel": "動作挑戰未完成",
    }


def analyze_baseline(frames: list, fps: float, challenges: list) -> dict:
    """傳統活體偵測：驗證使用者是否依序完成指定動作。

    參數:
        frames: list[np.ndarray]
            原始影格（未裁切），RGB，uint8
            **僅傳入動作挑戰階段的影格**（由 B 依 phases["action"] 切出，
            此區間涵蓋全部四個動作，總長固定 20 秒）
        fps: float
        challenges: list[dict]
            本次的動作順序，四項皆須完成，僅順序隨機

    回傳:
        {
            "standard": "ISO/IEC 30107-3 動作挑戰",
            "challenges": [
                {"action": str, "name": str, "durationSec": int, "passed": bool}
            ],
            "verdict": "pass" | "reject",
            "verdictLabel": str
        }

    備註:
        執行階段的失敗一律回傳該項 passed=False，不拋例外，跟其餘 track
        一致。唯一的例外是任一模型檔不存在（MediaPipe 臉部或手部模型），
        那是環境沒裝好，不是影片的問題。
    """
    if not frames or fps <= 0 or not challenges:
        return _reject_result(challenges)

    results = []
    start = 0
    for item in challenges:
        duration_frames = max(int(round(item["durationSec"] * fps)), 0)
        end = min(start + duration_frames, len(frames))
        window = frames[start:end]

        try:
            passed = _CHECKS[item["action"]](window, fps) if window else False
        except (ModelNotFoundError, ht.ModelNotFoundError):
            raise
        except Exception:
            passed = False

        results.append(
            {
                "action": item["action"],
                "name": ACTION_NAMES.get(item["action"], ""),
                "durationSec": item["durationSec"],
                "passed": bool(passed),
            }
        )
        start = end

    verdict_pass = all(r["passed"] for r in results)
    return {
        "standard": STANDARD_LABEL,
        "challenges": results,
        "verdict": "pass" if verdict_pass else "reject",
        "verdictLabel": "判定為真人" if verdict_pass else "動作挑戰未完成",
    }
