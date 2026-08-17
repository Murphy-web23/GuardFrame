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


def _create_face_analyzer():
    """建立 InsightFace FaceAnalysis 實例。

    跟 common/landmarks.py 的 MediaPipe wrapper 不同，InsightFace 的偵測
    是無狀態的——每張影格獨立偵測，沒有 MediaPipe VIDEO 模式那種跨影格
    timestamp 依賴——所以在一次 analyze_occlusion() 呼叫裡建立一次、
    重複用在所有影格上是安全的，不會有 Track 2 踩過的那種快取 bug。
    """
    from insightface.app import FaceAnalysis

    app = FaceAnalysis(name="buffalo_l")
    app.prepare(ctx_id=config.INSIGHTFACE_CTX_ID, det_size=config.INSIGHTFACE_DET_SIZE)
    return app


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


def valid_transition_similarities(face_data):
    """依「有效偵測」的先後順序算相似度，跳過缺格而不是被缺格打斷。

    這是遮擋層真正的判定依據。遮擋層最有價值的比較是「遮擋前最後一格」
    對「遮擋後第一格」——如果只比較嚴格相鄰的原始影格索引，完全遮住
    的那段會產生一整串「沒資料」，反而漏掉這個最關鍵的跨遮擋比較。

    參數:
        face_data: list[dict | None]
    回傳:
        list[(int, float)]，每筆是（較晚那格的原始索引, 相似度），
        依索引順序排列。少於兩格有效偵測時回傳空 list
    """
    valid_indices = [i for i, d in enumerate(face_data) if d is not None]
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
