"""Track 1｜合成影像偵測（B 暫時放的佔位版本，CONVENTIONS §4.10）。

A 完成真正的模型後，這個檔案會被整個換掉，呼叫端（api/routes.py）
不需要跟著改一行——這是階段0敲定介面契約的回報。

B 先放這份佔位版本的原因：A 的進度目前不確定，但 B 需要先把 /verify
端點串通、驗證整條後端管線走得通，不能等 A。
"""


def detect_synthetic(face_images: list) -> dict:
    """佔位版本，永遠回傳固定值。A 完成後取代此檔案。"""
    return {
        "fakeProbability": 0.87,
        "topSignals": [
            {"label": "臉部邊界混合痕跡", "weight": 0.38},
            {"label": "高頻紋理不一致", "weight": 0.31},
            {"label": "跨影格閃爍", "weight": 0.25},
        ],
    }
