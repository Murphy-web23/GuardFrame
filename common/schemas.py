"""共用｜Pydantic 資料結構，處理 §7 命名規則裡「Python 內部 snake_case，
送給前端的 JSON 一律 camelCase」的轉換。

契約見 CONVENTIONS.md §5.1（完整驗證紀錄）、§5.2（光序列格式）、
§5.3（挑戰指定格式與階段區間）、§5.7（正式資料庫結構）、§7（命名規則）。

**這裡的欄位刻意跟各 analyzer 回傳的原始 dict 一樣直接用 camelCase 對應
（Track 2-4／對照組的契約本身就是回傳 camelCase 鍵的 dict，見 §4），
不是先轉成 snake_case 再轉回去。** 所有 model 都繼承 `CamelModel`：
欄位用 snake_case 定義（符合 §7「Python 內部用 snake_case」的字面意思，
也讓 IDE 補全跟 Python 慣例一致），`to_camel` alias_generator 自動產生
對應的 camelCase 別名，兩個方向都能用——`Model.model_validate(raw_dict)`
可以直接吃各 analyzer 回傳的 camelCase dict，`model.model_dump(by_alias=
True)` 輸出的也是 camelCase，不需要每個欄位手動寫 alias，不要在各處
手動轉（§7 原文的要求）。

**用到 model_dump() 或 model_dump_json() 的地方，記得帶 by_alias=True**
——忘記帶的話會印出 snake_case 版本，這點容易忘記，FastAPI 的
response_model 機制預設會用 alias（api/ 層再另外確認）。
"""

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --------------------------------------------------------------------------
# 共用的小型子結構
# --------------------------------------------------------------------------


class CheckItem(CamelModel):
    """三項判定的單一項目，Track 2/3/4 與對照組共用的格式（固定 3 項，
    順序不可變，順序本身由各 analyzer 保證，這裡不重覆檢查）。"""

    label: str
    passed: bool


class TopSignal(CamelModel):
    """Track 1 的判斷依據（§4.1），固定 3 個，weight 由高到低排序。"""

    label: str
    weight: float


# --------------------------------------------------------------------------
# 錄影階段區間（§5.1 recording.phases、§5.3）
# --------------------------------------------------------------------------


class RecordingPhases(CamelModel):
    """各階段的時間區間 [起, 訖)，相對錄影開始的毫秒數，訖不含在內。

    occlusion 是 action 內的子區間（= wave_hand 那一項的區間），
    不是獨立於動作挑戰之外的額外階段，見 §5.3 說明。

    2026-08-27：原本這裡是「影格索引」（前端用假設的固定 30fps 換算
    好才送過來）——真人測試（申請人 970）發現裝置實際錄影 fps 常常
    達不到 30（該次只有 24.4fps），前端假設的 fps 跟影片實際 fps
    對不上，換算出來的影格範圍會超出影片實際長度，Track 3/4 的分析
    範圍因此系統性地算錯。改成前端只送「毫秒」，換算成影格索引這一步
    挪到後端做（api/routes.py 的 `_ms_range_to_frame_range()`），用
    `extract_frames()` 解碼影片後量到的真實 fps 換算，從根本上避免
    這整類「假設 fps 跟真實 fps 對不上」的問題。
    """

    action: tuple[float, float]
    lighting: tuple[float, float]
    occlusion: tuple[float, float]


class RecordingInfo(CamelModel):
    duration_sec: float
    fps: float
    total_frames: int
    phases: RecordingPhases


# --------------------------------------------------------------------------
# 品質檢查（§4.7 check_image_quality() 的回傳格式）
# --------------------------------------------------------------------------


class QualityResult(CamelModel):
    passed: bool
    blur_score: float
    brightness: float
    contrast: float
    overexposed_ratio: float
    face_ratio: float
    message: str


# --------------------------------------------------------------------------
# 對照組（§4.3 analyze_baseline() 的回傳格式）
# --------------------------------------------------------------------------


class BaselineChallengeItem(CamelModel):
    action: Literal["blink", "turn_left", "turn_right", "wave_hand"]
    name: str
    duration_sec: int
    passed: bool


class BaselineResult(CamelModel):
    standard: str
    challenges: list[BaselineChallengeItem]
    verdict: Literal["pass", "reject"]
    verdict_label: str
    # 2026-08-19 新增：連續風險信心分數，0.0-1.0，數值越高代表越可疑，
    # 供 common/fusion.py 加權融合用（§2 允許新增欄位）。
    confidence_score: float


# --------------------------------------------------------------------------
# Track 1（§4.1 detect_synthetic() 的回傳格式，A 交付）
# --------------------------------------------------------------------------


class SyntheticResult(CamelModel):
    """detect_synthetic() 本身只回傳 fakeProbability/topSignals（§4.1），
    threshold 與 verdict 是融合層依 config.SYNTHETIC_THRESHOLD 比較後
    補上的，見 common/fusion.py。組裝完整紀錄時才會有這兩個欄位。
    """

    fake_probability: float
    threshold: float
    verdict: Literal["pass", "reject"]
    top_signals: list[TopSignal]


# --------------------------------------------------------------------------
# Track 2（§4.4 analyze_rppg() 的回傳格式）
# --------------------------------------------------------------------------


class RppgResult(CamelModel):
    detected: bool
    heart_rate: Optional[float]
    snr: float
    roi_consistency: float
    checks: list[CheckItem]
    waveform: list[float]
    spectrum: list[float]
    confidence_score: float


# --------------------------------------------------------------------------
# Track 3（§4.5 analyze_photometric() 的回傳格式）
# --------------------------------------------------------------------------


class PhotometricResult(CamelModel):
    detected: bool
    correlation: float
    latency_ms: Optional[float]
    geometry_score: float
    sequence: list[str]
    checks: list[CheckItem]
    light_curve: list[float]
    reflect_curve: list[float]
    confidence_score: float


# --------------------------------------------------------------------------
# Track 4（§4.6 analyze_occlusion() 的回傳格式，核心防禦層）
# --------------------------------------------------------------------------


class OcclusionResult(CamelModel):
    detected: bool
    wave_cycles_detected: int
    identity_stability: float
    max_identity_drop: float
    occlusion_segments: list[tuple[int, int]]
    layer_score: float
    anomaly_frames: list[int]
    checks: list[CheckItem]
    stability_curve: list[float]
    confidence_score: float


# --------------------------------------------------------------------------
# 決策融合（common/fusion.py 的回傳格式）
# --------------------------------------------------------------------------


class DecisionResult(CamelModel):
    risk_score: int
    verdict: Literal["pass", "review", "reject"]
    verdict_label: str
    reasons: list[str]


# --------------------------------------------------------------------------
# VLM 摘要（§4.2 summarize_verification() 的回傳格式，A 交付，排序在後）
# --------------------------------------------------------------------------


class VlmFrameObservation(CamelModel):
    # 2026-08-29：原本是 frame_index，但複核人員要的是「該去影片哪個
    # 時間點看」，不是內部的影格編號——換算成秒數在這裡做一次，
    # 前端跟複核人員都不用自己拿 frame_index 除以 fps。
    timestamp_sec: float
    observation: str


class VlmSummary(CamelModel):
    available: bool
    frame_observations: list[VlmFrameObservation]
    summary: str
    model: str
    latency_ms: float


# --------------------------------------------------------------------------
# 完整驗證紀錄（§5.1，前台/API/資料庫共用的最上層結構）
# --------------------------------------------------------------------------


class VerificationRecord(CamelModel):
    id: str
    timestamp: str
    applicant_name: str
    applicant_id_masked: str
    source_type: Literal["實體相機", "虛擬攝影機", "實體相機（翻拍）"]

    recording: RecordingInfo
    quality: QualityResult
    baseline: BaselineResult
    synthetic: SyntheticResult
    rppg: RppgResult
    photometric: PhotometricResult
    occlusion: OcclusionResult
    decision: DecisionResult

    vlm_summary: Optional[VlmSummary] = None
    # pending_setup：verdict=pass 但尚未完成帳戶設定的中繼狀態（§5.8）
    account_result: Literal["pending_setup", "opened", "pending", "rejected"]


# --------------------------------------------------------------------------
# 前端輸入：光序列（§5.2）與挑戰指定（§5.3）
#
# 這兩個不是 analyzer 的輸出，是前端錄影時產生、隨影片一起上傳的資料，
# FastAPI 收到 §5.5 API 契約裡的 light_log / challenges 這兩個 JSON
# string 欄位時，用這裡的 model 解析驗證。
# --------------------------------------------------------------------------


class LightLogSegment(CamelModel):
    color: Literal["淡紅", "淡綠", "淡藍", "灰白"]
    hex: str
    start_ms: int
    duration_ms: int


class LightLog(CamelModel):
    start_timestamp: int
    segments: list[LightLogSegment]


class ChallengeSpec(CamelModel):
    """前端指定的動作順序（§5.3）。只有 action + durationSec——passed
    是 analyze_baseline() 判定後才有的欄位，屬於 BaselineChallengeItem，
    不是這裡。"""

    action: Literal["blink", "turn_left", "turn_right", "wave_hand"]
    duration_sec: int


class ChallengesPayload(CamelModel):
    challenges: list[ChallengeSpec]
    recording: RecordingInfo


class ChallengeOrderResponse(CamelModel):
    """GET /api/applicants/{id}/challenge-order 的回應（2026-08-19 新增，
    §5.5 沒有列出，補上「伺服器產生隨機挑戰順序」這塊實作時新增的端點，
    見 PHASE1_NOTES §九）。故意跟上面 ChallengesPayload.challenges 的
    形狀完全一樣（list[ChallengeSpec]）——前端可以原封不動地把這個回應
    存起來，播放挑戰用它、上傳 /verify 時的 challenges 欄位也直接重用，
    不需要另外轉換格式。"""

    challenges: list[ChallengeSpec]


# --------------------------------------------------------------------------
# API 請求/回應：POST /api/applicants（§5.5）
# --------------------------------------------------------------------------


class ApplicantCreateRequest(CamelModel):
    """idNumber 是完整身分證字號，只在請求解析與遮蔽這一步存在——
    api/routes.py 收到後立刻算出 id_number_masked，完整號碼不寫進資料庫
    也不記錄於任何地方（NFR-14）。"""

    name: str
    id_number: str
    birth_date: date
    phone: str
    email: str
    address: str


class ApplicantCreateResponse(CamelModel):
    applicant_id: int


# --------------------------------------------------------------------------
# API 請求/回應：POST /api/id-card/rectify（§4.7、§5.5）
#
# §5.5 的欄位列表只寫了 { success, corners, confidence, message }，但
# 後面括號明確提到「success 為 False 時不含 rectified 影像」——代表
# success 為 True 時應該要有 rectified 欄位，只是文件列表本身漏寫了。
# rectify_id_card() 回傳的 rectified 是 np.ndarray，HTTP JSON 回應無法
# 直接放 ndarray，這裡選擇編碼成 base64 data URI 字串（JPEG），整個
# response 維持單一 JSON 物件，不用另外開一支下載端點，這是最貼近
# §5.5 既有風格（單一 JSON 物件裝所有東西）的做法。
# --------------------------------------------------------------------------


class IdCardRectifyResponse(CamelModel):
    success: bool
    rectified: Optional[str] = None  # "data:image/jpeg;base64,..."，失敗時為 None
    corners: Optional[list[list[float]]] = None
    confidence: float
    message: str


# --------------------------------------------------------------------------
# API 請求/回應：簡訊驗證與 Session（§4.8、§5.5）
#
# 2026-08-19 補上實作。sessionId 是 sms/verify 成功後產生的不透明 token，
# 之後 /verify、/account-setup、/reset 都要求呼叫端在 X-Session-Id
# header 帶上同一個值（不塞進這幾個 request body，見 api/routes.py 的
# session 驗證邏輯），用來證明請求真的是剛完成簡訊驗證的那個人送出的。
# --------------------------------------------------------------------------


class SmsSendRequest(CamelModel):
    phone: str


class SmsSendResponse(CamelModel):
    sent: bool


class SmsVerifyRequest(CamelModel):
    code: str


class SmsVerifyResponse(CamelModel):
    success: bool
    session_id: str
    sms_verified_at: str
    deadline_at: str


class ResetResponse(CamelModel):
    reset: bool


# --------------------------------------------------------------------------
# API 請求/回應：帳戶設定（§5.8，對應 PRD 步驟⑤）
# --------------------------------------------------------------------------


class NotificationPreference(CamelModel):
    sms: bool
    email: bool


class AccountSetupRequest(CamelModel):
    """transactionPassword 的「6 位數字」格式檢查、termsAccepted 的
    true 檢查都在 api/routes.py 手動做，回傳明確的 400（見 §5.8），
    不用 Pydantic 欄位約束觸發 FastAPI 預設的 422——契約寫的是 400。"""

    account_type: Literal["type1", "type3"]
    transaction_password: str
    notification_preference: NotificationPreference
    terms_accepted: bool


class AccountSetupResponse(CamelModel):
    success: bool
    account_result: Literal["opened"]


# --------------------------------------------------------------------------
# API 請求/回應：後台認證與查詢（§4.9、§5.5）
#
# 這是給銀行行員用的後台，跟上面申請人流程的 session 是不同機制——
# 行員有事先建立好的帳號密碼（§8.1），登入後用 Authorization: Bearer
# <token> header 存取查詢端點，不是 X-Session-Id。
# --------------------------------------------------------------------------


class AdminLoginRequest(CamelModel):
    username: str
    password: str


class AdminLoginResponse(CamelModel):
    success: bool
    token: Optional[str] = None


class AdminRecordsResponse(CamelModel):
    records: list[VerificationRecord]


class AdminRecordActionRequest(CamelModel):
    """人工複核案件的行員動作。只有 verdict == "review" 的案件能執行。

    approve：行員確認核准通過，改寫 verdict/verdictLabel 為最終結果，
        寄送核准通知信。
    request_docs／branch_visit：不改動判定結果（案件仍是 review，
        還在等後續動作），只寄出對應內容的通知信。
    """

    action: Literal["approve", "request_docs", "branch_visit"]


class AdminRecordActionResponse(CamelModel):
    success: bool
    email_sent: bool
