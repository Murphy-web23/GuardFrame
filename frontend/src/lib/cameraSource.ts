// 從 MediaStreamTrack 的裝置標籤判斷是不是虛擬攝影機（OBS、DroidCam 等）。
// 攻擊者常用虛擬攝影機驅動把預錄/合成影片灌進瀏覽器當作鏡頭輸入，
// 標籤裡通常帶得出裝置軟體名稱，用關鍵字比對是最簡單可行的判斷方式。
//
// 回傳值只能是 common/schemas.py VerificationRecord.source_type 允許的
// 三個字面值其中兩個（「實體相機（翻拍）」是 Track3 翻拍攻擊判定的結果，
// 不是這裡能判斷的範圍，不會由這支函式產生）。抓不到標籤時（部分瀏覽器
// 在使用者尚未跟頁面互動過時不給標籤）無法判斷是不是虛擬攝影機，這種
//「不確定」的情況預設為「實體相機」而不是把它當成可疑訊號——沒有偵測到
// 虛擬攝影機的證據，不代表就是虛擬攝影機，寧可保守賦值也不要製造假警訊。
const VIRTUAL_CAMERA_KEYWORDS = [
  'obs',
  'virtual',
  '虛擬',
  'droidcam',
  'iriun',
  'snap camera',
  'manycam',
  'xsplit',
  'camtwist',
  'ivcam',
  'ndi',
  'chromacam',
  'ecamm',
  'vcam',
];

export type CameraSourceType = '實體相機' | '虛擬攝影機';

export function detectCameraSourceType(label: string | undefined | null): CameraSourceType {
  if (!label) return '實體相機';
  const lower = label.toLowerCase();
  return VIRTUAL_CAMERA_KEYWORDS.some((kw) => lower.includes(kw)) ? '虛擬攝影機' : '實體相機';
}
