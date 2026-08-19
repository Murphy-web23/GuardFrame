"""FastAPI｜SQLAlchemy 資料表定義。

契約見 CONVENTIONS.md §5.7、SDS 第二、三節逐欄定義。

前台/API 使用的 JSON 巢狀結構（common/schemas.py 的 VerificationRecord）
與這裡的平面化欄位不是同一份東西，兩者轉換由呼叫端（api/routes.py）
自己組裝，這個檔案只負責資料表結構本身。

`verification_records` 不把五層結果拆成獨立資料表——SDS §一已經論證過
這是一對一關係，拆分沒有正規化效益，只會增加 JOIN 成本，所以維持
平面化欄位存在單一表中。
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


class Applicant(Base):
    """申請人基本資料，一對多對應 VerificationRecordRow。"""

    __tablename__ = "applicants"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    id_number_masked: Mapped[str] = mapped_column(String(15))
    phone: Mapped[str] = mapped_column(String(20))
    email: Mapped[str] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(String(200))
    birth_date: Mapped[date]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    # §4.8 簡訊驗證與全域倒數 Session（2026-08-19 新增，§5.7 沒有列出這三欄，
    # 屬於「§2 允許新增欄位」的延伸，不是既有欄位的變動）。
    # sms_attempts 統計連續錯誤次數（§5.5：連續錯誤 3 次需重新發送），
    # sms/send 成功時歸零。
    session_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    sms_code: Mapped[Optional[str]] = mapped_column(String(6), nullable=True)
    sms_attempts: Mapped[int] = mapped_column(default=0)
    sms_verified_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    session_deadline_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    verification_records: Mapped[list["VerificationRecordRow"]] = relationship(
        back_populates="applicant"
    )


class VerificationRecordRow(Base):
    """每筆驗證的完整依據，含五層原始分數（平面化欄位，見 SDS §二）。"""

    __tablename__ = "verification_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    applicant_id: Mapped[int] = mapped_column(ForeignKey("applicants.id"))

    # -- 區塊一：基本資訊與錄影資料 --
    timestamp: Mapped[datetime]
    source_type: Mapped[str] = mapped_column(String(20))
    duration_sec: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    fps: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    total_frames: Mapped[int]
    phases: Mapped[dict] = mapped_column(JSONB)
    # 2026-08-19 新增：象徵性影片保存（見 PHASE1_NOTES §八），相對於
    # BASE_DIR 的路徑字串，NULL 代表這筆紀錄沒有保存原始影片（目前只有
    # 這個原因：分析中途失敗，見 api/routes.py verify() 的清理邏輯）。
    # §5.7 未列出，屬於允許新增的欄位，不對外 API 曝露（純後端內部用）。
    video_path: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)

    # -- 區塊二：影像品質檢查 --
    quality_passed: Mapped[bool]
    blur_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 2))
    brightness: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    contrast: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    overexposed_ratio: Mapped[Optional[Decimal]] = mapped_column(Numeric(4, 3))
    face_ratio: Mapped[Optional[Decimal]] = mapped_column(Numeric(4, 3))
    quality_message: Mapped[Optional[str]] = mapped_column(Text)

    # -- 區塊三：對照組（動作挑戰）--
    baseline_challenges: Mapped[dict] = mapped_column(JSONB)
    baseline_verdict: Mapped[str] = mapped_column(String(10))
    # confidenceScore 是 2026-08-19 改版新增的欄位（§2 允許新增），但
    # 當時漏了同步補進 DB 欄位——五層算出來的信心分數只活在單次 /verify
    # 回應裡，寫進 DB 前就遺失了，之後想從 admin/records 讀回來會拿不到
    # 這個值。2026-08-19 稍晚（實作 admin/records 時）發現並補上四個
    # track 對應的欄位，此後寫入的紀錄才會完整保留。
    baseline_confidence_score: Mapped[Decimal] = mapped_column(Numeric(5, 4))

    # -- 區塊四：Track 1（合成偵測）--
    synthetic_fake_probability: Mapped[Decimal] = mapped_column(Numeric(5, 4))
    synthetic_threshold: Mapped[Decimal] = mapped_column(Numeric(5, 4))
    synthetic_verdict: Mapped[str] = mapped_column(String(10))
    synthetic_top_signals: Mapped[dict] = mapped_column(JSONB)

    # -- 區塊五：Track 2（生理訊號）--
    rppg_detected: Mapped[bool]
    rppg_heart_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    rppg_snr: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    rppg_roi_consistency: Mapped[Decimal] = mapped_column(Numeric(4, 3))
    rppg_checks: Mapped[dict] = mapped_column(JSONB)
    rppg_waveform: Mapped[dict] = mapped_column(JSONB)
    rppg_spectrum: Mapped[dict] = mapped_column(JSONB)
    rppg_confidence_score: Mapped[Decimal] = mapped_column(Numeric(5, 4))

    # -- 區塊六：Track 3（照明響應）--
    photo_detected: Mapped[bool]
    photo_correlation: Mapped[Decimal] = mapped_column(Numeric(4, 3))
    photo_latency_ms: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2))
    photo_geometry_score: Mapped[Decimal] = mapped_column(Numeric(4, 3))
    photo_sequence: Mapped[dict] = mapped_column(JSONB)
    photo_checks: Mapped[dict] = mapped_column(JSONB)
    photo_light_curve: Mapped[dict] = mapped_column(JSONB)
    photo_reflect_curve: Mapped[dict] = mapped_column(JSONB)
    photo_confidence_score: Mapped[Decimal] = mapped_column(Numeric(5, 4))

    # -- 區塊七：Track 4（遮擋一致性，核心防禦層）--
    occ_detected: Mapped[bool]
    occ_wave_cycles: Mapped[int]
    occ_identity_stability: Mapped[Decimal] = mapped_column(Numeric(4, 3))
    occ_max_identity_drop: Mapped[Decimal] = mapped_column(Numeric(4, 3))
    occ_segments: Mapped[dict] = mapped_column(JSONB)
    occ_layer_score: Mapped[Decimal] = mapped_column(Numeric(4, 3))
    occ_anomaly_frames: Mapped[dict] = mapped_column(JSONB)
    occ_checks: Mapped[dict] = mapped_column(JSONB)
    occ_stability_curve: Mapped[dict] = mapped_column(JSONB)
    occ_confidence_score: Mapped[Decimal] = mapped_column(Numeric(5, 4))

    # -- 區塊八：決策融合 --
    risk_score: Mapped[int]
    verdict: Mapped[str] = mapped_column(String(10))
    verdict_label: Mapped[str] = mapped_column(String(20))
    reasons: Mapped[dict] = mapped_column(JSONB)
    # pending_setup/opened/pending/rejected，pending_setup 最長 14 字元（§5.4/§5.8）
    account_result: Mapped[str] = mapped_column(String(14))

    # -- 區塊九：VLM 輔助審核 --
    # vlm_available 三態設計：NULL=未觸發（非 review 案件）/FALSE=觸發但失敗/TRUE=成功
    vlm_available: Mapped[Optional[bool]]
    vlm_frame_observations: Mapped[Optional[dict]] = mapped_column(JSONB)
    vlm_summary: Mapped[Optional[str]] = mapped_column(Text)
    vlm_model: Mapped[Optional[str]] = mapped_column(String(50))
    vlm_latency_ms: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 2))

    applicant: Mapped["Applicant"] = relationship(back_populates="verification_records")


class AdminCredential(Base):
    """後台登入帳號，密碼以 bcrypt 雜湊儲存（NFR-15），見 CONVENTIONS §4.9/§8.1。"""

    __tablename__ = "admin_credentials"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    # 登入成功後的簡易 session token（§4.9：「成功時回傳簡易 session
    # token」），§5.7 沒列出這兩欄，屬於允許新增的欄位。
    token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    token_expires_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
