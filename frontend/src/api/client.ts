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
    // /verify 品質不合格的 422 沒有 detail 欄位（見 07 spec §三 API 6），
    // 其餘錯誤都是 {"detail": ...}——這裡統一包成 ApiError，讓呼叫端
    // 自己決定要不要細看 body。
    const message =
      (body && typeof body === 'object' && 'detail' in body
        ? String((body as any).detail)
        : null) || `請求失敗（HTTP ${response.status}）`;
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

export async function verifyFace(
  applicantId: number,
  sessionId: string,
  video: Blob,
  lightLog: LightLog,
  challenges: ChallengesPayload,
  sourceType: string = '虛擬攝影機'
): Promise<BackendVerificationRecord> {
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
