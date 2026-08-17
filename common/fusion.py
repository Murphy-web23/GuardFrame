"""共用｜五層分數融合與決策邏輯。

不在 CONVENTIONS §4 的固定介面契約清單裡（那份只列 A/B 分工的八個核心
函式），但 SAD 模組圖已經把 common/fusion.py 列為共用模組，依 SRS
FR-30~32 與 PLAN.md 的三段式決策設計實作。

輸入是五個 track 各自的原始回傳 dict（baseline/synthetic/rppg/
photometric/occlusion），輸出風險分數（0-100）、三段式決策、判定理由，
對應 §5.1 的 record["decision"]。

每層的風險貢獻怎麼算：
    - Track 1（合成偵測）：直接用 fakeProbability * 100——這是五層裡
      唯一本身就是連續機率值的層，不需要另外二值化。
    - 其餘四層（對照組、Track 2/3/4）：各自的三項判定已經在自己的
      analyzer 裡合起來變成一個 detected/verdict 布林值，這裡直接拿來
      當「過/沒過」，沒過記 100 分風險、過了記 0 分。不嘗試從內部的
      snr/roiConsistency/correlation/geometryScore/layerScore 等次要
      指標另外組一個連續分數——那些數字已經被各自的三項判定消化過，
      再組一次等於用一組沒有規則書依據的新公式覆蓋掉三項判定的結論。

**權重與決策區間目前是 CONVENTIONS §8 的初始值，尚未用真實資料校準**
（§8 註解本身也寫明「實測後於階段4依 ROC 校準微調」）。用現在的權重
反推 PLAN.md「五種攻擊情境的攔截分佈」表，「即時臉部重繪」那一列
（對照組✓／Track1✗／Track2部分✗／Track3✓／Track4✗）算出來確實落在
拒絕區間，但「真人光線不足」那一列（只有 Track2 部分✗）算出來只有
15 分，落在通過區間，不是表格寫的人工複核——這不是這裡的公式錯了，
是「部分✗」這種非全有全無的失效模式，用二值化風險本來就沒辦法完美
還原，也是階段4要拿真實資料校準權重與門檻的原因，不是急著在這裡
用假數字硬湊出表格數字。
"""

import config

WEIGHTS = {
    "baseline": config.WEIGHT_BASELINE,
    "synthetic": config.WEIGHT_SYNTHETIC,
    "rppg": config.WEIGHT_RPPG,
    "photometric": config.WEIGHT_PHOTOMETRIC,
    "occlusion": config.WEIGHT_OCCLUSION,
}

VERDICT_LABELS = {
    "pass": "通過",
    "review": "人工複核",
    "reject": "拒絕",
}

# 每層沒通過時的判定理由，只在該層失敗時加進 reasons。
_FAILURE_REASONS = {
    "baseline": "動作挑戰未完成，可能非真人即時操作",
    "synthetic": "偵測到疑似 AI 生成的臉部特徵",
    "rppg": "未偵測到生理訊號（心跳），影像可能為完全合成",
    "photometric": "未偵測到照明響應，影像可能未經實體鏡頭擷取",
    "occlusion": "遮擋期間身分特徵不連續，疑似即時換臉攻擊",
}

_LAYER_ORDER = ("baseline", "synthetic", "rppg", "photometric", "occlusion")


def _as_results(baseline, synthetic, rppg, photometric, occlusion):
    return {
        "baseline": baseline,
        "synthetic": synthetic,
        "rppg": rppg,
        "photometric": photometric,
        "occlusion": occlusion,
    }


def _layer_passed(name, result):
    """單層的通過與否。

    - baseline：用自己的 verdict 欄位（"pass" / "reject"）
    - synthetic：fakeProbability 是否低於 config.SYNTHETIC_THRESHOLD——
      detect_synthetic() 本身沒有回傳現成的 verdict/detected 欄位
      （見 CONVENTIONS §4.1），門檻比較放在這裡做，跟 §5.1 範例的
      synthetic.verdict 是同一個邏輯
    - 其餘（rppg / photometric / occlusion）：用各自的 detected 布林值
    """
    if name == "baseline":
        return result.get("verdict") == "pass"
    if name == "synthetic":
        return result.get("fakeProbability", 1.0) < config.SYNTHETIC_THRESHOLD
    return bool(result.get("detected"))


def _layer_risk(name, result):
    """單層的風險貢獻，0.0-100.0。"""
    if name == "synthetic":
        probability = float(result.get("fakeProbability", 0.0))
        return max(0.0, min(1.0, probability)) * 100.0
    return 0.0 if _layer_passed(name, result) else 100.0


def compute_risk_score(baseline, synthetic, rppg, photometric, occlusion):
    """五層加權融合，回傳 0-100 的整數風險分數（符合 SDS risk_score
    的 INTEGER 型別）。"""
    results = _as_results(baseline, synthetic, rppg, photometric, occlusion)
    weighted_sum = sum(WEIGHTS[name] * _layer_risk(name, results[name]) for name in _LAYER_ORDER)
    return int(round(max(0.0, min(100.0, weighted_sum))))


def compute_verdict(risk_score):
    """依風險分數區間決定三段式決策。"""
    if risk_score <= config.RISK_PASS_MAX:
        return "pass"
    if risk_score <= config.RISK_REVIEW_MAX:
        return "review"
    return "reject"


def build_reasons(baseline, synthetic, rppg, photometric, occlusion):
    """依各層是否通過，依固定順序組出判定理由列表。全部通過時回傳空列表。"""
    results = _as_results(baseline, synthetic, rppg, photometric, occlusion)
    return [
        _FAILURE_REASONS[name] for name in _LAYER_ORDER if not _layer_passed(name, results[name])
    ]


def is_baseline_missed(baseline, verdict):
    """對照組判定為「通過」，但整體決策為「拒絕」——標記為「對照組漏判」
    （SRS FR-36），供後台凸顯這類「傳統活體偵測誤判為真人、被系統
    攔下」的案件，是簡報裡很有說服力的一種案例。
    """
    return _layer_passed("baseline", baseline) and verdict == "reject"


def fuse_decision(baseline, synthetic, rppg, photometric, occlusion) -> dict:
    """五層融合的主要入口，組出完整的 decision dict（§5.1 格式）。

    參數:
        baseline: analyze_baseline() 的回傳值
        synthetic: detect_synthetic() 的回傳值
        rppg: analyze_rppg() 的回傳值
        photometric: analyze_photometric() 的回傳值
        occlusion: analyze_occlusion() 的回傳值

    回傳:
        {
            "riskScore": int,       # 0-100
            "verdict": str,         # pass | review | reject
            "verdictLabel": str,    # 通過 | 人工複核 | 拒絕
            "reasons": list[str]
        }
    """
    risk_score = compute_risk_score(baseline, synthetic, rppg, photometric, occlusion)
    verdict = compute_verdict(risk_score)
    reasons = build_reasons(baseline, synthetic, rppg, photometric, occlusion)

    return {
        "riskScore": risk_score,
        "verdict": verdict,
        "verdictLabel": VERDICT_LABELS[verdict],
        "reasons": reasons,
    }
