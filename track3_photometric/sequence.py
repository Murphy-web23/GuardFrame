"""Track 3｜照明響應：顏色序列與亮度換算。

契約見 CONVENTIONS.md §4.5、§5.2。

實際的顏色序列在前端播放並記錄成 light_log（§5.2 格式），隨影片一起上傳。
這裡提供雙方都要用到的共用邏輯：
    - 顏色名稱換算成相對亮度（analyzer.py 建構螢幕光曲線要用）
    - 依 light_log 查詢任一時刻的螢幕亮度、或重採樣成固定點數的曲線
    - 合成 light_log 產生器，供測試在不需要瀏覽器的情況下驗證 analyzer.py
"""

import random

import numpy as np

import config

# 四色亮度換算值與對應 hex（§5.2）。低飽和度中亮度設計符合
# NFR-10/11 的 WCAG 2.3.1 三閃爍門檻與癲癇風險考量。
COLOR_BRIGHTNESS = {
    "灰白": 1.00,
    "淡綠": 0.72,
    "淡紅": 0.68,
    "淡藍": 0.62,
}

COLOR_HEX = {
    "淡紅": "#D98080",
    "灰白": "#E8E8E8",
    "淡藍": "#8098D9",
    "淡綠": "#80D9A0",
}

COLOR_NAMES = tuple(COLOR_BRIGHTNESS.keys())


def light_intensity_at(light_log, t_ms):
    """查詢 light_log 在時刻 t_ms（相對序列起點的毫秒數）的螢幕亮度。

    參數:
        light_log: dict，§5.2 格式
        t_ms: float，相對 segments[0].startMs 的毫秒數

    回傳:
        float，0.0-1.0。t_ms 落在任何一段範圍外時，回傳最近一段的亮度
        （序列開始前用第一段、結束後用最後一段），不直接判 0——
        邊界外若判 0 會製造一次假的亮度驟降，互相關會被這個假訊號污染。
    """
    segments = light_log.get("segments") or []
    if not segments:
        return 0.0

    for seg in segments:
        start = seg["startMs"]
        end = start + seg["durationMs"]
        if start <= t_ms < end:
            return COLOR_BRIGHTNESS.get(seg["color"], 0.0)

    if t_ms < segments[0]["startMs"]:
        return COLOR_BRIGHTNESS.get(segments[0]["color"], 0.0)
    return COLOR_BRIGHTNESS.get(segments[-1]["color"], 0.0)


def sequence_duration_ms(light_log):
    """light_log 涵蓋的總時長（毫秒）= 所有段落中最晚的結束時刻。

    用 max 而不是假設 segments 已排序、取最後一筆——前端記錄順序理論上
    本來就是時間順序，但這裡不依賴那個假設。
    """
    segments = light_log.get("segments") or []
    if not segments:
        return 0.0
    return float(max(s["startMs"] + s["durationMs"] for s in segments))


def resample_light_curve(light_log, num_points):
    """把 light_log 重採樣成固定點數的標準化亮度曲線。

    §4.5 規定 lightCurve 固定長度 100，均勻涵蓋整段序列時長。

    參數:
        light_log: dict，§5.2 格式
        num_points: int
    回傳:
        list[float]，長度 num_points。序列為空或總時長為 0 時回傳全 0
    """
    duration = sequence_duration_ms(light_log)
    if duration <= 0:
        return [0.0] * num_points

    sample_times = np.linspace(0.0, duration, num_points)
    return [light_intensity_at(light_log, t) for t in sample_times]


def generate_light_log(num_segments=None, segment_ms_range=None, seed=None):
    """產生一份合成的 light_log，供測試使用，不需要瀏覽器。

    對齊前端實際邏輯（PLAN.md 階段2 Track3 前端部分）：固定段數、每段時長
    在範圍內隨機、顏色隨機抽（可連續重複，前端邏輯本來就沒有排除這點）。

    參數:
        num_segments: int | None，預設讀 config.PHOTO_SEGMENT_COUNT
        segment_ms_range: (int, int) | None，預設讀
            (config.PHOTO_SEGMENT_MIN_MS, config.PHOTO_SEGMENT_MAX_MS)
        seed: int | None，供測試重現結果；None 則每次呼叫結果不同

    回傳:
        dict，§5.2 格式（startTimestamp 固定為 0，因為測試不需要真實牆鐘時間）
    """
    num_segments = num_segments or config.PHOTO_SEGMENT_COUNT
    low, high = segment_ms_range or (
        config.PHOTO_SEGMENT_MIN_MS,
        config.PHOTO_SEGMENT_MAX_MS,
    )
    rng = random.Random(seed)

    segments = []
    t = 0
    for _ in range(num_segments):
        color = rng.choice(COLOR_NAMES)
        duration = rng.randint(low, high)
        segments.append(
            {
                "color": color,
                "hex": COLOR_HEX[color],
                "startMs": t,
                "durationMs": duration,
            }
        )
        t += duration

    return {"startTimestamp": 0, "segments": segments}
