"""共用｜把「數值 vs 門檻」的判定平滑成 0.0-1.0 的信心分數。

不在 CONVENTIONS §4 固定契約清單裡，是這次把各 track 的判定從二值化
（純粹的 True/False）改成連續信心分數時新增的共用工具，供
track2_rppg／track3_photometric／track4_occlusion／baseline_challenge
共用。

**為什麼要改成連續信心分數**：原本每個 track 的三項判定各自是
True/False，最後 `detected` 是三項的 AND。這個布林值送進
`common/fusion.py` 加權融合時，「剛好卡在門檻附近沒過」跟「離門檻
非常遠、完全沒過」在風險分數上是一樣的（都算沒過、貢獻同樣的風險）——
這會丟失資訊。改成連續信心分數後，權重 × 信心分數才能反映「這一層
的證據有多強」，不只是「有沒有超過一條線」。

**信心分數不是校準過的統計機率**，只是一個「越接近門檻越不確定、
越遠離門檻越確定」的平滑量測，跟 Track 1（合成偵測）分類器輸出的
`fakeProbability` 意義不完全一樣——那個至少理論上可以校準成真正的
機率，這裡的 sigmoid 中心點跟寬度目前都是合理猜測，沒有真實資料驗證過
（跟專案裡其他還沒校準的門檻是同一類狀況，見 PHASE1_NOTES）。
"""

import math


def threshold_risk(value, threshold, scale, higher_is_better):
    """把一個數值相對門檻的位置，映射成 0.0-1.0 的風險分數。

    數值剛好等於門檻時，風險分數固定是 0.5（不確定），這是這個函式的
    設計基準點，不受 scale 影響。

    參數:
        value: float，實際量測值（例如 SNR、correlation、maxIdentityDrop）
        threshold: float，判定門檻（通常直接讀對應的 config 常數）
        scale: float，轉換的平滑寬度（單位跟 value 一樣）。scale 越小，
            風險分數在門檻附近變化越陡（越接近原本的二值化行為）；
            scale 越大，變化越平緩。必須 > 0
        higher_is_better: bool
            True：數值越大越安全（例如 SNR、correlation、roiConsistency、
                identityStability、layerScore、geometryScore）
            False：數值越大越危險（例如 maxIdentityDrop、響應延遲）

    回傳:
        float，0.0-1.0
    """
    if scale <= 0:
        raise ValueError(f"scale 必須為正數，收到 {scale}")

    z = (threshold - value) if higher_is_better else (value - threshold)
    return float(1.0 / (1.0 + math.exp(-z / scale)))


def combine_risks(*risks):
    """把同一個 track 裡多項判定的風險分數合併成一個。

    取最大值，不是平均——原本的判定邏輯是「全部項目都要過」（AND），
    只要有一項證據強烈指向風險，整體信心分數就該反映出來。取平均會讓
    兩項正常的判定把一項異常的判定稀釋掉，跟「全部都要過」的設計精神
    矛盾：例如兩項風險 0.05、一項風險 0.95，平均只有 0.35（看起來還好），
    但取最大值是 0.95（正確反映出「有一項證據很確定這是攻擊」）。

    參數:
        *risks: float，各項判定的風險分數，0.0-1.0
    回傳:
        float，0.0-1.0。沒有任何輸入時回傳 1.0（沒有證據支持安全，
        不能預設給低風險，跟專案裡其他「無資料時保守處理」的原則一致）
    """
    if not risks:
        return 1.0
    return float(max(risks))
