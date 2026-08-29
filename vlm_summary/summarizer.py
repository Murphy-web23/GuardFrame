"""VLM 摘要模組（CONVENTIONS §4.10）。

只在人工複核（verdict=review）時被呼叫，見 api/routes.py。決策本身在這
之前就已經由五層防禦融合算完——VLM 不參與 pass/reject 判定，唯一的工作
是把 Track4 標記出來的異常影格轉成複核人員看得懂的文字說明，指出「該去
影片哪一秒看」而不是內部的影格編號。

之所以不讓 VLM 直接做判定：深偽/活體攻擊的訊號（rPPG 心跳、GAN 生成瑕疵
等）多半是肉眼看不出來的統計/物理特徵，文獻上通用 VLM 對這類任務的準確
率接近隨機猜測（GPT-4o 約 58%、Gemini 對生成人臉約 50%，見 Jia et al.,
CVPR 2024 Workshop）。VLM 真正擅長的是「把已經算出來的證據轉成人話」，
這正是這裡唯一用到它的地方。

走 Ollama 的本機 HTTP API（地端，不送資料出去），需要先裝好 Ollama 並
`ollama pull qwen2.5vl:3b`，見 vlm_summary/README.md。沒裝好、模型沒拉
下來、或推論失敗時一律回傳 available=False，不拋例外——這只是複核時的
輔助說明，不該讓它的失敗擋掉整個 /verify 請求。
"""

import base64
import time

import cv2
import requests

OLLAMA_URL = "http://localhost:11434/api/generate"
VLM_MODEL = "qwen2.5vl:3b"

# 異常影格可能有十幾格，全部問一輪會拖慢複核流程，且畫面通常連續、
# 內容重複，抽樣幾張代表性的就夠複核人員抓到重點。
MAX_FRAMES = 5

# 2026-08-29：原本全部影格共用同一句通用提示詞「找找看哪裡奇怪」——
# 但 VLM 完全不知道系統原本在懷疑什麼，Track4 懷疑的是「身分特徵不
# 連續」，通用提示詞卻只會泛泛地找「畫面奇不奇怪」，兩者常常對不上
# （真人 review 案例 id=166 實測過，Track4 標記的兩格 VLM 都答「未見
# 明顯異常」，但那從一開始就不是靠肉眼／單張畫面能看出來的異常，見
# README「已知的限制」）。改成依 api/routes.py `_collect_review_frames()`
# 標的 "source"，各自問對應該層實際在懷疑的問題，讓 VLM 的描述至少是
# 針對正確的懷疑理由去看，不是漫無目的地找奇怪的地方。
_ANOMALY_HINT = "如果仔細看沒有發現明顯異常，就回答「未見明顯異常」，不要編造。"

PROMPTS = {
    "occlusion": (
        "這格畫面是系統懷疑可能發生「即時換臉攻擊」時擷取的。"
        "用不超過 20 個字，具體描述臉部邊緣、五官比例、光影是否自然，"
        "是否有換臉/合成的痕跡。" + _ANOMALY_HINT
    ),
    "synthetic": (
        "這格畫面是系統懷疑可能是 AI 生成/合成人臉時擷取的。"
        "用不超過 20 個字，具體描述皮膚紋理、毛髮邊緣、眼神是否有不自然"
        "的生成痕跡。" + _ANOMALY_HINT
    ),
    "photometric": (
        "這格畫面是系統懷疑「螢幕反光跟環境光不一致」（可能是翻拍照片"
        "或螢幕重播，不是真的鏡頭在拍活人）時擷取的。"
        "用不超過 20 個字，具體描述畫面亮度/色調是否像被螢幕光源照到、"
        "是否有翻拍時常見的反光/摩爾紋。" + _ANOMALY_HINT
    ),
    # 沒有標 source（理論上不會發生，保底用）時退回原本的通用提示詞。
    "_default": (
        "這是身分驗證過程中系統標記為可疑的一格畫面。"
        "用不超過 20 個字，具體描述你觀察到的異常（例如臉部邊緣不自然、"
        "光影跟臉部朝向不一致、有東西遮住部分臉、畫面出現多張臉等）。"
        + _ANOMALY_HINT
    ),
}


def _sample(anomaly_frames: list) -> list:
    """異常影格數超過 MAX_FRAMES 時，等間隔抽樣，避免只看到片頭片尾。"""
    if len(anomaly_frames) <= MAX_FRAMES:
        return anomaly_frames
    step = len(anomaly_frames) / MAX_FRAMES
    return [anomaly_frames[int(i * step)] for i in range(MAX_FRAMES)]


# 手機直向錄影的原始影格常常是 1920x1080 這個量級，VLM 不需要這麼高的
# 解析度才能看出「有沒有東西遮到臉」這種粗粒度異常，長邊縮到這個值
# 再送——實測發現不縮圖的話，影像編碼那一步在這台沒有獨立顯卡、記憶體
# 又緊繃的機器上會直接卡死（見 2026-08-29 對話紀錄），不是單純比較慢。
MAX_DIMENSION = 512


def _encode_jpeg(frame) -> str:
    h, w = frame.shape[:2]
    scale = MAX_DIMENSION / max(h, w)
    if scale < 1.0:
        frame = cv2.resize(frame, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(frame, cv2.COLOR_RGB2BGR))
    if not ok:
        raise ValueError("影格編碼成 JPEG 失敗")
    return base64.b64encode(buf).decode("ascii")


def _ask_vlm(image_b64: str, source: str) -> str:
    # 2026-08-29：開發機沒有獨立顯卡，CPU 推論一張圖實測要好幾分鐘
    # （尤其系統同時開著很多其他程式、記憶體吃緊的時候）。/verify 本身
    # 已經是非同步背景流程，不急著在幾十秒內拿到結果，逾時值設寬鬆一點，
    # 換取「別因為機器一時忙就整段判定為不可用」。有 GPU 的機器上會快
    # 很多，但這個逾時值不需要跟著硬體換——反正夠用就好，不會被提早打斷。
    prompt = PROMPTS.get(source, PROMPTS["_default"])
    response = requests.post(
        OLLAMA_URL,
        json={"model": VLM_MODEL, "prompt": prompt, "images": [image_b64], "stream": False},
        timeout=300,
    )
    response.raise_for_status()
    return response.json().get("response", "").strip()


def summarize_verification(record: dict, anomaly_frames: list) -> dict:
    """對異常影格逐一詢問地端 VLM，產生給複核人員看的說明。

    參數:
        record: dict，目前只用 record["decision"]，保留給以後想讓 VLM
            知道整體判定脈絡（例如哪幾層被扣分）時擴充用，目前版本沒用到。
        anomaly_frames: list[dict]，每個元素是
            {"image": np.ndarray（RGB），"timestampSec": float, "source": str}
            source 是哪一層送來的這張畫面（"occlusion"/"synthetic"/
            "photometric"，見 PROMPTS），用來決定該問 VLM 什麼問題——
            不是通用的「找找看哪裡奇怪」，是「針對這層原本懷疑的理由去看」。
            順序沿用呼叫端已經排好的時間序，見 api/routes.py
            `_collect_review_frames()`。

    回傳:
        {
            "available": bool,
            "frameObservations": [{"timestampSec": float, "observation": str}, ...],
            "summary": str,       # 給複核人員的一句話總覽
            "model": str,
            "latencyMs": float,
        }
    """
    if not anomaly_frames:
        return {
            "available": False,
            "frameObservations": [],
            "summary": "",
            "model": "",
            "latencyMs": 0.0,
        }

    t0 = time.time()
    observations = []
    try:
        for item in _sample(anomaly_frames):
            image_b64 = _encode_jpeg(item["image"])
            text = _ask_vlm(image_b64, item.get("source", "_default"))
            observations.append(
                {"timestampSec": round(float(item["timestampSec"]), 1), "observation": text}
            )
    except Exception as exc:
        return {
            "available": False,
            "frameObservations": [],
            "summary": f"地端 VLM 目前無法使用（{exc}），請直接查看異常影格。",
            "model": VLM_MODEL,
            "latencyMs": (time.time() - t0) * 1000.0,
        }

    # 2026-08-29：原本用 `!= "未見明顯異常"` 做完全字串比對，但模型
    # 回覆常帶標點或些微變化（例如「未見明顯異常。」），完全比對永遠
    # 對不上，導致「沒異常」被誤判成「有話要講」，摘要變成把「未見明顯
    # 異常」原句複誦出來——聽起來像是在否定系統本來的判定，容易誤導
    # 複核人員以為這格畫面沒問題、可以放行，但這幾格會被送來給 VLM 看，
    # 正是因為某一層的演算法已經判定它可疑（見 api/routes.py
    # _collect_review_frames()）。改用「開頭是不是這句話」判斷，並且
    # 不管有沒有找到東西，摘要都明講「這是 VLM 的視覺檢視結果，不是
    # 對系統判定的背書或推翻」，兩種情況都不該讓複核人員誤會。
    flagged = [
        o for o in observations if not o["observation"].strip().startswith("未見明顯異常")
    ]
    if flagged:
        summary = (
            "VLM 視覺檢視發現："
            + "、".join(f"第 {o['timestampSec']} 秒：{o['observation']}" for o in flagged)
        )
    else:
        # 2026-08-29：原本結尾寫「仍應以觸發複核的原始數據為準」，講得太
        # 抽象——複核人員該去哪裡找那個「原始數據」？改成直接點名畫面上
        # 那個區塊的名稱（「風控審核備註與特徵說明」），複核人員看完這句
        # 話能直接知道下一步該看哪裡，不用自己猜。
        summary = (
            "VLM 視覺檢視這幾格系統標記的畫面，未看出明顯視覺瑕疵——但這些畫面"
            "會被送來複核，是因為系統已經判定它們可疑，肉眼／VLM 看不出異常"
            "不代表判定有誤（有些異常本來就不是視覺層面的問題），請參考下方"
            "「風控審核備註與特徵說明」了解實際觸發複核的原因。"
        )

    return {
        "available": True,
        "frameObservations": observations,
        "summary": summary,
        "model": VLM_MODEL,
        "latencyMs": (time.time() - t0) * 1000.0,
    }
