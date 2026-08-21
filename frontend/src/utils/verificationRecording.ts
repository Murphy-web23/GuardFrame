// 人臉驗證錄影用的共用邏輯：Track 3 燈光顏色序列產生、影格索引換算。
//
// 這裡的顏色/亮度值必須跟 track3_photometric/sequence.py 的
// COLOR_HEX／PHOTO_SEGMENT_* 常數完全一致——這幾個數字是後端拿來
// 算「螢幕亮度曲線」跟真人反射訊號互相關的基準，前端跟後端對不起來
// 的話，Track 3 的相關係數會算不出正確結果（不是報錯，是靜默算錯）。
import type { LightLog, LightLogSegment } from '../api/client';

// 對應 config.PHOTO_SEGMENT_COUNT / _MIN_MS / _MAX_MS
export const PHOTO_SEGMENT_COUNT = 5;
export const PHOTO_SEGMENT_MIN_MS = 400;
export const PHOTO_SEGMENT_MAX_MS = 600;

// 對應 track3_photometric/sequence.py 的 COLOR_HEX
export const LIGHT_COLOR_HEX: Record<LightLogSegment['color'], string> = {
  淡紅: '#D98080',
  灰白: '#E8E8E8',
  淡藍: '#8098D9',
  淡綠: '#80D9A0',
};

const LIGHT_COLOR_NAMES = Object.keys(LIGHT_COLOR_HEX) as LightLogSegment['color'][];

// 對應 config.BASELINE_ACTION_DURATIONS（§5.3：四個動作固定時長）
export const ACTION_DURATIONS_SEC: Record<'blink' | 'turn_left' | 'turn_right' | 'wave_hand', number> = {
  blink: 3,
  turn_left: 5,
  turn_right: 5,
  wave_hand: 7,
};

// 錄影請求的目標 fps。getUserMedia 的 frameRate 是「盡量」不是保證，
// 這裡假設瀏覽器大致照這個速率編碼，跟 CONVENTIONS §5.3
// 「記下 performance.now()，除以 fps 換算成影格索引」是同一套做法——
// 目前後端沒有反過來拿真實影片的 fps 校正這裡宣告的值，兩邊對不起來
// 時，切出來的 phases 影格範圍會不準，這是已知風險，見
// PHASE1_NOTES 的說明。
export const RECORDING_FPS = 30;

/** 隨機產生一份 Track 3 用的燈光序列，段數/時長/顏色分佈跟後端
 * generate_light_log() 的邏輯對齊（顏色可重複，時長 400-600ms 均勻分佈）。
 * startTimestamp 用真實的 Date.now()，是這次序列開始播放的絕對時間戳
 * （§5.2 格式要求）。
 */
export function generateLightLog(startTimestamp: number = Date.now()): LightLog {
  const segments: LightLogSegment[] = [];
  let t = 0;
  for (let i = 0; i < PHOTO_SEGMENT_COUNT; i++) {
    const color = LIGHT_COLOR_NAMES[Math.floor(Math.random() * LIGHT_COLOR_NAMES.length)];
    const durationMs =
      PHOTO_SEGMENT_MIN_MS + Math.floor(Math.random() * (PHOTO_SEGMENT_MAX_MS - PHOTO_SEGMENT_MIN_MS + 1));
    segments.push({ color, hex: LIGHT_COLOR_HEX[color], startMs: t, durationMs });
    t += durationMs;
  }
  return { startTimestamp, segments };
}

/** light_log 涵蓋的總時長（毫秒），對應 sequence.py 的 sequence_duration_ms()。*/
export function lightLogDurationMs(lightLog: LightLog): number {
  if (lightLog.segments.length === 0) return 0;
  return Math.max(...lightLog.segments.map((s) => s.startMs + s.durationMs));
}

/** 把「相對錄影開始的毫秒數」換算成影格索引（0-indexed）。*/
export function msToFrame(ms: number, fps: number = RECORDING_FPS): number {
  return Math.round((ms / 1000) * fps);
}

/** 把 [startMs, endMs) 這種「結束時刻不含在內」的區間，換算成後端
 * `_slice_phase()` 期待的 [起, 訖] 影格索引（訖含在內，見 CONVENTIONS
 * §5.1 範例：lighting=[600,692] 對應 frames[600:693]）。
 */
export function msRangeToFrameRange(
  startMs: number,
  endMs: number,
  fps: number = RECORDING_FPS
): [number, number] {
  const start = msToFrame(startMs, fps);
  const end = Math.max(start, msToFrame(endMs, fps) - 1);
  return [start, end];
}
