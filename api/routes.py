"""FastAPI｜路由。

契約見 CONVENTIONS.md §5.5 API 契約。2026-08-19 補上 §4.8 的簡訊驗證＋
Session 機制（sms/send、sms/verify、account-setup、reset）——這四個
互相依賴（session_id 是 sms/verify 產生的，其餘三個都要驗證它），
沒辦法只做其中一個。admin/login、admin/records 是另一套給行員用的
機制（§4.9，帳號密碼＋bcrypt），跟這裡的申請人 session 無關，還沒做。
"""

import asyncio
import base64
import random
import secrets
import shutil
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

import config
from api.auth import verify_admin_login
from api.database import SessionLocal, get_db
from api.models import AdminCredential, Applicant, VerificationRecordRow
from baseline_challenge.analyzer import analyze_baseline
from common.face_utils import extract_frames
from common.fusion import failed_layers, fuse_decision
from notifications import send_review_action_email, send_verdict_email
from common.schemas import (
    AccountSetupRequest,
    AccountSetupResponse,
    AdminLoginRequest,
    AdminLoginResponse,
    AdminRecordActionRequest,
    AdminRecordActionResponse,
    AdminRecordsResponse,
    ApplicantCreateRequest,
    ApplicantCreateResponse,
    ChallengeOrderResponse,
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
from track2_rppg.analyzer import disabled_result as rppg_disabled_result
from track3_photometric.analyzer import analyze_photometric
from track4_occlusion.analyzer import analyze_occlusion
from vlm_summary.summarizer import summarize_verification

router = APIRouter(prefix="/api")

_ACCOUNT_RESULT_BY_VERDICT = {
    "pass": "pending_setup",
    # 2026-08-23：原本 review 對應 "pending"，setup_account() 只認
    # "pending_setup"，導致人工複核案件連交易密碼都設不了、卡在帳戶
    # 設定這步。跟夥伴確認過，review 不是拒絕，應該讓使用者先把帳戶
    # 設定走完（複核通過就不用再回來重填一次資料），改成跟 pass 一樣
    # 導向 "pending_setup"。verdict 欄位本身還是分開存在
    # VerificationRecordRow 上，後台要分辨「哪些已開戶帳號其實是
    # review 案件、還需要人工確認」，看 verdict 就好，不會遺失資訊。
    "review": "pending_setup",
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
    # 新 session 開始，上一輪（如果有）指派的挑戰順序作廢，下次呼叫
    # get_challenge_order() 會重新洗牌一組——順序跟 session 綁在一起，
    # 不能讓舊 session 洗好的順序沿用到新的一輪。
    applicant.challenge_order = None
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
    applicant.challenge_order = None
    db.commit()

    return ResetResponse(reset=True)


@router.get("/applicants/{applicant_id}/challenge-order", response_model=ChallengeOrderResponse)
def get_challenge_order(
    applicant_id: int,
    x_session_id: str = Header(..., alias="X-Session-Id"),
    db: Session = Depends(get_db),
) -> ChallengeOrderResponse:
    """§5.3 對照組動作挑戰：伺服器產生隨機出現順序，防止攻擊者預先錄好
    一支照固定順序演的假影片（見 PHASE1_NOTES §九）。

    同一個 session 只洗牌一次——重複呼叫（例如使用者重新整理頁面）回傳
    同一組順序，不是每次都重新隨機，否則使用者可能已經照第一組順序
    錄了一半，第二次呼叫又換一組會對不起來。要拿到新的一組，必須先
    呼叫 /reset 或重新走一次 sms/verify（兩者都會清空 challenge_order，
    見上面 reset_session()／verify_sms()）。

    要求 X-Session-Id 且檢查逾時（跟 /verify 一樣）：這組順序是給步驟④
    用的，屬於 §5.6 流程圖 15 分鐘倒數涵蓋的範圍內。
    """
    applicant = db.get(Applicant, applicant_id)
    if applicant is None:
        raise HTTPException(status_code=404, detail="applicant not found")

    _require_session(applicant, x_session_id, check_deadline=True)

    if applicant.challenge_order is None:
        # 2026-08-25：真人測試發現 Track 3（照明響應）相關係數常常量不到
        # ——追問使用者後確認：如果隨機順序剛好把 turn_left/turn_right
        # 排在最後一個動作挑戰，語音一結束照明序列就立刻開始播放，使用者
        # 根本來不及把臉轉回正面，量到的是側臉反光，跟演算法預期「正面
        # 迎向螢幕」的反光模式完全不同。原本想加一段緩衝時間讓使用者轉回
        # 來，但這樣會拉長影片、拖慢後續分析（見使用者的考量）。改成在
        # 洗牌時限制：最後一個動作永遠是 blink 或 wave_hand 其中之一
        # （兩者都不會讓頭轉離鏡頭，眨眼甚至幾乎不影響臉部朝向），其餘
        # 三個動作（含另一個沒被選中的安全動作）維持完全隨機排列——不
        # 影響 §5.3 隨機順序防重放的安全設計，只是限制了「最後一個動作」
        # 這一個位置的候選集合，其他位置跟出現機率都還是隨機的。
        #
        # 2026-08-27 到 2026-08-29：曾暫時固定成「眨眼、左轉頭、右轉頭、
        # 揮手」方便測試比對，測試告一段落，改回原本的隨機邏輯，
        # 恢復 §5.3 的隨機順序防重放設計。
        safe_last_actions = ["blink", "wave_hand"]
        last_action = random.choice(safe_last_actions)
        remaining = [a for a in config.BASELINE_ACTION_DURATIONS if a != last_action]
        random.shuffle(remaining)
        order = remaining + [last_action]
        applicant.challenge_order = order
        db.commit()

    return ChallengeOrderResponse(
        challenges=[
            {"action": action, "durationSec": config.BASELINE_ACTION_DURATIONS[action]}
            for action in applicant.challenge_order
        ]
    )


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


def _ms_range_to_frame_range(ms_span, fps):
    """把 [起, 訖) 毫秒區間（相對錄影開始）換算成 `_slice_phase()`
    期待的 [起, 訖] 影格索引（訖含在內）。

    2026-08-27：前端原本自己用假設的固定 30fps 換算好才送影格索引過來
    （見 `common/schemas.py` `RecordingPhases` 的說明）——裝置實際錄影
    fps 常常達不到 30，兩邊 fps 對不上時換算出來的影格範圍會超出影片
    實際長度。改成前端只送毫秒，這裡用 `extract_frames()` 解碼後量到
    的真實 fps 換算，公式跟前端原本 `verificationRecording.ts` 的
    `msRangeToFrameRange()` 完全對應，只是 fps 換成真的。
    """
    start_ms, end_ms = ms_span
    start = round(start_ms / 1000 * fps)
    end = max(start, round(end_ms / 1000 * fps) - 1)
    return (start, end)


def _frames_excluding_many(frames, spans):
    """回傳排除掉多個 [起, 訖]（影格索引，訖含在內）範圍後的影格，
    spans 之間可以不連續、不用事先排序、也可以重疊。

    2026-08-25：真人測試發現 rPPG 真人分數持續偏高（心率算出 156 bpm
    這種不合理數字、SNR 是負的、roiConsistency 卡在 0）——追查
    analyze_rppg() 目前吃的是整支影片（見下面 _run_verify_analysis()
    的呼叫），包含使用者「揮手」跟「轉頭」這些動作挑戰。手在臉前面
    揮動、頭部左右轉動時左右臉頰不對稱地變化角度/受光，都是遠比心跳
    血流變化（<1% 像素差異）大得多的訊號污染源，足以蓋過真正的脈搏
    訊號，額頭跟兩頰算出的心率自然對不上。一開始只排除揮手（污染最
    明顯），後來真人測試證實光排除揮手還不夠，roiConsistency 還是常常
    卡在 0——轉頭的影響雖然理論上比較輕微，但沒有排除的話還是持續在
    污染訊號。改成排除揮手＋左轉＋右轉全部三個動作，只留眨眼＋照明
    響應階段的影格給 rPPG 用。代價：可用畫面時長從原本的 20+ 秒
    掉到只剩 5~6 秒，頻譜解析度會變差，預期會更常直接判定「訊號不
    足」而不是「不一致」——這是跟使用者討論過、確認可以接受的取捨
    （比起「訊號污染出一個看似有效但其實是雜訊的心率」，寧可老實承認
    量不到）。
    """
    exclude = set()
    for start, end in spans:
        exclude.update(range(start, end + 1))
    return [f for i, f in enumerate(frames) if i not in exclude]


def _action_time_boundaries(challenge_dicts, fps):
    """依伺服器指派的挑戰順序＋各動作宣告時長，重建每個動作在整支
    影片裡的 [起始影格, 結束影格] 邊界（累加時長換算成影格索引），
    跟前端 handleStartVerification() 算 boundaries 用的是同一套邏輯
    （見 FaceVerificationEngine.tsx），這裡在後端重算一次是因為
    §5.1 的 phases 契約只有 action/lighting/occlusion 三段、沒有
    每個動作各自的邊界，不想為了這個新需求改動既有 payload 契約。
    """
    boundaries = {}
    cursor_s = 0.0
    for item in challenge_dicts:
        start_s = cursor_s
        cursor_s += item["durationSec"]
        start_frame = int(round(start_s * fps))
        end_frame = int(round(cursor_s * fps)) - 1
        boundaries[item["action"]] = (start_frame, max(start_frame, end_frame))
    return boundaries


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


def _collect_review_frames(failed, *, frames, fps, phases, occlusion_result):
    """依實際沒通過的層，各自挑代表性影格給 VLM 看（FR-37 人工複核摘要）。

    只有 Track4（occlusion）的 analyzer 有逐格定位的異常索引；Track1
    （synthetic）跟 Track3（photometric）沒有這種細粒度輸出，各自的
    代表畫面改用「這層實際分析過的範圍」抓一兩張：
        - synthetic：跟 detect_synthetic() 收到的同一組抽樣索引
          （見上面 _sample_for_synthetic()），取頭尾兩張，不用整組 10 張
          （VLM 只需要看出「有沒有明顯合成痕跡」，不必逐張看）
        - photometric：照明測試階段（phases.lighting）取中間那格

    baseline（對照組動作挑戰）沒有對應影格——它判定的是「有沒有在時限內
    完成指定動作」，不是某一格畫面看起來有沒有異常，沒有值得指給複核
    人員看的單一畫面，故意不產生任何影格。

    2026-08-29 新增：原本這裡只處理 occlusion，等於「造成 review 的
    如果是 Track1/3，VLM 完全看不到任何畫面、摘要永遠是空的」，跟
    review 案件的實際原因對不上。

    每張影格都標 "source"（見 vlm_summary.summarizer.PROMPTS）——不然
    VLM 只拿到一張圖跟一句通用提示詞「找找看哪裡奇怪」，不知道系統
    原本在懷疑什麼，寫出來的描述會跟這格被標記的實際理由脫鉤（例如
    Track4 懷疑的是「身分特徵不連續」，通用提示詞卻只會泛泛地找「畫面
    奇不奇怪」，兩者常常對不上）。
    """
    collected = []

    if "occlusion" in failed:
        collected += [
            {
                "image": frames[phases.occlusion[0] + i],
                "timestampSec": (phases.occlusion[0] + i) / fps,
                "source": "occlusion",
            }
            for i in occlusion_result["anomalyFrames"]
            if 0 <= phases.occlusion[0] + i < len(frames)
        ]

    if "synthetic" in failed and frames:
        sampled_indices = np.linspace(0, len(frames) - 1, config.FRAME_COUNT).astype(int).tolist()
        for idx in sorted({sampled_indices[0], sampled_indices[-1]}):
            collected.append({"image": frames[idx], "timestampSec": idx / fps, "source": "synthetic"})

    if "photometric" in failed:
        mid = (phases.lighting[0] + phases.lighting[1]) // 2
        if 0 <= mid < len(frames):
            collected.append(
                {"image": frames[mid], "timestampSec": mid / fps, "source": "photometric"}
            )

    return collected


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

    # 2026-08-25：暫時的診斷用途——真人測試回報「鏡頭拍攝失敗、上傳檔案
    # 卻成功」，懷疑鏡頭擷取出來的畫面本身有問題（不是後端演算法的
    # 問題，因為同一顆演算法上傳真的照片能過）。失敗時把收到的原始
    # 畫面存下來，才能直接用肉眼比對到底鏡頭擷取出了什麼問題，之後
    # 確認原因後這段要拿掉。
    if not result["success"]:
        debug_dir = config.BASE_DIR / "data" / "_debug_id_card_failures"
        debug_dir.mkdir(parents=True, exist_ok=True)
        debug_path = debug_dir / f"{datetime.now():%Y%m%d_%H%M%S_%f}.jpg"
        cv2.imwrite(str(debug_path), decoded)
        print(f"[身分證失敗畫面已存檔] {debug_path}", flush=True)
    else:
        # 2026-08-27：!!! 暫時性 !!! 真人測試回報「四角有抓到，但矯正
        # 出來的畫面還是歪的」——上面那段只存「找不到四邊形」的失敗
        # 案例，這種「有找到、但結果不對」的狀況完全沒有留底可以比對。
        # 同時存原圖跟矯正後的結果，才能直接看出是角點抓錯位置，還是
        # 角點排序又出問題。確認原因後這段要拿掉。
        debug_dir = config.BASE_DIR / "data" / "_debug_id_card_skewed"
        debug_dir.mkdir(parents=True, exist_ok=True)
        stamp = f"{datetime.now():%Y%m%d_%H%M%S_%f}"
        cv2.imwrite(str(debug_dir / f"{stamp}_orig.jpg"), decoded)
        cv2.imwrite(str(debug_dir / f"{stamp}_rectified.jpg"), result["rectified"])
        print(
            f"[身分證成功畫面已存檔] {stamp}，corners={result['corners']}，"
            f"confidence={result['confidence']:.3f}",
            flush=True,
        )

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


@router.post("/applicants/{applicant_id}/verify")
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

    # §5.3／PHASE1_NOTES §九：上傳聲稱的動作順序，必須跟 get_challenge_
    # order() 當初派給這個 session 的順序完全一致，否則「隨機順序」的
    # 防護就形同虛設——攻擊者只要把預錄影片的中繼資料改成任意順序上傳，
    # 影片本身沒真的照那個順序演也無所謂。沒有指派過順序（沒呼叫過
    # get_challenge_order()）一律視為不合法，不允許略過這關直接驗證。
    uploaded_order = [c.action for c in challenges_payload.challenges]
    if applicant.challenge_order is None or uploaded_order != applicant.challenge_order:
        raise HTTPException(
            status_code=422,
            detail="挑戰順序與系統指派的不符，請重新呼叫 challenge-order 並依指定順序錄製",
        )

    suffix = Path(video.filename or "video.mp4").suffix or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        video_bytes = await video.read()
        tmp.write(video_bytes)
        tmp_path = tmp.name

    try:
        frames, fps = extract_frames(tmp_path)
    except (FileNotFoundError, ValueError) as exc:
        # 2026-08-24：暫時的診斷 log——「無法開啟影片檔」這個錯誤，可能是
        # 上傳過程沒收完整（檔案很小/空的），也可能是檔案大小正常但格式
        # 真的解不開，兩者原因完全不同。先印出實際收到的位元組數、
        # content-type、檔名，下次真人測試失敗時才不用用猜的。
        print(
            f"[影片解碼失敗診斷] filename={video.filename!r} "
            f"content_type={video.content_type!r} "
            f"收到位元組數={len(video_bytes)} 錯誤={exc}",
            flush=True,
        )
        Path(tmp_path).unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc))

    quality = check_image_quality(frames)
    if not quality["passed"]:
        # 2026-08-30：暫時診斷——不合格的暫存檔案下面會被刪掉，事後查不到
        # 當下實際量到的數值，也沒辦法回頭看畫面本身長什麼樣子（例如
        # S23 Ultra 前鏡頭清晰度過不了關，硬體規格不該這麼差，需要實際
        # 打開影格看才知道是壓縮問題還是別的）。除了印數值，額外把這支
        # 失敗的影片複製一份到 debug 資料夾（不影響原本刪除暫存檔的行為），
        # 問題排查完這整段連同資料夾要一起拿掉，不是正式功能。
        debug_dir = config.BASE_DIR / "data" / "debug_quality_fails"
        debug_dir.mkdir(parents=True, exist_ok=True)
        debug_path = debug_dir / f"{applicant_id}_{datetime.now():%H%M%S}{suffix}"
        shutil.copy(tmp_path, debug_path)
        h, w = frames[0].shape[:2] if frames else (0, 0)
        print(
            f"[品質檢查未通過診斷] applicant={applicant_id} "
            f"影格解析度={w}x{h} 影格數={len(frames)} "
            f"存檔={debug_path} {quality}",
            flush=True,
        )
        # 不合格影片不值得象徵性保存（見下方成功路徑的說明），這裡連同
        # 暫存檔一起丟掉。CONVENTIONS 沒有明文規定
        # 這裡的狀態碼，422（Unprocessable Entity）比照「請求格式正確、
        # 但語意上無法處理」的慣例用法，比硬塞一個假的 record 更誠實。
        Path(tmp_path).unlink(missing_ok=True)
        return JSONResponse(status_code=422, content={"quality": quality})

    # 2026-08-25：五層分析＋融合決策＋寫入資料庫，CPU 上實測要數十秒到
    # 數分鐘。原本這裡是直接同步跑完才回應，這支請求會佔住整個後端
    # process 那麼久（見 PHASE1_NOTES §10.1／§11）。手機透過 Cloudflare
    # Tunnel 展示時，通道本身的逾時撐不了這麼久，會在後端還在正常運算
    # 時就把連線斷開、前端顯示「無法連線」。改成：這裡的驗證跟畫質檢查
    # （比較快）維持同步，重運算的部分丟進背景執行緒（run_in_threadpool），
    # 立刻回應「已受理、處理中」，前端改成輪詢
    # GET .../verify-result 直到跑完。桌面版跟手機版共用同一支
    # FaceVerificationEngine.tsx，這裡改一次兩邊都套用，不特別分開處理。
    # 2026-08-27：phases 現在是前端送的毫秒區間，這裡用解碼後量到的
    # 真實 fps（上面 extract_frames() 回傳的那個，不是前端假設的固定
    # 值）換算成影格索引，見 _ms_range_to_frame_range() 的說明。換算
    # 完之後，下面 _slice_phase()／DB 存檔／VLM 異常影格對應等邏輯
    # 完全不用改，一樣吃影格索引。
    phases_ms = challenges_payload.recording.phases
    phases = SimpleNamespace(
        action=_ms_range_to_frame_range(phases_ms.action, fps),
        lighting=_ms_range_to_frame_range(phases_ms.lighting, fps),
        occlusion=_ms_range_to_frame_range(phases_ms.occlusion, fps),
    )
    challenge_dicts = [c.model_dump(by_alias=True) for c in challenges_payload.challenges]
    light_log_dict = light_log_model.model_dump(by_alias=True)

    _verify_pending.add(applicant_id)

    async def _process_in_background():
        # 2026-08-25：真人測試踩到的問題——改成背景執行緒後，多個
        # /verify 請求（例如同一個人重試好幾次、或不同申請人前後腳送出）
        # 可以同時開始背景分析。但 baseline/synthetic/rppg/photometric/
        # occlusion 這幾層分析（尤其 InsightFace）目前每次呼叫都重新從
        # 硬碟載入完整模型，沒有做快取（PHASE1_NOTES §10.1 記錄過的
        # 架構債，一直沒動）。同步版本因為整支請求互斥，天然不會有這個
        # 問題；改成非同步後，多個分析真的同時搶 CPU／記憶體去重複載入
        # 同一組模型，實測會互相拖慢到兩個都跑不完、輪詢永遠停在
        # 「處理中」。用一個全域的 semaphore 把「真正執行分析」這段限制
        # 成一次只能有一個在跑——HTTP 回應本身還是立刻 202（Cloudflare
        # Tunnel 逾時的問題不會回來），只是背景分析變成排隊處理，不是
        # 真的平行跑好幾份。徹底解法是幫模型做快取／常駐，但那是更大的
        #改動，這裡先用 semaphore 擋住立即會發生的資源競爭問題。
        async with _verify_analysis_semaphore:
            try:
                await run_in_threadpool(
                    _run_verify_analysis,
                    applicant_id,
                    tmp_path,
                    suffix,
                    source_type,
                    frames,
                    fps,
                    phases,
                    challenge_dicts,
                    light_log_dict,
                    quality,
                )
            except Exception as exc:  # noqa: BLE001 - 背景工作，異常只能自己記，不會有人 await 這裡的例外
                print(f"[背景驗證分析失敗] applicant_id={applicant_id} 錯誤={exc}", flush=True)
            finally:
                _verify_pending.discard(applicant_id)

    # asyncio.create_task() 回傳的 Task 物件如果沒有任何地方留著參照，
    # Python 有可能在它跑完之前就把它回收掉（官方文件明講的 GC 陷阱：
    # 「Save a reference to the result of this function」）——實測踩到
    # 這個坑：背景分析完全沒有機會執行，_verify_pending 卻已經被
    # discard，輪詢端點直接回 404「尚未有任何驗證紀錄」。用一個
    # 模組層級的 set 撐住參照，跑完後在 done callback 裡自己移除。
    task = asyncio.create_task(_process_in_background())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return JSONResponse(status_code=202, content={"status": "processing", "applicantId": applicant_id})


# 2026-08-25：追蹤「這個申請人現在是不是還有一筆驗證分析在背景跑」。
# 用記憶體裡的 set 就好，不用另外加資料庫欄位——伺服器重啟本來就會
# 中斷所有處理中的分析，跟資料庫是否記得這件事無關；下面的輪詢端點
# 靠這個 set 判斷要回「還在處理」還是去查資料庫拿結果。
_verify_pending: set[int] = set()

# 見上面 verify() 裡的說明：只是用來擋住 asyncio.create_task() 的
# Task 物件不被提前 GC 掉，不承載任何業務邏輯。
_background_tasks: set[asyncio.Task] = set()

# 見上面 _process_in_background() 的說明：限制「真正執行五層分析」這段
# 一次只能有一個在跑，避免多個背景分析同時重複載入 InsightFace 模型、
# 互搶資源導致全部卡住跑不完。
_verify_analysis_semaphore = asyncio.Semaphore(1)


def _run_verify_analysis(
    applicant_id, tmp_path, suffix, source_type, frames, fps, phases, challenge_dicts,
    light_log_dict, quality,
):
    """在背景執行緒跑五層分析＋融合決策＋寫入資料庫，見上面 verify() 的說明。

    在獨立執行緒裡執行，不能沿用 request-scoped 的 db session（那個
    session 的生命週期跟這次 HTTP 請求綁在一起，請求結束就可能被關掉），
    這裡自己開一個新的 SessionLocal()。
    """
    action_frames = _slice_phase(frames, phases.action)
    lighting_frames = _slice_phase(frames, phases.lighting)
    occlusion_frames = _slice_phase(frames, phases.occlusion)

    baseline_result = analyze_baseline(action_frames, fps, challenge_dicts)

    synthetic_raw = detect_synthetic(_sample_for_synthetic(frames, config.FRAME_COUNT))
    fake_probability = synthetic_raw["fakeProbability"]
    synthetic_result = {
        "fakeProbability": fake_probability,
        "threshold": config.SYNTHETIC_THRESHOLD,
        "verdict": "reject" if fake_probability >= config.SYNTHETIC_THRESHOLD else "pass",
        "topSignals": synthetic_raw["topSignals"],
    }

    # 2026-08-29：Track2 rPPG 已停用，不再實際分析、不參與風險融合，
    # 見 track2_rppg/analyzer.py::disabled_result() 的說明。原本這裡
    # 用 _action_time_boundaries()／_frames_excluding_many() 算出排除
    # 動作區間的 rppg_frames 只給 rPPG 用，現在沒有呼叫對象了，故不再
    # 計算；這兩個 helper 函式本身保留在下方，未來若重新啟用可以直接
    # 復用。
    rppg_result = rppg_disabled_result()
    photometric_result = analyze_photometric(
        lighting_frames, fps, light_log_dict, buffer_ms=config.PHOTO_LIGHTING_BUFFER_MS
    )
    occlusion_result = analyze_occlusion(occlusion_frames, fps)

    decision = fuse_decision(
        baseline_result, synthetic_result, photometric_result, occlusion_result
    )

    # VLM 摘要原本僅於人工複核案件觸發（FR-37）。造成 review 的不一定是
    # Track4——2026-08-29 以前這裡寫死只送 occlusion 的異常影格，但
    # Track1（合成偵測）、Track3（照明響應）沒過一樣會把案件推進
    # review，那種情況下只給 VLM 看 occlusion 的畫面是文不對題。改成
    # 依 fuse_decision 實際判定沒過的層，各自挑代表性畫面。
    # 2026-08-30：拒絕案件雖然是系統自動判定、不會有行員在後台複核，
    # 但正因為是終局結果，之後申訴／稽核追溯時反而最需要一段白話說明
    # 「當初為什麼被拒」——這種情境下空白摘要比 review 案件更缺資訊，
    # 所以拒絕案件現在也一併觸發。通過案件沒有異常訊號可講，維持不跑。
    vlm = None
    if decision["verdict"] in ("review", "reject"):
        failed = failed_layers(baseline_result, synthetic_result, photometric_result, occlusion_result)
        anomaly_frames = _collect_review_frames(
            failed, frames=frames, fps=fps, phases=phases, occlusion_result=occlusion_result,
        )
        # 2026-08-30 新增：原本 VLM 只看被標記的畫面本身，沒有拿到任何
        # 一層算出來的實際數字（例如 Track3 相關係數 0.27、門檻 0.35 差
        # 多少），寫出來的摘要只能描述畫面好不好看，沒辦法解釋「為什麼」
        # 系統判定可疑——這裡把各層的關鍵數字（只挑沒過的層,通過的層
        # 不需要拿去讓 VLM 費工夫解釋）一起交給它,讓摘要能真的整合
        # 各層證據,不是只有視覺描述。見 vlm_summary/summarizer.py
        # synthesize_case_summary() 的說明。
        layer_metrics = {}
        if "baseline" in failed:
            # 2026-08-31：原本這裡寫死「對照組動作挑戰未在時限內完成」，
            # 不管實際是哪一項動作、為什麼沒過都套同一句話——但「沒偵測
            # 到」不等於「沒在時限內做」，真人測試證實過（507/513/514）
            # 揮手動作其實有在時限內做、時間點也對，只是畫面模糊讓系統
            # 偵測不到，跟「使用者太慢」是完全不同的原因，寫死的說法會
            # 誤導複核人員去懷疑使用者操作，而不是去懷疑偵測本身。改成
            # 列出實際沒過的動作名稱，不臆測原因。
            failed_challenge_names = [
                c["name"] for c in baseline_result["challenges"] if not c["passed"]
            ]
            layer_metrics["baseline"] = {
                "confidenceScore": baseline_result["confidenceScore"],
                "note": f"未偵測到有效動作：{'、'.join(failed_challenge_names)}",
            }
        if "synthetic" in failed:
            layer_metrics["synthetic"] = {
                "fakeProbability": synthetic_result["fakeProbability"],
                "threshold": config.SYNTHETIC_THRESHOLD,
            }
        if "photometric" in failed:
            layer_metrics["photometric"] = {
                "correlation": photometric_result["correlation"],
                "threshold": config.PHOTO_CORRELATION_MIN,
            }
        if "occlusion" in failed:
            # 2026-08-31：原本這裡不分青紅皂白地把 identityStability／
            # maxIdentityDrop 兩個數字都塞給 VLM——但 occlusion 的
            # detected 是三項判定（揮手循環數／身分連續性／遮擋區域
            # 顏色）全部要過才算數，只要「揮手循環不足 2 次」這一項沒過，
            # occlusion 整層就會被列進 failed，即使身分穩定度／最大掉幅
            # 兩個數字其實都在門檻內（真人測試撞到過：VLM 因此瞎掰出
            # 「身分穩定度和最大單次掉幅都超過門檻」，但那兩個數字根本
            # 沒過門檻，是揮手循環數不夠）。改成只回報三項判定裡「真的
            # 沒過」的那幾項，讓 VLM 不會拿通過的數字亂編故事。
            occ_checks = occlusion_result["checks"]
            occ_metrics: dict = {}
            if not occ_checks[0]["passed"]:
                occ_metrics["waveCyclesDetected"] = occlusion_result["waveCyclesDetected"]
                occ_metrics["waveCyclesRequired"] = 2
            if not occ_checks[1]["passed"]:
                occ_metrics["identityStability"] = occlusion_result["identityStability"]
                occ_metrics["identityStabilityThreshold"] = config.OCC_IDENTITY_STABILITY_MIN
                occ_metrics["maxIdentityDrop"] = occlusion_result["maxIdentityDrop"]
                occ_metrics["maxIdentityDropThreshold"] = config.OCC_MAX_DROP_THRESHOLD
            if not occ_checks[2]["passed"]:
                occ_metrics["layerScore"] = occlusion_result["layerScore"]
                occ_metrics["layerScoreThreshold"] = config.OCC_LAYER_SCORE_MIN
            layer_metrics["occlusion"] = occ_metrics
        vlm = summarize_verification(
            {"decision": decision, "layerMetrics": layer_metrics}, anomaly_frames
        )

    account_result = _ACCOUNT_RESULT_BY_VERDICT[decision["verdict"]]
    now = datetime.now()
    duration_sec = len(frames) / fps if fps else 0.0
    phases_dict = {
        "action": list(phases.action),
        "lighting": list(phases.lighting),
        "occlusion": list(phases.occlusion),
    }

    db = SessionLocal()
    applicant = db.get(Applicant, applicant_id)
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
    try:
        db.add(row)
        db.commit()
        db.refresh(row)

        # 象徵性保存驗證影片（見 PHASE1_NOTES §八）：只有真的寫進資料庫、
        # 走完五層分析的紀錄才保留原始影片，不合格或半途失敗的不留（見
        # 上面兩處 quality/extract_frames 失敗路徑的清理）。這不是合規
        # 等級的保存架構（沒有加密、沒有備援、沒有正式的保存期限管理），
        # 只是先證明「架構上支援保留原始影片」這個概念——真的要符合
        # 金管會規範，需要另外設計儲存位置與存取控管，超出本次專題範圍。
        video_dir = config.VERIFICATION_VIDEO_DIR / str(applicant_id)
        video_dir.mkdir(parents=True, exist_ok=True)
        stored_video_path = video_dir / f"{row.id}{suffix}"
        shutil.move(tmp_path, stored_video_path)
        row.video_path = str(stored_video_path.relative_to(config.BASE_DIR))
        db.commit()

        # 通過／拒絕是當下就確定的自動判定，立刻寄信通知。人工複核的
        # 通知要等審核人員在後台看完才觸發，屬於後台審核流程，不在這裡
        # 處理（見 notifications.py 開頭說明）。寄信失敗不影響驗證結果
        # 已經寫入資料庫這件事，send_verdict_email() 內部已經吞掉例外。
        send_verdict_email(applicant.email, applicant.name, decision["verdict"], record_id=row.id)
    finally:
        db.close()


@router.get("/applicants/{applicant_id}/verify-result")
def get_verify_result(
    applicant_id: int,
    x_session_id: str = Header(..., alias="X-Session-Id"),
    db: Session = Depends(get_db),
):
    """2026-08-25 新增：搭配上面 verify() 改成非同步背景處理後的輪詢
    端點。前端送出 POST /verify 拿到 202 後，改成定期打這支確認跑完
    了沒。回傳格式：

        {"status": "processing"}                       仍在背景分析中
        {"status": "done", "record": {...}}             跑完，附完整紀錄
        （quality 檢查沒過、或影片格式錯誤，那兩種情況 /verify 本身
        就已經同步回 422 了，不會走到這支端點）

    不用 response_model 鎖死成固定形狀，因為兩種狀態的欄位不一樣。
    """
    applicant = db.get(Applicant, applicant_id)
    if applicant is None:
        raise HTTPException(status_code=404, detail="applicant not found")

    _require_session(applicant, x_session_id, check_deadline=False)

    if applicant_id in _verify_pending:
        return {"status": "processing"}

    latest = (
        db.query(VerificationRecordRow)
        .filter_by(applicant_id=applicant_id)
        .order_by(VerificationRecordRow.id.desc())
        .first()
    )
    if latest is None:
        raise HTTPException(status_code=404, detail="尚未有任何驗證紀錄")

    record = VerificationRecord.model_validate(_row_to_record_dict(latest))
    return {"status": "done", "record": record.model_dump(by_alias=True)}


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
        "recordId": row.id,
        "applicantId": row.applicant_id,
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


@router.post("/admin/records/{record_id}/action", response_model=AdminRecordActionResponse)
def resolve_admin_record(
    record_id: int,
    payload: AdminRecordActionRequest,
    admin: AdminCredential = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> AdminRecordActionResponse:
    """後台「發送補件通知／通知前往實體分行／確認核准通過」三顆按鈕的
    真正實作。之前這三顆按鈕只改前端本地畫面狀態，沒有任何後端端點
    （見 frontend AdminLayout.tsx handleUpdateRecordStatus 的說明），
    這支端點補上真正的後端動作：approve 會改寫 verdict 為最終結果，
    三種動作都會寄出對應內容的通知信（見 notifications.py）。

    只有 verdict == "review" 的案件可以執行——通過／拒絕是自動判定，
    結果已經確定，不需要、也不應該讓行員在這裡改動。
    """
    row = db.get(VerificationRecordRow, record_id)
    if row is None:
        raise HTTPException(status_code=404, detail="record not found")
    if row.verdict != "review":
        raise HTTPException(
            status_code=400, detail="只有人工複核（review）案件可以執行這個動作"
        )

    if payload.action == "approve":
        row.verdict = "pass"
        row.verdict_label = "通過"
        db.commit()
        db.refresh(row)

    applicant = db.get(Applicant, row.applicant_id)
    email_sent = send_review_action_email(
        applicant.email, applicant.name, payload.action, record_id=row.id
    )

    return AdminRecordActionResponse(success=True, email_sent=email_sent)
