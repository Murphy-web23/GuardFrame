"""VLM 摘要模組（CONVENTIONS §4.10）。

在人工複核（verdict=review）跟系統自動拒絕（verdict=reject）時都會被
呼叫，見 api/routes.py。決策本身在這之前就已經由五層防禦融合算完——VLM
不參與 pass/review/reject 判定，唯一的工作是把沒過的層（baseline／
synthetic／photometric／occlusion 都可能是證據來源，不限 Track4）轉成
複核人員看得懂的文字說明，指出「該去影片哪一秒看」而不是內部的影格編號、
以及「系統當初為什麼覺得可疑」。

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
import re
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


# 2026-08-30 新增：中文欄位名稱對照，組文字提示詞用（不是給程式判斷邏輯
# 用的鍵名，只是把 layerMetrics 的內容講成人看得懂的句子）。
_LAYER_LABELS = {
    "baseline": "對照組動作挑戰",
    "synthetic": "Track1 合成偵測",
    "photometric": "Track3 照明響應",
    "occlusion": "Track4 遮擋/換臉偵測",
}


def _format_layer_metrics(layer_metrics: dict) -> str:
    """把 api/routes.py 傳來的 layerMetrics 轉成一段給 LLM 讀的中文描述。

    只包含沒通過的層（呼叫端已經先篩過），每層列出實際量到的數值跟
    對應門檻。這些數字是給 LLM 判斷「哪裡最可疑」用的素材，不是要它
    直接抄進回答——2026-09-10 改成要求 LLM 輸出白話描述而非分數本身，
    見 _CASE_SUMMARY_PROMPT_TEMPLATE。
    """
    lines = []
    for key, metrics in layer_metrics.items():
        label = _LAYER_LABELS.get(key, key)
        if key == "baseline":
            lines.append(f"- {label}：信心分數 {metrics['confidenceScore']:.2f}（{metrics['note']}）")
        elif key == "synthetic":
            lines.append(
                f"- {label}：AI 生成機率 {metrics['fakeProbability']:.2f}"
                f"（門檻 {metrics['threshold']:.2f}，數值越高越可疑）"
            )
        elif key == "photometric":
            lines.append(
                f"- {label}：反光相關係數 {metrics['correlation']:.2f}"
                f"（門檻 {metrics['threshold']:.2f}，數值越低代表反光跟螢幕變色越不同步）"
            )
        elif key == "occlusion":
            # 2026-08-31：occlusion 是「揮手循環數／身分連續性／遮擋區域
            # 顏色」三項判定，只要其中一項沒過整層就算沒過——這裡只列出
            # 實際沒過的那幾項，其餘通過的數字不列，避免 LLM 把通過的
            # 數字誤讀成沒過（真人測試撞到過：明明身分穩定度/最大掉幅都
            # 在門檻內，只有揮手循環數不夠，VLM 卻寫成兩個都超標）。
            parts = []
            if "waveCyclesDetected" in metrics:
                parts.append(
                    f"揮手循環偵測到 {metrics['waveCyclesDetected']} 次"
                    f"（至少需要 {metrics['waveCyclesRequired']} 次）"
                )
            if "identityStability" in metrics:
                parts.append(
                    f"身分穩定度 {metrics['identityStability']:.2f}"
                    f"（門檻 {metrics['identityStabilityThreshold']:.2f}）"
                )
                parts.append(
                    f"最大單次掉幅 {metrics['maxIdentityDrop']:.2f}"
                    f"（門檻 {metrics['maxIdentityDropThreshold']:.2f}，"
                    "數值越高代表遮擋前後的臉部特徵差異越大，越像換了一張臉）"
                )
            if "layerScore" in metrics:
                parts.append(
                    f"遮擋區域顏色相似度 {metrics['layerScore']:.2f}"
                    f"（門檻 {metrics['layerScoreThreshold']:.2f}，"
                    "數值太低代表遮擋區域顏色不像臉，可能是換臉管線斷裂的破綻）"
                )
            lines.append(f"- {label}：" + "；".join(parts))
    return "\n".join(lines)


_CASE_SUMMARY_PROMPT_TEMPLATE = (
    "你是身分驗證系統的複核助手。以下是這筆案件沒有通過的檢查層，"
    "附上各層實際量到的數值跟門檻（這些數字給你自己判斷用，不要抄進"
    "回答裡）：\n\n{metrics}\n\n"
    "上面列出的每一層都要講到，不能只挑其中一兩個、也不能漏講其他層，"
    "用白話跟銀行風控人員解釋『系統在每一層各自觀察到什麼』，例如："
    "揮手次數不夠、遮擋前後臉部特徵變化很大像換了一張臉、反光跟畫面"
    "明暗對不太上。不要寫出分數或門檻數字，直接講發生了什麼事，整合"
    "成一段連貫的話，不超過 100 個字。不要用「1.」「2.」這種編號、"
    "不要用 markdown 的星號或項目符號，就是一般人平常講話的樣子。"
    "不要做出通過或拒絕的建議，你只負責解釋現有證據，最終判定由人員"
    "決定。"
)

# 2026-09-10：qwen2.5vl:3b 這種小模型對「不超過 N 字」這類長度指令的
# 遵循度不穩定，實測即使 prompt 已經要求 80 字，還是會把每一層沒過的
# 檢查都逐條列出來（連分數、門檻都照抄），寫出兩三百字的摘要，複核
# 人員看了反而抓不到重點。改成白話描述「系統觀察到什麼」（見上面
# prompt）後長度自然短了很多，但反而出現另一個問題：要求「只挑1-2個
# 疑點」時，小模型會挑到最好講、卻不是最關鍵的那項（真人測試撞到過：
# 一筆虛擬攝影機注入攻擊，Track1／Track3 都正確標記為可疑，摘要卻只
# 提了對照組動作沒做對，把真正的攻擊訊號漏講了）。改成要求「每一層
# 都要講到」解決漏講問題，但這樣總長度會隨沒過的層數變多，上限跟著
# 放寬——長度指令對小模型一樣不可盡信，只調 prompt 不夠保險，加一道
# 程式碼層的安全網：超過這個長度就在最後一個句讀處截斷，寧可資訊少
# 一點也要保證不會失控地長。
_SUMMARY_HARD_LIMIT = 120


def _truncate_summary(text: str, limit: int = _SUMMARY_HARD_LIMIT) -> str:
    """超過長度上限時，在最後一個句讀符號處截斷，避免斷在句子中間。"""
    if len(text) <= limit:
        return text
    truncated = text[:limit]
    cut = max(truncated.rfind(c) for c in "。！？；")
    if cut > 0:
        return truncated[: cut + 1]
    return truncated.rstrip("，、") + "…"


# 2026-09-10：prompt 已經要求不要編號、不要 markdown，但小模型還是常常
# 加「1. 」這種條列開頭，甚至夾雜 **粗體** 星號——這些符號直接顯示在
# 複核介面上會很突兀（星號沒被 markdown 渲染的話就是原始字元）。跟長度
# 限制一樣不能只靠 prompt，這裡在程式碼層再清一次。
_LEADING_NUMBERING_RE = re.compile(r"^\s*(?:[0-9]+[.、)]|[-*•])\s*")


def _strip_formatting(text: str) -> str:
    """去掉開頭的編號/項目符號跟 markdown 粗體星號。"""
    text = _LEADING_NUMBERING_RE.sub("", text)
    return text.replace("**", "")


def _ask_vlm_text(prompt: str) -> str:
    """跟 _ask_vlm() 一樣打 Ollama，但不帶圖片——純文字整合各層數字用，
    見 synthesize_case_summary()。沒有圖要編碼，這支通常比帶圖的
    _ask_vlm() 快很多。"""
    response = requests.post(
        OLLAMA_URL,
        json={"model": VLM_MODEL, "prompt": prompt, "stream": False},
        timeout=300,
    )
    response.raise_for_status()
    return response.json().get("response", "").strip()


def synthesize_case_summary(layer_metrics: dict) -> str | None:
    """把各層沒通過的實際數字交給 VLM，整合成一段給複核人員看的白話說明。

    2026-08-30 新增——原本 summarize_verification() 只讓 VLM 看被標記的
    畫面本身，寫出來的摘要只能描述「畫面好不好看」，沒辦法解釋「系統
    為什麼覺得可疑」（那個理由多半藏在數字裡，例如 Track3 相關係數
    0.27 距離門檻 0.35 差多少，不是肉眼看畫面能看出來的）。這支函式
    才是真正做到「把已經算出來的證據轉成人話」——之前 PROMPTS 那幾句
    做的是「看這張圖有沒有異常」，這支做的是「看這些數字，用白話解釋」，
    兩者互補，不是同一件事。

    找不到任何 layer_metrics（理論上不會發生，review 案件一定至少有一層
    沒過）或推論失敗時回傳 None，呼叫端要自己處理「這段沒有」的情況，
    不拋例外——這只是複核時的輔助說明。
    """
    if not layer_metrics:
        return None
    try:
        prompt = _CASE_SUMMARY_PROMPT_TEMPLATE.format(metrics=_format_layer_metrics(layer_metrics))
        return _truncate_summary(_strip_formatting(_ask_vlm_text(prompt)))
    except Exception:
        return None


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
        record: dict，用 record["layerMetrics"]（見 api/routes.py，
            只包含沒通過的層跟各自的實際數值/門檻）整合成一段白話摘要，
            見 synthesize_case_summary()。record["decision"] 目前沒用到，
            保留給以後需要判定脈絡（riskScore/reasons 等）時擴充。
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
    t0 = time.time()

    # 2026-08-30：先做數字整合摘要（見 synthesize_case_summary()），不管
    # 有沒有異常影格都能跑——只需要各層的數值，不需要畫面。這段解釋的是
    # 「系統為什麼覺得可疑」，跟下面的畫面觀察（解釋「畫面上看不看得
    # 出來」）是互補的兩件事，不是同一句話的兩種寫法。
    case_summary = synthesize_case_summary(record.get("layerMetrics") or {})

    if not anomaly_frames:
        if case_summary is None:
            return {
                "available": False,
                "frameObservations": [],
                "summary": "",
                "model": "",
                "latencyMs": 0.0,
            }
        return {
            "available": True,
            "frameObservations": [],
            "summary": case_summary,
            "model": VLM_MODEL,
            "latencyMs": (time.time() - t0) * 1000.0,
        }

    observations = []
    try:
        for item in _sample(anomaly_frames):
            image_b64 = _encode_jpeg(item["image"])
            text = _ask_vlm(image_b64, item.get("source", "_default"))
            observations.append(
                {"timestampSec": round(float(item["timestampSec"]), 1), "observation": text}
            )
    except Exception as exc:
        # 2026-08-30：畫面觀察這段失敗了，但數字整合摘要可能還是有算出來
        # ——兩段是各自獨立呼叫 VLM 的，一段失敗不該連累另一段，能給多少
        # 就給多少，不要因小失大整段判定 available=False。
        fallback = case_summary or f"地端 VLM 目前無法使用（{exc}），請直接查看異常影格。"
        return {
            "available": case_summary is not None,
            "frameObservations": [],
            "summary": fallback,
            "model": VLM_MODEL,
            "latencyMs": (time.time() - t0) * 1000.0,
        }

    # 2026-08-29：原本用 `!= "未見明顯異常"` 做完全字串比對，但模型
    # 回覆常帶標點或些微變化（例如「未見明顯異常。」），完全比對永遠
    # 對不上，導致「沒異常」被誤判成「有話要講」，摘要變成把「未見明顯
    # 異常」原句複誦出來——聽起來像是在否定系統本來的判定，容易誤導
    # 複核人員以為這格畫面沒問題、可以放行，但這幾格會被送來給 VLM 看，
    # 正是因為某一層的演算法已經判定它可疑（見 api/routes.py
    # _collect_review_frames()）。改用「開頭是不是這句話」判斷。
    flagged = [
        o for o in observations if not o["observation"].strip().startswith("未見明顯異常")
    ]
    frame_note = (
        "VLM 視覺檢視發現："
        + "、".join(f"第 {o['timestampSec']} 秒：{o['observation']}" for o in flagged)
        if flagged
        else (
            "VLM 視覺檢視這幾格系統標記的畫面，未看出明顯視覺瑕疵——肉眼／VLM "
            "看不出異常不代表判定有誤（有些異常本來就不是視覺層面的問題）。"
        )
    )

    # 2026-08-30：數字整合摘要（案件為什麼可疑）放前面、畫面觀察結果
    # （畫面上看不看得出來）放後面——複核人員該先知道「為什麼」，畫面
    # 描述是補充細節，不是主要結論。case_summary 算不出來時（例如
    # layerMetrics 是空的，理論上 review 案件不該發生，或這段呼叫失敗）
    # 就只顯示畫面觀察，不留一段空白開頭。
    summary = f"{case_summary}\n\n{frame_note}" if case_summary else frame_note

    return {
        "available": True,
        "frameObservations": observations,
        "summary": summary,
        "model": VLM_MODEL,
        "latencyMs": (time.time() - t0) * 1000.0,
    }
