"""Track 4｜遮擋一致性：身分嵌入與連續性計算。

契約見 CONVENTIONS.md §4.6、PLAN.md 階段2 Track4。

原理：InsightFace 對同一張真人臉抽出的 512 維嵌入，即使角度、光線、
表情變化，相鄰影格的餘弦相似度仍會維持在很高的水準。若遮擋（手掃過臉）
期間背後偷偷換了一張臉——不論是換臉演算法的管線斷裂，還是任何形式的
身分替換——遮擋前後的嵌入會出現一次明顯的相似度驟降，即使遮擋本身
把中間那段完全擋住看不到臉也一樣：擋住前最後一格、跟露出來後第一格，
兩者的身分應該還是同一個人。

這正是這個模組要抓的東西，也是為什麼「遮擋前最後一格 vs 遮擋後第一格」
這個跨越缺格的比較，比嚴格相鄰的原始影格索引比較更重要——見
valid_transition_similarities() 的說明。
"""

import numpy as np

import config

# 2026-08-25：真人測試發現伺服器記憶體在連續跑幾輪驗證後被榨乾到只剩
# 幾百 MB（見 PHASE1_NOTES §10.1 記錄過的架構債），追出來每次
# analyze_occlusion() 都重新從硬碟載入一整組 buffalo_l 模型（1k3d68、
# 2d106det、det_10g、genderage、w600k_r50 五個 ONNX），不只慢、還會讓
# 記憶體越用越多。跟下面 docstring 說的一樣，InsightFace 偵測本身是
# 無狀態的（不像 common/landmarks.py 的 MediaPipe VIDEO 模式那樣有跨
# 影格 timestamp 依賴），所以在「一次呼叫內」建立一次沒問題，但沒有
# 理由每次呼叫都重新建——改成模組層級快取，整個伺服器行程只載入一次，
# 之後所有請求共用同一個實例。image_utils/quality.py 的
# _get_face_app() 已經是這個寫法，這裡跟著補上。
_face_analyzer = None
_face_analyzer_failed = False


def _create_face_analyzer():
    """取得（必要時建立）快取的 InsightFace FaceAnalysis 實例。

    跟 common/landmarks.py 的 MediaPipe wrapper 不同，InsightFace 的偵測
    是無狀態的——每張影格獨立偵測，沒有 MediaPipe VIDEO 模式那種跨影格
    timestamp 依賴——所以快取成模組層級的全域變數、跨請求重複使用是
    安全的，不會有 Track 2 踩過的那種快取 bug（見上面模組說明）。
    """
    global _face_analyzer, _face_analyzer_failed

    if _face_analyzer is not None or _face_analyzer_failed:
        return _face_analyzer

    from insightface.app import FaceAnalysis

    try:
        app = FaceAnalysis(name="buffalo_l")
        app.prepare(ctx_id=config.INSIGHTFACE_CTX_ID, det_size=config.INSIGHTFACE_DET_SIZE)
        _face_analyzer = app
    except Exception:
        _face_analyzer_failed = True

    return _face_analyzer


def extract_face_data(frames):
    """逐格偵測臉部，回傳每格的 bbox 與身分嵌入。

    參數:
        frames: list[np.ndarray]，RGB，uint8

    回傳:
        list[dict | None]，長度同 frames
        每格是 {"bbox": np.ndarray(4,), "embedding": np.ndarray(512,)}，
        沒偵測到臉、或偵測出錯時為 None——遮擋期間偵測不到臉是常態，
        不可讓單格失敗中斷整段分析（CONVENTIONS §4.6 實作要點）。
    """
    import cv2

    app = _create_face_analyzer()
    results = []

    for frame in frames:
        try:
            # InsightFace 預期 BGR（跟 cv2.imread 的慣例一致），frames 是 RGB，
            # 忘記轉的話偵測仍會給結果，但嵌入是錯的——PHASE1_NOTES §2.3
            # 記過同一類錯誤（CLIP 的 BGR/RGB），這裡照樣小心。
            bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            faces = app.get(bgr)
            if not faces:
                results.append(None)
                continue

            # 遮擋期間手指分岔、陰影等偶爾會造成假陽性多偵測到一張臉，
            # 取偵測信心最高的一張。
            face = max(faces, key=lambda f: f.det_score)
            results.append(
                {
                    "bbox": np.asarray(face.bbox, dtype=np.float64),
                    "embedding": np.asarray(face.normed_embedding, dtype=np.float64),
                }
            )
        except Exception:
            results.append(None)

    return results


def cosine_similarity(a, b):
    """兩個嵌入向量的餘弦相似度。

    embedding 已經是 L2 正規化過的（InsightFace 的 normed_embedding），
    理論上內積就是餘弦相似度、範圍不會超出 [-1, 1]，但還是 clip 到
    [0, 1]——同一個人的相似度不會是負的，出現負值只可能是浮點誤差
    或極端雜訊，不該讓它污染後面的統計。
    """
    return float(np.clip(np.dot(a, b), 0.0, 1.0))


def compute_stability_curve(face_data):
    """依原始影格順序，逐一比較嚴格相鄰兩格的身分嵌入，供後台圖表顯示。

    任一格缺偵測時該點填 0.0——不是「判定為身分不連續」，只是「這個
    位置沒有可比較的資料」。視覺上會呈現遮擋期間曲線落到 0、露出來後
    回升的樣子，這是預期的正常畫面，不代表攻擊被抓到。

    真正的判定邏輯在 valid_transition_similarities()，會跳過缺格去比較
    「遮擋前最後一格」對「遮擋後第一格」，不受這個函式的簡化影響。

    參數:
        face_data: list[dict | None]，extract_face_data 的輸出
    回傳:
        list[float]，長度 = len(face_data) - 1（§4.6 規定的 stabilityCurve 長度）
    """
    n = len(face_data)
    curve = [0.0] * max(n - 1, 0)
    for i in range(n - 1):
        a, b = face_data[i], face_data[i + 1]
        if a is not None and b is not None:
            curve[i] = cosine_similarity(a["embedding"], b["embedding"])
    return curve


def valid_transition_similarities(face_data, occlusion_segments=None):
    """依「有效偵測」的先後順序算相似度，跳過缺格而不是被缺格打斷。

    這是遮擋層真正的判定依據。遮擋層最有價值的比較是「遮擋前最後一格」
    對「遮擋後第一格」——如果只比較嚴格相鄰的原始影格索引，完全遮住
    的那段會產生一整串「沒資料」，反而漏掉這個最關鍵的跨遮擋比較。

    2026-08-26：真人測試發現 maxIdentityDrop 就算是真人也常常量到
    0.84~1.00 的高值，追出根因：「有沒有偵測到臉」不等於「這格的
    embedding 可信」。手正在揮過臉前面、只蓋住半張臉的那些影格，
    InsightFace 偵測信心（det_score）實測仍然有 0.5~0.9（不算低），
    但辨識用的 embedding 是拿被手指遮住一部分的裁切去算的，跟正常
    可信的 embedding 差很多——直接拿真人測試資料驗證過：最低相似度
    的那幾筆轉換（例如 0.10、0.16、0.19），影格索引幾乎都精準落在
    hand_tracking.py 的 detect_wave_cycles() 早就算出來的「手正蓋在
    臉部參考框內」那幾段區間裡面。原本的邏輯只看「有沒有偵測到臉」，
    沒有排除這些「有偵測到、但手正蓋著、embedding 不可信」的影格，
    這正是文件開頭說的「遮擋前最後一格對遮擋後第一格」精神沒有真的
    被落實——現在補上：额外把落在 occlusion_segments 範圍內的影格
    也當作無效（跟真的沒偵測到臉一樣處理），才會真的比較「手蓋上去
    之前」跟「手離開之後」，而不是連手蓋著臉那段裡面本身雜訊很大的
    轉換都算進去。

    參數:
        face_data: list[dict | None]
        occlusion_segments: list[[int, int]] | None，hand_tracking.py
            detect_wave_cycles() 的輸出，每筆是手蓋在臉部參考框內的
            [進入影格索引, 離開影格索引]（含頭尾）。None 時退回舊行為
            （只看有沒有偵測到臉），供沒有手部資料的呼叫端相容用。
    回傳:
        list[(int, float)]，每筆是（較晚那格的原始索引, 相似度），
        依索引順序排列。少於兩格有效偵測時回傳空 list
    """
    excluded = set()
    for start, end in occlusion_segments or []:
        excluded.update(range(start, end + 1))

    valid_indices = [
        i for i, d in enumerate(face_data) if d is not None and i not in excluded
    ]
    transitions = []
    for prev_i, cur_i in zip(valid_indices, valid_indices[1:]):
        sim = cosine_similarity(
            face_data[prev_i]["embedding"], face_data[cur_i]["embedding"]
        )
        transitions.append((cur_i, sim))
    return transitions


def max_identity_drop(transitions):
    """全程最大的單一次身分突降幅度 = 1 - 最低的有效轉換相似度。

    參數:
        transitions: list[(int, float)]，valid_transition_similarities 的輸出
    回傳:
        float，0.0-1.0。沒有任何有效轉換（全片都沒偵測到臉，或只有 0-1 格
        偵測到）時回傳 1.0——沒有證據支持身分連續，不能預設給 0，
        那等於「沒資料=沒問題」；遮擋層要抓的正是「完全遮住看不見」
        這種攻擊者可能刻意製造的情況。
    """
    if not transitions:
        return 1.0
    return float(1.0 - min(sim for _, sim in transitions))


def identity_stability(transitions):
    """全程身分連續性平均分數：有效轉換相似度的平均值，涵蓋整段影格、不分循環。

    參數:
        transitions: list[(int, float)]
    回傳:
        float，0.0-1.0。沒有任何有效轉換時回傳 0.0（跟 max_identity_drop
        同樣的保守原則）。
    """
    if not transitions:
        return 0.0
    return float(np.mean([sim for _, sim in transitions]))


def find_anomaly_frames(transitions, threshold):
    """找出突降超過 threshold 的影格索引（取轉換中較晚那一格的原始索引，
    代表「從這一格開始身分對不上前面」）。

    參數:
        transitions: list[(int, float)]
        threshold: float，通常讀 config.OCC_MAX_DROP_THRESHOLD
    回傳:
        list[int]，已排序、不重複
    """
    return sorted(idx for idx, sim in transitions if 1.0 - sim > threshold)
