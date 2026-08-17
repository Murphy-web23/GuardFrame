"""VLM 摘要模組（B 暫時放的佔位版本，CONVENTIONS §4.10）。

A 排在開發後期實作真正的地端 VLM。B 先放這份佔位版本，理由跟
track1_synthetic/detector.py 一樣：先把 /verify 端點串通，不能等 A。
"""


def summarize_verification(record: dict, anomaly_images: list) -> dict:
    """佔位版本，永遠回傳 available=False。A 完成後取代此檔案。"""
    return {
        "available": False,
        "frameObservations": [],
        "summary": "",
        "model": "",
        "latencyMs": 0.0,
    }
