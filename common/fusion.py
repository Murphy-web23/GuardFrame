"""共用｜四層分數融合與決策邏輯（原五層，2026-08-29 起 Track2 rPPG 停用）。

Track2（rPPG）已不參與這裡的風險融合，理由與依據見
track2_rppg/analyzer.py::disabled_result() 的說明。程式碼本身沒有刪除，
`/verify` 仍會呼叫 disabled_result() 把固定形狀的結果存進資料庫、回傳給
前端（維持既有欄位相容），只是這裡的加權融合不再把它算進去。

不在 CONVENTIONS §4 的固定介面契約清單裡（那份只列 A/B 分工的八個核心
函式），但 SAD 模組圖已經把 common/fusion.py 列為共用模組，依 SRS
FR-30~32 與 PLAN.md 的三段式決策設計實作。

輸入是五個 track 各自的原始回傳 dict（baseline/synthetic/rppg/
photometric/occlusion），輸出風險分數（0-100）、三段式決策、判定理由，
對應 §5.1 的 record["decision"]。

每層的風險貢獻怎麼算（2026-08-19 改版：統一信心分數）：
    五層現在都輸出一個 0.0-1.0 的連續信心分數，數值越高代表越可疑，
    權重直接乘上這個分數，不再二值化：
        - Track 1（合成偵測）：`fakeProbability`——分類器的原始輸出，
          §4.1 契約本來就有的欄位
        - 對照組、Track 2/3/4：`confidenceScore`——這次新增的欄位
          （§2 允許新增，不能改名或刪除既有欄位），由各自的 analyzer
          內部用 `common/risk.py` 的 sigmoid 把「數值 vs 門檻」的判定
          平滑算出來，同一個 track 裡多項判定取最大值（不是平均），
          理由見 `common/risk.py`

    **改版前**（二值化）：對照組/Track 2-4 只有「過/沒過」，沒過記 100
    分風險、過了記 0 分，剛好卡在門檻附近沒過、跟差很遠沒過，風險貢獻
    完全一樣。**改版後**：風險貢獻反映「這一層的證據有多強」，不只是
    「有沒有超過一條線」——例如 Track 4 的身分穩定度剛好卡在 0.89（門檻
    0.90）跟直接掉到 0.3，現在會算出明顯不同的風險貢獻，而不是都算
    「沒過 = 100 分風險」。

    **信心分數不是校準過的統計機率**，sigmoid 的平滑寬度（config 裡的
    `*_RISK_SCALE`）目前都是合理猜測，只有 Track 2 的 SNR 那個有真實
    資料依據（PHASE1_NOTES §5.4 記錄的真人/攻擊分離度），其餘待真實
    資料校準，跟專案裡其他還沒校準的門檻是同一類狀況。

**權重與決策區間目前是 CONVENTIONS §8 的初始值，尚未用真實資料校準**
（§8 註解本身也寫明「實測後於階段4依 ROC 校準微調」）。用現在的權重
反推 PLAN.md「五種攻擊情境的攔截分佈」表，「即時臉部重繪」那一列
（對照組✓／Track1✗／Track2部分✗／Track3✓／Track4✗）算出來確實落在
拒絕區間，這件事在改版前後都成立。「真人光線不足」那一列（只有
Track2 部分✗）在改版前二值化只算 15 分（落在通過區間，不是表格寫的
人工複核）；改版後因為 Track 2 的信心分數會依實際 SNR/一致性偏離門檻
的程度連續變化，這個落差理論上會縮小，但**縮小多少沒有實測過**，兩種
版本的門檻校準都要等真實資料，不是急著在這裡用假數字硬湊出表格數字。
"""

import config

WEIGHTS = {
    "baseline": config.WEIGHT_BASELINE,
    "synthetic": config.WEIGHT_SYNTHETIC,
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
    "photometric": "未偵測到照明響應，影像可能未經實體鏡頭擷取",
    "occlusion": "遮擋期間身分特徵不連續，疑似即時換臉攻擊",
}

_LAYER_ORDER = ("baseline", "synthetic", "photometric", "occlusion")


def _as_results(baseline, synthetic, photometric, occlusion):
    return {
        "baseline": baseline,
        "synthetic": synthetic,
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
    """單層的風險貢獻，0.0-100.0。

    Track 1 用 `fakeProbability`（§4.1 契約本來就有的欄位），其餘四層
    用 `confidenceScore`（這次新增的欄位，見模組頂部說明）。兩者意義
    一致：0.0-1.0，數值越高代表越可疑，直接乘 100 當風險貢獻。
    """
    key = "fakeProbability" if name == "synthetic" else "confidenceScore"
    score = float(result.get(key, 1.0))
    return max(0.0, min(1.0, score)) * 100.0


def compute_risk_score(baseline, synthetic, photometric, occlusion):
    """四層加權融合，回傳 0-100 的整數風險分數（符合 SDS risk_score
    的 INTEGER 型別）。"""
    results = _as_results(baseline, synthetic, photometric, occlusion)
    weighted_sum = sum(WEIGHTS[name] * _layer_risk(name, results[name]) for name in _LAYER_ORDER)
    return int(round(max(0.0, min(100.0, weighted_sum))))


def compute_verdict(risk_score):
    """依風險分數區間決定三段式決策。"""
    if risk_score <= config.RISK_PASS_MAX:
        return "pass"
    if risk_score <= config.RISK_REVIEW_MAX:
        return "review"
    return "reject"


def build_reasons(baseline, synthetic, photometric, occlusion):
    """依各層是否通過，依固定順序組出判定理由列表。全部通過時回傳空列表。"""
    results = _as_results(baseline, synthetic, photometric, occlusion)
    return [
        _FAILURE_REASONS[name] for name in _LAYER_ORDER if not _layer_passed(name, results[name])
    ]


def failed_layers(baseline, synthetic, photometric, occlusion) -> list[str]:
    """回傳沒通過的層名稱（"baseline"/"synthetic"/"photometric"/"occlusion"）。

    跟 build_reasons() 是同一份判定，只是回傳給人看的理由文字換成層的
    識別字串——2026-08-29 新增，給 api/routes.py 決定「該把哪些層的
    畫面送去給 VLM 看」用（原本寫死只送 Track4 的異常影格，但造成
    review 判定的不一定是 Track4，也可能是 Track1/3）。
    """
    results = _as_results(baseline, synthetic, photometric, occlusion)
    return [name for name in _LAYER_ORDER if not _layer_passed(name, results[name])]


def is_baseline_missed(baseline, verdict):
    """對照組判定為「通過」，但整體決策為「拒絕」——標記為「對照組漏判」
    （SRS FR-36），供後台凸顯這類「傳統活體偵測誤判為真人、被系統
    攔下」的案件，是簡報裡很有說服力的一種案例。
    """
    return _layer_passed("baseline", baseline) and verdict == "reject"


def fuse_decision(baseline, synthetic, photometric, occlusion) -> dict:
    """四層融合的主要入口，組出完整的 decision dict（§5.1 格式）。

    參數:
        baseline: analyze_baseline() 的回傳值
        synthetic: detect_synthetic() 的回傳值
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
    risk_score = compute_risk_score(baseline, synthetic, photometric, occlusion)
    verdict = compute_verdict(risk_score)
    reasons = build_reasons(baseline, synthetic, photometric, occlusion)

    return {
        "riskScore": risk_score,
        "verdict": verdict,
        "verdictLabel": VERDICT_LABELS[verdict],
        "reasons": reasons,
    }
