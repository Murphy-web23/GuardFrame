"""FastAPI｜路由。

契約見 CONVENTIONS.md §5.5 API 契約。2026-08-19 補上 §4.8 的簡訊驗證＋
Session 機制（sms/send、sms/verify、account-setup、reset）——這四個
互相依賴（session_id 是 sms/verify 產生的，其餘三個都要驗證它），
沒辦法只做其中一個。admin/login、admin/records 是另一套給行員用的
機制（§4.9，帳號密碼＋bcrypt），跟這裡的申請人 session 無關，還沒做。
"""

import base64
import secrets
import shutil
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

import config
from api.auth import verify_admin_login
from api.database import get_db
from api.models import AdminCredential, Applicant, VerificationRecordRow
from baseline_challenge.analyzer import analyze_baseline
from common.face_utils import extract_frames
from common.fusion import fuse_decision
from common.schemas import (
    AccountSetupRequest,
    AccountSetupResponse,
    AdminLoginRequest,
    AdminLoginResponse,
    AdminRecordsResponse,
    ApplicantCreateRequest,
    ApplicantCreateResponse,
    ChallengesPayload,
    IdCardRectifyResponse,
    LightLog,
    ResetResponse,
    SmsSendRequest,
    SmsSendResponse,
    SmsVerifyRequest,
    SmsVerifyResponse,
    VerificationRecord,
)
from image_utils.id_card import rectify_id_card
from image_utils.quality import check_image_quality
from track1_synthetic.detector import detect_synthetic
from track2_rppg.analyzer import analyze_rppg
from track3_photometric.analyzer import analyze_photometric
from track4_occlusion.analyzer import analyze_occlusion
from vlm_summary.summarizer import summarize_verification

router = APIRouter(prefix="/api")

_ACCOUNT_RESULT_BY_VERDICT = {
    "pass": "pending_setup",
    "review": "pending",
    "reject": "rejected",
}


def mask_id_number(id_number: str) -> str:
    """身分證字號遮蔽格式，例如 A123456789 -> A12****789（NFR-14）。

    保留前三後三、中間全部改成星號。字串太短（正常身分證不會發生，
    但避免對非預期輸入還原出完整值）時保守地全部遮蔽。
    """
    if len(id_number) <= 6:
        return "*" * len(id_number)
    return id_number[:3] + "*" * (len(id_number) - 6) + id_number[-3:]


def _require_session(applicant: Applicant, x_session_id: str, *, check_deadline: bool) -> None:
    """§4.8 session 驗證：證明這個請求真的是剛完成簡訊驗證的那個人送出的，
    不是有人猜到 applicantId 就能亂呼叫。session_id 放在 X-Session-Id
    header（不塞進 request body，不用改動 §5.5 已經定義好的欄位）。

    check_deadline 只有 /verify 要開——§5.6 流程圖：15 分鐘倒數只涵蓋
    ③④兩步驟，/account-setup 與 /reset 不檢查是否逾時。
    """
    if not applicant.session_id or applicant.session_id != x_session_id:
        raise HTTPException(status_code=401, detail="session 無效或不屬於此申請人")
    if check_deadline and datetime.now() > applicant.session_deadline_at:
        raise HTTPException(status_code=409, detail="session 已逾時，請重新完成簡訊驗證")


@router.post("/applicants/{applicant_id}/sms/send", response_model=SmsSendResponse)
def send_sms(
    applicant_id: int, payload: SmsSendRequest, db: Session = Depends(get_db)
) -> SmsSendResponse:
    """§4.8／§5.5：Demo 模式固定驗證碼，不接真的簡訊服務商。每次呼叫
    重設驗證碼與錯誤次數，讓使用者連續錯誤 3 次（403）後能重新取得機會。
    """
    applicant = db.get(Applicant, applicant_id)
    if applicant is None:
        raise HTTPException(status_code=404, detail="applicant not found")

    applicant.sms_code = config.SMS_DEMO_CODE
    applicant.sms_attempts = 0
    db.commit()
    return SmsSendResponse(sent=True)


@router.post("/applicants/{applicant_id}/sms/verify", response_model=SmsVerifyResponse)
def verify_sms(
    applicant_id: int, payload: SmsVerifyRequest, db: Session = Depends(get_db)
) -> SmsVerifyResponse:
    """§4.8／§5.5：驗證碼正確時產生 session_id、啟動 15 分鐘全域倒數。
    deadlineAt 由後端算並回傳，前端只能顯示、不能自行計算截止時間
    （避免使用者調整系統時間繞過限制，§4.8 明文要求）。
    """
    applicant = db.get(Applicant, applicant_id)
    if applicant is None:
        raise HTTPException(status_code=404, detail="applicant not found")

    # 沒發過驗證碼、或已經連續錯誤達上限：兩種情況都是「目前沒有可核對的
    # 有效驗證碼」，必須重新呼叫 sms/send 才能繼續，直接擋在比對碼之前
    # ——不能讓已經鎖住的驗證碼，之後靠對到正確碼就矇混過關。
    if applicant.sms_code is None or applicant.sms_attempts >= config.SMS_MAX_ATTEMPTS:
        raise HTTPException(status_code=403, detail="連續錯誤已達上限，請重新發送簡訊")

    if payload.code != applicant.sms_code:
        applicant.sms_attempts += 1
        exhausted = applicant.sms_attempts >= config.SMS_MAX_ATTEMPTS
        db.commit()
        if exhausted:
            raise HTTPException(status_code=403, detail="連續錯誤 3 次，請重新發送簡訊")
        raise HTTPException(status_code=400, detail="驗證碼錯誤")

    now = datetime.now()
    applicant.session_id = secrets.token_urlsafe(config.SESSION_TOKEN_BYTES)
    applicant.sms_verified_at = now
    applicant.session_deadline_at = now + timedelta(minutes=config.SESSION_DEADLINE_MINUTES)
    applicant.sms_code = None
    applicant.sms_attempts = 0
    db.commit()

    return SmsVerifyResponse(
        success=True,
        session_id=applicant.session_id,
        sms_verified_at=applicant.sms_verified_at.isoformat(),
        deadline_at=applicant.session_deadline_at.isoformat(),
    )


@router.post("/applicants/{applicant_id}/reset", response_model=ResetResponse)
def reset_session(
    applicant_id: int,
    x_session_id: str = Header(..., alias="X-Session-Id"),
    db: Session = Depends(get_db),
) -> ResetResponse:
    """§4.8：15 分鐘倒數歸零時前端呼叫，捨棄本輪未提交資料，退回步驟①。

    目前的 /verify 是「五層分析完成才一次寫入資料庫」，沒有「草稿」狀態
    的 verification_records 存在，所以這裡不需要刪除任何列——真正要
    捨棄的只有 session 本身。
    """
    applicant = db.get(Applicant, applicant_id)
    if applicant is None:
        raise HTTPException(status_code=404, detail="applicant not found")

    _require_session(applicant, x_session_id, check_deadline=False)

    applicant.session_id = None
    applicant.sms_verified_at = None
    applicant.session_deadline_at = None
    db.commit()

    return ResetResponse(reset=True)


@router.post("/applicants", response_model=ApplicantCreateResponse, status_code=201)
def create_applicant(
    payload: ApplicantCreateRequest, db: Session = Depends(get_db)
) -> ApplicantCreateResponse:
    """FR-01 六步驟流程的第一步：建立申請人資料。

    §5.5 契約只回傳 applicantId。完整身分證字號只在這次請求處理過程中
    存在於記憶體，遮蔽後立刻用掉，資料庫自始不存放完整號碼、也不記錄
    於任何 log（NFR-14）。
    """
    applicant = Applicant(
        name=payload.name,
        id_number_masked=mask_id_number(payload.id_number),
        phone=payload.phone,
        email=payload.email,
        address=payload.address,
        birth_date=payload.birth_date,
    )
    db.add(applicant)
    db.commit()
    db.refresh(applicant)

    return ApplicantCreateResponse(applicant_id=applicant.id)


def _slice_phase(frames, span):
    """依 phases 的 [起, 訖] 全片索引切出對應影格，起訖都算在內
    （對照 §5.1 範例：lighting=[600,692] 對應 693 格影片裡的第 600~692
    格，共 93 格，用 frames[600:693] 才會拿到 93 格）。"""
    start, end = span
    return frames[start : end + 1]


def _sample_for_synthetic(frames, count):
    """均勻抽樣並縮放成 224x224，供 Track 1 使用。

    **這不是真正的臉部對齊。** 真正的對齊（InsightFace 五點對齊裁切）
    是 A 的 common/face_utils.extract_face() 職責（PLAN.md 階段1「A 的
    任務」），目前還沒實作。這裡先用簡單縮放讓 detect_synthetic() 的
    輸入形狀符合 §4.1 契約（10 張 224×224×3），反正現在呼叫的是
    B 佔位版本、根本不看輸入內容；等 A 補上對齊函式、交付真正的模型後，
    這段要換成呼叫 extract_face()。
    """
    if not frames:
        return []
    indices = np.linspace(0, len(frames) - 1, count).astype(int).tolist()
    return [cv2.resize(frames[i], (config.FACE_SIZE, config.FACE_SIZE)) for i in indices]


@router.post("/id-card/rectify", response_model=IdCardRectifyResponse)
async def rectify_id_card_endpoint(image: UploadFile = File(...)) -> IdCardRectifyResponse:
    """§4.7／§5.5：證件四角偵測與透視矯正。無 applicantId，是無狀態的
    影像處理工具，不需要 session（跟 §4.8 的申請人流程無關）。

    rectify_id_card() 回傳的 rectified 是 np.ndarray，這裡編碼成 base64
    JPEG data URI 塞進 JSON 回應（見 common/schemas.py 對這個決定的
    說明），失敗時維持 None，不回傳任何影像資料（§4.7 明文禁止）。
    """
    data = await image.read()
    decoded = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if decoded is None:
        return IdCardRectifyResponse(
            success=False, rectified=None, corners=None, confidence=0.0,
            message="無法解析上傳的影像檔案，請確認檔案格式後重新上傳",
        )

    result = rectify_id_card(decoded)

    rectified_uri = None
    if result["success"]:
        ok, buf = cv2.imencode(".jpg", result["rectified"])
        if ok:
            rectified_uri = "data:image/jpeg;base64," + base64.b64encode(buf).decode("ascii")

    return IdCardRectifyResponse(
        success=result["success"],
        rectified=rectified_uri,
        corners=result["corners"],
        confidence=result["confidence"],
        message=result["message"],
    )


@router.post("/applicants/{applicant_id}/verify", response_model=VerificationRecord)
async def verify(
    applicant_id: int,
    video: UploadFile = File(...),
    light_log: str = Form(...),
    challenges: str = Form(...),
    source_type: str = Form("實體相機"),
    x_session_id: str = Header(..., alias="X-Session-Id"),
    db: Session = Depends(get_db),
):
    """§5.5 核心端點：接收錄影與挑戰資料，跑五層分析，寫入資料庫。

    2026-08-19 補上 15 分鐘倒數逾時檢查（409）——§4.8 的 session 追蹤，
    sms/verify 那組端點現在有了，見 verify_sms()／_require_session()。

    實作要點:
        - Track 1 目前呼叫 B 的佔位版本（CONVENTIONS §4.10），
          fakeProbability 永遠是 0.87，A 交付後不用改這裡一行
        - 品質不合格時回傳 422，不執行五層分析（不合格的畫面分析出來
          的數字不可信，見 image_utils/quality.py 頂部說明）
        - 各 analyzer 回傳的 dict 已經是 §5.1 要求的 camelCase 格式，
          直接嵌進 record_dict 讓 VerificationRecord.model_validate()
          一次驗證，不用逐欄手動轉 snake_case 再轉回去
    """
    applicant = db.get(Applicant, applicant_id)
    if applicant is None:
        raise HTTPException(status_code=404, detail="applicant not found")

    _require_session(applicant, x_session_id, check_deadline=True)

    try:
        light_log_model = LightLog.model_validate_json(light_log)
        challenges_payload = ChallengesPayload.model_validate_json(challenges)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"light_log/challenges 格式錯誤：{exc}")

    suffix = Path(video.filename or "video.mp4").suffix or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await video.read())
        tmp_path = tmp.name

    try:
        frames, fps = extract_frames(tmp_path)
    except (FileNotFoundError, ValueError) as exc:
        Path(tmp_path).unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc))

    quality = check_image_quality(frames)
    if not quality["passed"]:
        # 不合格影片不值得象徵性保存（見下方成功路徑的說明），這裡連同
        # 暫存檔一起丟掉。CONVENTIONS 沒有明文規定
        # 這裡的狀態碼，422（Unprocessable Entity）比照「請求格式正確、
        # 但語意上無法處理」的慣例用法，比硬塞一個假的 record 更誠實。
        Path(tmp_path).unlink(missing_ok=True)
        return JSONResponse(status_code=422, content={"quality": quality})

    phases = challenges_payload.recording.phases
    action_frames = _slice_phase(frames, phases.action)
    lighting_frames = _slice_phase(frames, phases.lighting)
    occlusion_frames = _slice_phase(frames, phases.occlusion)

    challenge_dicts = [c.model_dump(by_alias=True) for c in challenges_payload.challenges]
    light_log_dict = light_log_model.model_dump(by_alias=True)

    baseline_result = analyze_baseline(action_frames, fps, challenge_dicts)

    synthetic_raw = detect_synthetic(_sample_for_synthetic(frames, config.FRAME_COUNT))
    fake_probability = synthetic_raw["fakeProbability"]
    synthetic_result = {
        "fakeProbability": fake_probability,
        "threshold": config.SYNTHETIC_THRESHOLD,
        "verdict": "reject" if fake_probability >= config.SYNTHETIC_THRESHOLD else "pass",
        "topSignals": synthetic_raw["topSignals"],
    }

    rppg_result = analyze_rppg(frames, fps)
    photometric_result = analyze_photometric(lighting_frames, fps, light_log_dict)
    occlusion_result = analyze_occlusion(occlusion_frames, fps)

    decision = fuse_decision(
        baseline_result, synthetic_result, rppg_result, photometric_result, occlusion_result
    )

    # VLM 摘要僅於人工複核案件觸發（FR-37）。anomalyFrames 是相對
    # occlusion 區間的索引，換算回全片索引才能從 frames 取出對應影格
    # （CONVENTIONS §4.6 明確提醒的容易出錯之處）。
    vlm = None
    if decision["verdict"] == "review":
        anomaly_indices = [
            phases.occlusion[0] + i
            for i in occlusion_result["anomalyFrames"]
            if 0 <= phases.occlusion[0] + i < len(frames)
        ]
        anomaly_images = [frames[i] for i in anomaly_indices]
        vlm = summarize_verification({"decision": decision}, anomaly_images)

    account_result = _ACCOUNT_RESULT_BY_VERDICT[decision["verdict"]]
    now = datetime.now()
    duration_sec = len(frames) / fps if fps else 0.0
    phases_dict = {
        "action": list(phases.action),
        "lighting": list(phases.lighting),
        "occlusion": list(phases.occlusion),
    }

    row = VerificationRecordRow(
        applicant_id=applicant.id,
        timestamp=now,
        source_type=source_type,
        duration_sec=duration_sec,
        fps=fps,
        total_frames=len(frames),
        phases=phases_dict,
        quality_passed=quality["passed"],
        blur_score=quality["blurScore"],
        brightness=quality["brightness"],
        contrast=quality["contrast"],
        overexposed_ratio=quality["overexposedRatio"],
        face_ratio=quality["faceRatio"],
        quality_message=quality["message"],
        baseline_challenges=baseline_result["challenges"],
        baseline_verdict=baseline_result["verdict"],
        baseline_confidence_score=baseline_result["confidenceScore"],
        synthetic_fake_probability=synthetic_result["fakeProbability"],
        synthetic_threshold=synthetic_result["threshold"],
        synthetic_verdict=synthetic_result["verdict"],
        synthetic_top_signals=synthetic_result["topSignals"],
        rppg_detected=rppg_result["detected"],
        rppg_heart_rate=rppg_result["heartRate"],
        rppg_snr=rppg_result["snr"],
        rppg_roi_consistency=rppg_result["roiConsistency"],
        rppg_checks=rppg_result["checks"],
        rppg_waveform=rppg_result["waveform"],
        rppg_spectrum=rppg_result["spectrum"],
        rppg_confidence_score=rppg_result["confidenceScore"],
        photo_detected=photometric_result["detected"],
        photo_correlation=photometric_result["correlation"],
        photo_latency_ms=photometric_result["latencyMs"],
        photo_geometry_score=photometric_result["geometryScore"],
        photo_sequence=photometric_result["sequence"],
        photo_checks=photometric_result["checks"],
        photo_light_curve=photometric_result["lightCurve"],
        photo_reflect_curve=photometric_result["reflectCurve"],
        photo_confidence_score=photometric_result["confidenceScore"],
        occ_detected=occlusion_result["detected"],
        occ_wave_cycles=occlusion_result["waveCyclesDetected"],
        occ_identity_stability=occlusion_result["identityStability"],
        occ_max_identity_drop=occlusion_result["maxIdentityDrop"],
        occ_segments=occlusion_result["occlusionSegments"],
        occ_layer_score=occlusion_result["layerScore"],
        occ_anomaly_frames=occlusion_result["anomalyFrames"],
        occ_checks=occlusion_result["checks"],
        occ_stability_curve=occlusion_result["stabilityCurve"],
        occ_confidence_score=occlusion_result["confidenceScore"],
        risk_score=decision["riskScore"],
        verdict=decision["verdict"],
        verdict_label=decision["verdictLabel"],
        reasons=decision["reasons"],
        account_result=account_result,
        vlm_available=vlm["available"] if vlm else None,
        vlm_frame_observations=vlm["frameObservations"] if vlm else None,
        vlm_summary=vlm["summary"] if vlm else None,
        vlm_model=vlm["model"] if vlm else None,
        vlm_latency_ms=vlm["latencyMs"] if vlm else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # 象徵性保存驗證影片（見 PHASE1_NOTES §八）：只有真的寫進資料庫、
    # 走完五層分析的紀錄才保留原始影片，不合格或半途失敗的不留（見上面
    # 兩處 quality/extract_frames 失敗路徑的清理）。這不是合規等級的
    # 保存架構（沒有加密、沒有備援、沒有正式的保存期限管理），只是先
    # 證明「架構上支援保留原始影片」這個概念——真的要符合金管會規範，
    # 需要另外設計儲存位置與存取控管，超出本次專題範圍。
    video_dir = config.VERIFICATION_VIDEO_DIR / str(applicant_id)
    video_dir.mkdir(parents=True, exist_ok=True)
    stored_video_path = video_dir / f"{row.id}{suffix}"
    shutil.move(tmp_path, stored_video_path)
    row.video_path = str(stored_video_path.relative_to(config.BASE_DIR))
    db.commit()

    record_dict = {
        "id": f"VF-{now:%Y%m%d}-{row.id:04d}",
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
        "applicantName": applicant.name,
        "applicantIdMasked": applicant.id_number_masked,
        "sourceType": source_type,
        "recording": {
            "durationSec": duration_sec,
            "fps": fps,
            "totalFrames": len(frames),
            "phases": phases_dict,
        },
        "quality": quality,
        "baseline": baseline_result,
        "synthetic": synthetic_result,
        "rppg": rppg_result,
        "photometric": photometric_result,
        "occlusion": occlusion_result,
        "decision": decision,
        "vlmSummary": vlm,
        "accountResult": account_result,
    }
    return VerificationRecord.model_validate(record_dict)


@router.post("/applicants/{applicant_id}/account-setup", response_model=AccountSetupResponse)
def setup_account(
    applicant_id: int,
    payload: AccountSetupRequest,
    x_session_id: str = Header(..., alias="X-Session-Id"),
    db: Session = Depends(get_db),
) -> AccountSetupResponse:
    """§5.8 對應 PRD 步驟⑤。只能在最近一筆驗證紀錄的 accountResult 是
    pending_setup 時成功——防止還沒通過驗證、或已經開戶完成後被重複呼叫
    （見 §5.8 accountResult 狀態機）。

    transactionPassword「6 位數字」、termsAccepted 必須為 true 的檢查
    手動做、回傳明確的 400（§5.8 寫的是 400，不是 FastAPI 預設的 422）。
    """
    applicant = db.get(Applicant, applicant_id)
    if applicant is None:
        raise HTTPException(status_code=404, detail="applicant not found")

    _require_session(applicant, x_session_id, check_deadline=False)

    if not payload.terms_accepted:
        raise HTTPException(status_code=400, detail="必須同意條款才能開戶")
    if not (payload.transaction_password.isdigit() and len(payload.transaction_password) == 6):
        raise HTTPException(status_code=400, detail="交易密碼須為 6 位數字")

    latest = (
        db.query(VerificationRecordRow)
        .filter_by(applicant_id=applicant_id)
        .order_by(VerificationRecordRow.id.desc())
        .first()
    )
    # CONVENTIONS §5.8 沒有明文規定這裡的狀態碼，409（Conflict）比照
    # /verify 的 session 逾時用法（同一份文件裡的用法）：目前狀態不允許
    # 這個操作，不是請求格式本身有問題。
    if latest is None or latest.account_result != "pending_setup":
        raise HTTPException(status_code=409, detail="目前狀態無法設定帳戶")

    latest.account_result = "opened"
    db.commit()

    return AccountSetupResponse(success=True, account_result="opened")


# --------------------------------------------------------------------------
# §4.9／§5.5 後台認證與查詢
# --------------------------------------------------------------------------

_admin_bearer = HTTPBearer()


def _require_admin(
    credentials: HTTPAuthorizationCredentials = Depends(_admin_bearer),
    db: Session = Depends(get_db),
) -> AdminCredential:
    """驗證 Authorization: Bearer <token>，跟 §4.8 申請人的 X-Session-Id
    是不同機制——這裡認證的是行員帳號，不是申請人。"""
    admin = db.query(AdminCredential).filter_by(token=credentials.credentials).first()
    if (
        admin is None
        or admin.token_expires_at is None
        or datetime.now() > admin.token_expires_at
    ):
        raise HTTPException(status_code=401, detail="登入逾時或憑證無效，請重新登入")
    return admin


def _row_to_record_dict(row: VerificationRecordRow) -> dict:
    """把一筆 VerificationRecordRow（平面化 DB 欄位）還原成 §5.1 的巢狀
    record 結構，供 admin/records 用。JSONB 欄位（checks/topSignals/
    curve 等）寫入時就已經是 camelCase 形狀（直接來自各 analyzer 的
    回傳值，見 verify()），這裡不用再轉換。"""
    applicant = row.applicant
    phases = row.phases
    return {
        "id": f"VF-{row.timestamp:%Y%m%d}-{row.id:04d}",
        "timestamp": row.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
        "applicantName": applicant.name,
        "applicantIdMasked": applicant.id_number_masked,
        "sourceType": row.source_type,
        "recording": {
            "durationSec": float(row.duration_sec),
            "fps": float(row.fps),
            "totalFrames": row.total_frames,
            "phases": phases,
        },
        "quality": {
            "passed": row.quality_passed,
            "blurScore": float(row.blur_score) if row.blur_score is not None else None,
            "brightness": float(row.brightness) if row.brightness is not None else None,
            "contrast": float(row.contrast) if row.contrast is not None else None,
            "overexposedRatio": (
                float(row.overexposed_ratio) if row.overexposed_ratio is not None else None
            ),
            "faceRatio": float(row.face_ratio) if row.face_ratio is not None else None,
            "message": row.quality_message or "",
        },
        "baseline": {
            "standard": "ISO/IEC 30107-3 動作挑戰",
            "challenges": row.baseline_challenges,
            "verdict": row.baseline_verdict,
            "verdictLabel": "通過" if row.baseline_verdict == "pass" else "拒絕",
            "confidenceScore": float(row.baseline_confidence_score),
        },
        "synthetic": {
            "fakeProbability": float(row.synthetic_fake_probability),
            "threshold": float(row.synthetic_threshold),
            "verdict": row.synthetic_verdict,
            "topSignals": row.synthetic_top_signals,
        },
        "rppg": {
            "detected": row.rppg_detected,
            "heartRate": float(row.rppg_heart_rate) if row.rppg_heart_rate is not None else None,
            "snr": float(row.rppg_snr),
            "roiConsistency": float(row.rppg_roi_consistency),
            "checks": row.rppg_checks,
            "waveform": row.rppg_waveform,
            "spectrum": row.rppg_spectrum,
            "confidenceScore": float(row.rppg_confidence_score),
        },
        "photometric": {
            "detected": row.photo_detected,
            "correlation": float(row.photo_correlation),
            "latencyMs": float(row.photo_latency_ms) if row.photo_latency_ms is not None else None,
            "geometryScore": float(row.photo_geometry_score),
            "sequence": row.photo_sequence,
            "checks": row.photo_checks,
            "lightCurve": row.photo_light_curve,
            "reflectCurve": row.photo_reflect_curve,
            "confidenceScore": float(row.photo_confidence_score),
        },
        "occlusion": {
            "detected": row.occ_detected,
            "waveCyclesDetected": row.occ_wave_cycles,
            "identityStability": float(row.occ_identity_stability),
            "maxIdentityDrop": float(row.occ_max_identity_drop),
            "occlusionSegments": row.occ_segments,
            "layerScore": float(row.occ_layer_score),
            "anomalyFrames": row.occ_anomaly_frames,
            "checks": row.occ_checks,
            "stabilityCurve": row.occ_stability_curve,
            "confidenceScore": float(row.occ_confidence_score),
        },
        "decision": {
            "riskScore": row.risk_score,
            "verdict": row.verdict,
            "verdictLabel": row.verdict_label,
            "reasons": row.reasons,
        },
        "vlmSummary": (
            {
                "available": row.vlm_available,
                "frameObservations": row.vlm_frame_observations or [],
                "summary": row.vlm_summary or "",
                "model": row.vlm_model or "",
                "latencyMs": float(row.vlm_latency_ms) if row.vlm_latency_ms is not None else 0.0,
            }
            if row.vlm_available is not None
            else None
        ),
        "accountResult": row.account_result,
    }


@router.post("/admin/login", response_model=AdminLoginResponse)
def admin_login(payload: AdminLoginRequest, db: Session = Depends(get_db)) -> AdminLoginResponse:
    """§4.9／§5.5：帳密以 bcrypt 比對，帳號需先用 scripts/init_admin.py
    （§8.1）建立，這裡不提供任何自助建帳號的方式。"""
    result = verify_admin_login(payload.username, payload.password, db)
    return AdminLoginResponse(**result)


@router.get("/admin/records", response_model=AdminRecordsResponse)
def list_admin_records(
    limit: int = Query(50, ge=1, le=200),
    verdict: str | None = Query(None),
    admin: AdminCredential = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> AdminRecordsResponse:
    query = db.query(VerificationRecordRow)
    if verdict is not None:
        query = query.filter_by(verdict=verdict)
    rows = query.order_by(VerificationRecordRow.id.desc()).limit(limit).all()
    return AdminRecordsResponse(
        records=[VerificationRecord.model_validate(_row_to_record_dict(row)) for row in rows]
    )


@router.get("/admin/records/{record_id}", response_model=VerificationRecord)
def get_admin_record(
    record_id: int,
    admin: AdminCredential = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> VerificationRecord:
    row = db.get(VerificationRecordRow, record_id)
    if row is None:
        raise HTTPException(status_code=404, detail="record not found")
    return VerificationRecord.model_validate(_row_to_record_dict(row))
