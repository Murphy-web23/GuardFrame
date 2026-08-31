"""Track 4｜遮擋一致性對外入口（核心防禦層）。

契約見 CONVENTIONS.md §4.6。

這是核心防禦層（見 CONVENTIONS §1、config.WEIGHT_OCCLUSION 五層中最高）：
即時換臉攻擊能通過動作挑戰（真人操作）、能通過照明挑戰（人真的在現場，
光真的照得到臉），唯有這一層——手掃過臉時換臉演算法的管線斷裂——
能抓到。

三個獨立證據拼起來判定：
    a. 有沒有偵測到至少 2 次完整的揮手遮擋循環（純粹是手部軌跡問題，
       交給 hand_tracking.py）
    b. 遮擋前後身分有沒有連續（identity.py，關鍵是「遮擋前最後一格」
       對「遮擋後第一格」的跨遮擋比較，見該模組說明）
    c. 遮擋當下手臉重疊區域的顏色，是不是真的不像臉（hand_tracking.py
       的 layerScore，抓「臉透出來」這種管線斷裂的直接證據）
"""

import numpy as np

import config
from common.risk import combine_risks, threshold_risk
from track4_occlusion import hand_tracking as ht
from track4_occlusion import identity as idt

# checks 的三個標籤，順序不可變（§4.6 規定固定 3 項）
CHECK_LABELS = (
    "偵測到至少 2 次揮手遮擋循環",
    "身分特徵連續無突變",
    "遮擋區域層級關係正確",
)


def _empty_result():
    """輸入本身無效（沒有影格、fps 不合理）時的回傳值。

    maxIdentityDrop 給 1.0、其餘分數給 0——沒有任何資料，等同於
    「沒有證據支持通過」，不能預設給樂觀值。
    """
    return {
        "detected": False,
        "waveCyclesDetected": 0,
        "identityStability": 0.0,
        "maxIdentityDrop": 1.0,
        "occlusionSegments": [],
        "layerScore": 0.0,
        "anomalyFrames": [],
        "checks": [{"label": label, "passed": False} for label in CHECK_LABELS],
        "stabilityCurve": [],
        "confidenceScore": 1.0,
    }


def _reference_face_region(face_data):
    """取所有有效偵測 bbox 的中位數，當作整段影格裡臉大致的位置，
    再擴張一個 margin 當作遮擋判定用的參考框。

    用中位數而不是平均：手勢晃動偶爾造成的偵測誤差是離群值，中位數
    比平均更不怕離群值污染。臉部位置在這 7 秒挑戰裡假設大致不變——
    使用者是在原地揮手，不是走動，這個假設在挑戰設計的前提下合理。

    參數:
        face_data: list[dict | None]，identity.extract_face_data 的輸出
    回傳:
        (x1, y1, x2, y2) | None，完全沒有有效偵測時回傳 None
    """
    boxes = [d["bbox"] for d in face_data if d is not None]
    if not boxes:
        return None
    median_box = tuple(np.median(np.array(boxes), axis=0))
    return ht.expand_bbox(median_box, config.OCC_FACE_REGION_MARGIN)


def analyze_occlusion(frames: list, fps: float) -> dict:
    """遮擋一致性檢查：使用者在臉前揮手時，身分特徵是否連續。

    參數:
        frames: list[np.ndarray]
            原始影格，RGB
            **僅傳入 wave_hand 動作的影格**（由 B 依 phases["occlusion"] 切出）
            長度固定約 210（7 秒 @ 30fps）
        fps: float

    回傳:
        {
            "detected": bool,
            "waveCyclesDetected": int,
            "identityStability": float,    # 0.0-1.0
            "maxIdentityDrop": float,       # 0.0-1.0
            "occlusionSegments": [[int, int], ...],
            "layerScore": float,            # 0.0-1.0
            "anomalyFrames": list[int],
            "checks": [                     # 固定 3 項，順序不可變
                {"label": str, "passed": bool},
                {"label": str, "passed": bool},
                {"label": str, "passed": bool}
            ],
            "stabilityCurve": list[float],  # 長度 = len(frames) - 1
            "confidenceScore": float        # 0.0-1.0，連續風險信心分數，
                                             # 數值越高代表越可疑，供
                                             # common/fusion.py 加權融合用
                                             # （§2 允許新增欄位，不在原始
                                             # 契約清單）
        }

    備註:
        執行階段的失敗一律回傳 detected=False 的完整結構，不拋例外——
        遮擋期間偵測不到臉/手是常態，CONVENTIONS §4.6 明確要求不可中斷。

        唯一的例外是 MediaPipe Hand 模型檔不存在時拋
        hand_tracking.ModelNotFoundError，那是環境沒裝好，不是影片的
        問題（比照 track2_rppg/track3_photometric 的處理方式）。
    """
    if not frames or fps <= 0:
        return _empty_result()

    try:
        face_data = idt.extract_face_data(frames)
        hand_data = ht.extract_hand_landmarks(frames, fps)
    except ht.ModelNotFoundError:
        raise
    except Exception:
        return _empty_result()

    face_region = _reference_face_region(face_data)
    segments = (
        ht.detect_wave_cycles(hand_data, face_region) if face_region is not None else []
    )

    transitions = idt.valid_transition_similarities(face_data, occlusion_segments=segments)
    identity_stability = idt.identity_stability(transitions)
    max_drop = idt.max_identity_drop(transitions)
    anomaly_frames = idt.find_anomaly_frames(transitions, config.OCC_MAX_DROP_THRESHOLD)
    stability_curve = idt.compute_stability_curve(face_data)

    layer_score = (
        ht.layer_consistency_score(frames, hand_data, face_region, segments)
        if face_region is not None
        else 0.0
    )

    # 三項判定
    # a. 至少 2 次完整揮手循環，證明是持續揮動而非單次經過。
    cycles_ok = len(segments) >= 2
    # b. 身分特徵全程連續無突變——兩個門檻分開設，因為抓的失效模式不同：
    #    平均穩定度低可能是全程都有點飄，單次最大突降高則是某一次明確
    #    的身分跳變，只看平均會被其他正常轉換稀釋掉，兩者都要過。
    identity_ok = (
        identity_stability >= config.OCC_IDENTITY_STABILITY_MIN
        and max_drop <= config.OCC_MAX_DROP_THRESHOLD
    )
    # c. 遮擋區域顏色要真的不像臉，抓「臉透出來」的破綻。
    layer_ok = layer_score >= config.OCC_LAYER_SCORE_MIN

    checks = [
        {"label": CHECK_LABELS[0], "passed": bool(cycles_ok)},
        {"label": CHECK_LABELS[1], "passed": bool(identity_ok)},
        {"label": CHECK_LABELS[2], "passed": bool(layer_ok)},
    ]

    # 連續信心分數：三項判定各自平滑成風險分數後取最大值（理由見
    # common/risk.py）。判定 b 本身是兩個門檻的 AND（穩定度、最大突降），
    # 所以先各自算風險再取最大值，跟其餘三項判定之間的組合方式一致。
    identity_risk = combine_risks(
        threshold_risk(
            identity_stability, config.OCC_IDENTITY_STABILITY_MIN,
            config.OCC_STABILITY_RISK_SCALE, higher_is_better=True,
        ),
        threshold_risk(
            max_drop, config.OCC_MAX_DROP_THRESHOLD, config.OCC_DROP_RISK_SCALE,
            higher_is_better=False,
        ),
    )
    confidence_score = combine_risks(
        threshold_risk(
            len(segments), 2, config.OCC_CYCLES_RISK_SCALE, higher_is_better=True
        ),
        identity_risk,
        threshold_risk(
            layer_score, config.OCC_LAYER_SCORE_MIN, config.OCC_LAYER_RISK_SCALE,
            higher_is_better=True,
        ),
    )

    return {
        # 三項判定全部要過，detected 才是 True——理由同 Track 2/3：
        # 不能讓最弱的一項單獨決定結果。
        "detected": bool(cycles_ok and identity_ok and layer_ok),
        "waveCyclesDetected": len(segments),
        "identityStability": float(identity_stability),
        "maxIdentityDrop": float(max_drop),
        "occlusionSegments": segments,
        "layerScore": float(layer_score),
        "anomalyFrames": anomaly_frames,
        "checks": checks,
        "stabilityCurve": stability_curve,
        "confidenceScore": confidence_score,
    }
