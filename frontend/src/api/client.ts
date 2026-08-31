// GuardFrame Backend API client.
//
// 對應 CONVENTIONS.md §5.5 契約與 07_Frontend_API_Integration_Specification.md
// 記錄的實際行為。只包一層薄薄的 fetch，不做重試/快取這些額外機制——
// 目前的整合範圍是「換掉 mock 資料」，不是重寫一套 HTTP 層。
//
// 兩套認證機制（見 07 spec §二）：
//   - 申請人端：X-Session-Id header，來自 sms/verify 的 sessionId
//   - 後台端：Authorization: Bearer <token>，來自 admin/login 的 token
// 不要混用。

const API_BASE_URL: string =
  (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:8000';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { headers?: Record<string, string> } = {}
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    // /verify 品質不合格的 422 沒有 detail 欄位，而是 {"quality": {message, ...}}
    // （見 07 spec §三 API 6／image_utils/quality.py）；其餘錯誤都是
    // {"detail": ...}——這裡統一包成 ApiError，優先取比較好懂的那個欄位。
    //
    // 2026-08-30：detail 不一定是字串——FastAPI 路徑/請求參數解析失敗時
    // （例如傳了格式錯誤的 id），detail 會是一包驗證錯誤物件的陣列，
    // 直接 String() 對物件/陣列做轉換會印出 "[object Object]" 這種對
    // 使用者毫無意義的文字（曾經真的發生過，見後台補件通知按鈕的
    // bug）。是字串才直接用，不是字串就退回去顯示 HTTP 狀態碼版本的
    // 通用訊息，而不是硬轉成一串看不懂的東西。
    const rawDetail = body && typeof body === 'object' ? (body as any).detail : undefined;
    const detailMessage = typeof rawDetail === 'string' ? rawDetail : null;
    const qualityMessage =
      body && typeof body === 'object' && 'quality' in body
        ? String((body as any).quality?.message ?? '')
        : null;
    const message =
      detailMessage || (qualityMessage ? `畫面品質不合格：${qualityMessage}` : null) ||
      `請求失敗（HTTP ${response.status}）`;
    throw new ApiError(response.status, message, body);
  }

  return body as T;
}

function jsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'Content-Type': 'application/json', ...extra };
}

// --------------------------------------------------------------------------
// 申請人流程
// --------------------------------------------------------------------------

export interface ApplicantCreateInput {
  name: string;
  idNumber: string;
  birthDate: string; // YYYY-MM-DD
  phone: string;
  email: string;
  address: string;
}

export async function createApplicant(
  input: ApplicantCreateInput
): Promise<{ applicantId: number }> {
  return request('/api/applicants', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
}

export async function sendSms(applicantId: number, phone: string): Promise<{ sent: boolean }> {
  return request(`/api/applicants/${applicantId}/sms/send`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ phone }),
  });
}

export interface SmsVerifyResult {
  success: boolean;
  sessionId: string;
  smsVerifiedAt: string;
  deadlineAt: string;
}

export async function verifySms(applicantId: number, code: string): Promise<SmsVerifyResult> {
  return request(`/api/applicants/${applicantId}/sms/verify`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ code }),
  });
}

export interface ChallengeOrderItem {
  action: 'blink' | 'turn_left' | 'turn_right' | 'wave_hand';
  durationSec: number;
}

export async function getChallengeOrder(
  applicantId: number,
  sessionId: string
): Promise<{ challenges: ChallengeOrderItem[] }> {
  return request(`/api/applicants/${applicantId}/challenge-order`, {
    method: 'GET',
    headers: { 'X-Session-Id': sessionId },
  });
}

export interface IdCardRectifyResult {
  success: boolean;
  rectified: string | null; // data:image/jpeg;base64,...
  corners: number[][] | null;
  confidence: number;
  message: string;
}

export async function rectifyIdCard(imageFile: Blob): Promise<IdCardRectifyResult> {
  const form = new FormData();
  form.append('image', imageFile, 'id-card.jpg');
  return request('/api/id-card/rectify', { method: 'POST', body: form });
}

export async function resetSession(
  applicantId: number,
  sessionId: string
): Promise<{ reset: boolean }> {
  return request(`/api/applicants/${applicantId}/reset`, {
    method: 'POST',
    headers: { 'X-Session-Id': sessionId },
  });
}

export interface AccountSetupInput {
  accountType: 'type1' | 'type3';
  transactionPassword: string;
  notificationPreference: { sms: boolean; email: boolean };
  termsAccepted: boolean;
}

export async function setupAccount(
  applicantId: number,
  sessionId: string,
  input: AccountSetupInput
): Promise<{ success: boolean; accountResult: 'opened' }> {
  return request(`/api/applicants/${applicantId}/account-setup`, {
    method: 'POST',
    headers: jsonHeaders({ 'X-Session-Id': sessionId }),
    body: JSON.stringify(input),
  });
}

// --------------------------------------------------------------------------
// 人臉驗證核心端點（§5.5 POST /verify）
// --------------------------------------------------------------------------

export interface LightLogSegment {
  color: '淡紅' | '灰白' | '淡藍' | '淡綠';
  hex: string;
  startMs: number;
  durationMs: number;
}

export interface LightLog {
  startTimestamp: number;
  segments: LightLogSegment[];
}

// 2026-08-27：這三個是 [起, 訖) 毫秒區間（相對錄影開始），不是影格
// 索引——換算成影格索引這一步交給後端用真實 fps 做，見
// common/schemas.py RecordingPhases 的說明。
export interface RecordingPhases {
  action: [number, number];
  lighting: [number, number];
  occlusion: [number, number];
}

export interface ChallengesPayload {
  challenges: ChallengeOrderItem[];
  recording: {
    durationSec: number;
    fps: number;
    totalFrames: number;
    phases: RecordingPhases;
  };
}

// 2026-08-25：/verify 後端改成非同步（先回應 202「處理中」，五層分析在
// 背景跑），不再是「等到分析全部跑完才回應」——MediaPipe/InsightFace
// 在 CPU 上實測數十秒到數分鐘，同步等待會被 Cloudflare Tunnel 這類
// proxy 中途判定逾時掐斷連線（見 PHASE1_NOTES.md）。呼叫端不會再拿到
// 完整的 BackendVerificationRecord，只拿到這個送出確認；真正的結果要
// 另外呼叫 getVerifyResult() 輪詢。
export interface VerifySubmitAck {
  status: 'processing';
  applicantId: number;
}

export async function verifyFace(
  applicantId: number,
  sessionId: string,
  video: Blob,
  lightLog: LightLog,
  challenges: ChallengesPayload,
  // 2026-08-29：舊預設值寫死是 '虛擬攝影機'，但唯一的呼叫端從沒傳這個
  // 參數，導致資料庫裡所有紀錄的 source_type 都是這個假值，跟使用者
  // 實際用的鏡頭完全無關。呼叫端現在會用 lib/cameraSource.ts 偵測
  // 裝置標籤傳進來，這裡的預設值只在真的沒傳時當保底，改成語意正確的
  // 「未知」。
  sourceType: string = '未知'
): Promise<VerifySubmitAck> {
  const form = new FormData();
  const ext = video.type.includes('mp4') ? 'mp4' : 'webm';
  form.append('video', video, `verify.${ext}`);
  form.append('light_log', JSON.stringify(lightLog));
  form.append('challenges', JSON.stringify(challenges));
  form.append('source_type', sourceType);
  return request(`/api/applicants/${applicantId}/verify`, {
    method: 'POST',
    headers: { 'X-Session-Id': sessionId },
    body: form,
  });
}

export type VerifyResultPoll =
  | { status: 'processing' }
  | { status: 'done'; record: BackendVerificationRecord };

export async function getVerifyResult(
  applicantId: number,
  sessionId: string
): Promise<VerifyResultPoll> {
  return request(`/api/applicants/${applicantId}/verify-result`, {
    method: 'GET',
    headers: { 'X-Session-Id': sessionId },
  });
}

// 開戶設定（account-setup）跟開戶完成畫面都需要「確定背景分析真的跑完
// 了」才能往下走，這裡提供共用的輪詢工具，不要各自重寫一份。預設每
// 3 秒問一次，最多等 5 分鐘（實測數十秒到數分鐘內都會跑完，5 分鐘已經
// 是很寬裕的上限）。
export async function waitForVerifyResult(
  applicantId: number,
  sessionId: string,
  options: { intervalMs?: number; timeoutMs?: number; onTick?: (elapsedMs: number) => void } = {}
): Promise<BackendVerificationRecord> {
  const intervalMs = options.intervalMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const startedAt = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await getVerifyResult(applicantId, sessionId);
    if (result.status === 'done') return result.record;

    const elapsed = Date.now() - startedAt;
    options.onTick?.(elapsed);
    if (elapsed >= timeoutMs) {
      throw new ApiError(
        408,
        'AI 複核處理時間較長，請稍候再試一次送出，或聯繫客服協助確認案件狀態',
        null
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// --------------------------------------------------------------------------
// 後台認證與查詢
// --------------------------------------------------------------------------

export async function adminLogin(
  username: string,
  password: string
): Promise<{ success: boolean; token: string | null }> {
  return request('/api/admin/login', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ username, password }),
  });
}

// 跟 common/schemas.py VerificationRecord 對應（§5.1）。只列前端目前
// 用得到的欄位，不是完整型別，需要更多欄位時再補。
export interface BackendVerificationRecord {
  id: string;
  // 2026-08-30：格式化顯示字串（"VF-..."），不能拿去打
  // /admin/records/{record_id}/action——那支端點要純數字 id，見下面
  // recordId 欄位跟 common/schemas.py VerificationRecord 的說明。
  recordId: number;
  applicantId: number;
  timestamp: string;
  applicantName: string;
  applicantIdMasked: string;
  sourceType: string;
  recording: { durationSec: number; fps: number; totalFrames: number };
  quality: { passed: boolean };
  baseline: { verdict: 'pass' | 'reject'; verdictLabel: string; confidenceScore: number };
  synthetic: { fakeProbability: number; verdict: 'pass' | 'reject' };
  rppg: { detected: boolean; confidenceScore: number };
  photometric: { detected: boolean; confidenceScore: number };
  occlusion: { detected: boolean; confidenceScore: number };
  decision: {
    riskScore: number;
    verdict: 'pass' | 'review' | 'reject';
    verdictLabel: string;
    reasons: string[];
  };
  // 2026-08-29：只有 verdict=review 的案件才會有值（見 vlm_summary/
  // summarizer.py），其餘案件是 null——後端 Optional[VlmSummary]。
  vlmSummary: {
    available: boolean;
    frameObservations: { timestampSec: number; observation: string }[];
    summary: string;
    model: string;
    latencyMs: number;
  } | null;
  accountResult: 'pending_setup' | 'opened' | 'pending' | 'rejected';
}

export async function listAdminRecords(
  token: string,
  options: { limit?: number; verdict?: 'pass' | 'review' | 'reject' } = {}
): Promise<{ records: BackendVerificationRecord[] }> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.verdict) params.set('verdict', options.verdict);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/admin/records${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getAdminRecord(
  token: string,
  recordId: number
): Promise<BackendVerificationRecord> {
  return request(`/api/admin/records/${recordId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// 後台人工複核案件的行員動作（發送補件通知／通知前往實體分行／確認核准
// 通過）。只有 verdict 為 'review' 的案件能呼叫，approve 以外的動作不會
// 改變案件的判定結果，純粹寄出對應通知信（見後端 notifications.py）。
export type AdminRecordAction = 'approve' | 'request_docs' | 'branch_visit';

export async function resolveAdminRecord(
  token: string,
  recordId: string | number,
  action: AdminRecordAction
): Promise<{ success: boolean; emailSent: boolean }> {
  return request(`/api/admin/records/${recordId}/action`, {
    method: 'POST',
    headers: jsonHeaders({ Authorization: `Bearer ${token}` }),
    body: JSON.stringify({ action }),
  });
}
