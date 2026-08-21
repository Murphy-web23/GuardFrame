"""POST /api/applicants/{id}/verify 的測試，透過 FastAPI TestClient 接真的
Postgres。沒有可用連線時自動 skip。

合成的測試影片沒有真人臉部，品質檢查（image_utils/quality.py）一定會
卡在 faceRatio 這關而不合格——這是預期行為，不是繞過。「品質不合格」
跟「品質通過後整條五層+融合+資料庫寫入管線走得通」是兩個獨立要驗證
的問題，後者用 monkeypatch 讓 check_image_quality 直接回傳 passed=True，
但底下五個 analyzer 全部是真的在跑，不是 mock。
"""

import json
import secrets
import shutil
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

import config
import api.routes as routes
from api.database import DATABASE_URL, SessionLocal
from api.main import app
from api.models import Applicant, Base, VerificationRecordRow
from track3_photometric import sequence as seq


def _db_available():
    try:
        engine = create_engine(DATABASE_URL)
        with engine.connect():
            pass
        engine.dispose()
        return True
    except Exception:
        return False


requires_db = pytest.mark.skipif(
    not _db_available(),
    reason="沒有可用的 PostgreSQL 連線（guardframe-pg 容器沒啟動？見 .env.example）",
)


@pytest.fixture(scope="module", autouse=True)
def _ensure_tables():
    if _db_available():
        engine = create_engine(DATABASE_URL)
        Base.metadata.create_all(engine)
        engine.dispose()


@pytest.fixture
def client():
    return TestClient(app)


# fps 刻意用得比真實的 30 低，讓測試影片格數少一點、跑快一點，
# 同時保持跟真實比例相近的段落安排：
#   blink 3s / turn_left 5s / turn_right 5s / wave_hand 7s = action 20s
#   lighting 3s，wave_hand 剛好是 action 的最後 7 秒，對應 phases.occlusion
_TEST_FPS = 5.0
_DURATIONS = {"blink": 3, "turn_left": 5, "turn_right": 5, "wave_hand": 7}
_ACTION_FRAMES = int(sum(_DURATIONS.values()) * _TEST_FPS)  # 100
_LIGHTING_FRAMES = int(3 * _TEST_FPS)  # 15
_WAVE_HAND_FRAMES = int(_DURATIONS["wave_hand"] * _TEST_FPS)  # 35


@pytest.fixture
def applicant_id():
    session = SessionLocal()
    try:
        applicant = Applicant(
            name="Verify測試用戶", id_number_masked="C56****321", phone="0911222333",
            email="pytest-verify@example.com", address="測試地址",
            birth_date=date(1990, 1, 1),
        )
        session.add(applicant)
        session.commit()
        session.refresh(applicant)
        yield applicant.id
    finally:
        session.query(VerificationRecordRow).filter_by(applicant_id=applicant.id).delete()
        session.query(Applicant).filter_by(id=applicant.id).delete()
        session.commit()
        session.close()
        # 象徵性保存的測試影片（見 PHASE1_NOTES §八），清掉避免測試
        # 素材一直堆積在 data/verification_videos/。
        shutil.rmtree(config.VERIFICATION_VIDEO_DIR / str(applicant.id), ignore_errors=True)


@pytest.fixture
def session_headers(applicant_id):
    """/verify 現在要求 X-Session-Id header（§4.8）。直接寫 DB 建立一個
    未過期的 session，不用真的先跑 sms/send + sms/verify——那組流程有
    自己獨立的測試（tests/test_api_session.py），這裡只關心 /verify
    本身的管線走不走得通。"""
    token = secrets.token_urlsafe(config.SESSION_TOKEN_BYTES)
    session = SessionLocal()
    try:
        applicant = session.get(Applicant, applicant_id)
        applicant.session_id = token
        applicant.session_deadline_at = datetime.now() + timedelta(minutes=15)
        # /verify 現在也要求上傳的挑戰順序跟伺服器指派的一致（見
        # PHASE1_NOTES §九），直接寫成跟 _build_payload() 用的固定順序
        # 一樣，不用真的先呼叫 challenge-order 端點——那支端點有自己
        # 獨立的測試（tests/test_api_challenge_order.py）。
        applicant.challenge_order = ["blink", "turn_left", "turn_right", "wave_hand"]
        session.commit()
    finally:
        session.close()
    return {"X-Session-Id": token}


def _make_test_video(path, num_frames, size=100, textured=False):
    """畫一支測試影片。textured=True 時每格畫隨機雜訊塊，有邊緣/對比，
    但仍然沒有真人臉，faceRatio 還是會不合格。"""
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, _TEST_FPS, (size, size))
    rng = np.random.default_rng(0)
    try:
        for _ in range(num_frames):
            if textured:
                frame = rng.integers(80, 180, size=(size, size, 3), dtype=np.uint8)
            else:
                frame = np.full((size, size, 3), 120, dtype=np.uint8)
            writer.write(frame)
    finally:
        writer.release()


def _build_payload():
    challenges = [
        {"action": "blink", "durationSec": _DURATIONS["blink"]},
        {"action": "turn_left", "durationSec": _DURATIONS["turn_left"]},
        {"action": "turn_right", "durationSec": _DURATIONS["turn_right"]},
        {"action": "wave_hand", "durationSec": _DURATIONS["wave_hand"]},
    ]
    action_end = _ACTION_FRAMES - 1
    lighting_start = _ACTION_FRAMES
    lighting_end = _ACTION_FRAMES + _LIGHTING_FRAMES - 1
    occlusion_start = _ACTION_FRAMES - _WAVE_HAND_FRAMES
    occlusion_end = action_end

    challenges_payload = {
        "challenges": challenges,
        "recording": {
            "durationSec": (_ACTION_FRAMES + _LIGHTING_FRAMES) / _TEST_FPS,
            "fps": _TEST_FPS,
            "totalFrames": _ACTION_FRAMES + _LIGHTING_FRAMES,
            "phases": {
                "action": [0, action_end],
                "lighting": [lighting_start, lighting_end],
                "occlusion": [occlusion_start, occlusion_end],
            },
        },
    }

    light_log = seq.generate_light_log(seed=1)
    return challenges_payload, light_log


@requires_db
def test_verify_returns_422_when_quality_fails(client, applicant_id, session_headers, tmp_path):
    """沒有真人臉，faceRatio 一定不合格——驗證品質不合格時走 422 路徑，
    不會硬跑五層分析。"""
    video_path = tmp_path / "blank.mp4"
    total_frames = _ACTION_FRAMES + _LIGHTING_FRAMES
    _make_test_video(video_path, total_frames, textured=False)

    challenges_payload, light_log = _build_payload()

    with open(video_path, "rb") as f:
        response = client.post(
            f"/api/applicants/{applicant_id}/verify",
            files={"video": ("test.mp4", f, "video/mp4")},
            data={
                "light_log": json.dumps(light_log, ensure_ascii=False),
                "challenges": json.dumps(challenges_payload, ensure_ascii=False),
            },
            headers=session_headers,
        )

    assert response.status_code == 422
    assert response.json()["quality"]["passed"] is False
    # 不合格影片不值得象徵性保存（見 PHASE1_NOTES §八），確認沒有留下
    # 半調子的檔案在磁碟上。
    assert not (config.VERIFICATION_VIDEO_DIR / str(applicant_id)).exists()


@requires_db
def test_verify_returns_422_when_challenge_order_does_not_match(
    client, applicant_id, session_headers, tmp_path
):
    """§5.3／PHASE1_NOTES §九：上傳的挑戰順序如果跟伺服器指派的
    （session_headers fixture 設的是 blink/turn_left/turn_right/
    wave_hand）不一樣，必須直接擋下，不然隨機順序這道防線就沒有意義。
    """
    video_path = tmp_path / "blank.mp4"
    _make_test_video(video_path, 5, textured=False)

    wrong_order_payload, light_log = _build_payload()
    wrong_order_payload["challenges"] = [
        {"action": "wave_hand", "durationSec": _DURATIONS["wave_hand"]},
        {"action": "turn_right", "durationSec": _DURATIONS["turn_right"]},
        {"action": "turn_left", "durationSec": _DURATIONS["turn_left"]},
        {"action": "blink", "durationSec": _DURATIONS["blink"]},
    ]

    with open(video_path, "rb") as f:
        response = client.post(
            f"/api/applicants/{applicant_id}/verify",
            files={"video": ("test.mp4", f, "video/mp4")},
            data={
                "light_log": json.dumps(light_log, ensure_ascii=False),
                "challenges": json.dumps(wrong_order_payload, ensure_ascii=False),
            },
            headers=session_headers,
        )

    assert response.status_code == 422


@requires_db
def test_verify_returns_401_without_session_header(client, applicant_id, tmp_path):
    """§4.8：沒帶 X-Session-Id 或帶錯的值，不能跑到五層分析——驗證任何人
    猜到 applicantId 也不能亂呼叫這支端點。"""
    video_path = tmp_path / "blank.mp4"
    _make_test_video(video_path, 5, textured=False)
    challenges_payload, light_log = _build_payload()

    with open(video_path, "rb") as f:
        response = client.post(
            f"/api/applicants/{applicant_id}/verify",
            files={"video": ("test.mp4", f, "video/mp4")},
            data={
                "light_log": json.dumps(light_log, ensure_ascii=False),
                "challenges": json.dumps(challenges_payload, ensure_ascii=False),
            },
            headers={"X-Session-Id": "nonexistent-token"},
        )

    assert response.status_code == 401


@requires_db
def test_verify_returns_409_when_session_expired(client, applicant_id, tmp_path):
    """§4.8：15 分鐘倒數歸零後不能再跑 /verify（§5.5 契約明文的 409）。"""
    token = secrets.token_urlsafe(config.SESSION_TOKEN_BYTES)
    session = SessionLocal()
    try:
        applicant = session.get(Applicant, applicant_id)
        applicant.session_id = token
        applicant.session_deadline_at = datetime.now() - timedelta(seconds=1)
        session.commit()
    finally:
        session.close()

    video_path = tmp_path / "blank.mp4"
    _make_test_video(video_path, 5, textured=False)
    challenges_payload, light_log = _build_payload()

    with open(video_path, "rb") as f:
        response = client.post(
            f"/api/applicants/{applicant_id}/verify",
            files={"video": ("test.mp4", f, "video/mp4")},
            data={
                "light_log": json.dumps(light_log, ensure_ascii=False),
                "challenges": json.dumps(challenges_payload, ensure_ascii=False),
            },
            headers={"X-Session-Id": token},
        )

    assert response.status_code == 409


@requires_db
def test_verify_full_pipeline_writes_record_when_quality_passes(
    client, applicant_id, session_headers, tmp_path, monkeypatch
):
    """繞過品質檢查（沒有真人臉本來就過不了，見模組頂部說明），驗證
    五層分析＋融合決策＋資料庫寫入這條真正的管線走得通、不會崩潰，
    且回傳的 JSON 是正確的 camelCase 格式。"""
    monkeypatch.setattr(
        routes,
        "check_image_quality",
        lambda frames: {
            "passed": True, "blurScore": 999.0, "brightness": 120.0,
            "contrast": 50.0, "overexposedRatio": 0.0, "faceRatio": 0.5, "message": "",
        },
    )

    video_path = tmp_path / "textured.mp4"
    total_frames = _ACTION_FRAMES + _LIGHTING_FRAMES
    _make_test_video(video_path, total_frames, textured=True)

    challenges_payload, light_log = _build_payload()

    with open(video_path, "rb") as f:
        response = client.post(
            f"/api/applicants/{applicant_id}/verify",
            files={"video": ("test.mp4", f, "video/mp4")},
            data={
                "light_log": json.dumps(light_log, ensure_ascii=False),
                "challenges": json.dumps(challenges_payload, ensure_ascii=False),
            },
            headers=session_headers,
        )

    assert response.status_code == 200
    body = response.json()

    # 回傳格式：camelCase、§5.1 的完整結構
    assert body["applicantIdMasked"] == "C56****321"
    assert "riskScore" in body["decision"]
    assert body["decision"]["verdict"] in ("pass", "review", "reject")
    assert "fakeProbability" in body["synthetic"]
    assert body["synthetic"]["fakeProbability"] == pytest.approx(0.87)  # B 的佔位版本固定值
    assert "heartRate" in body["rppg"]
    assert "geometryScore" in body["photometric"]
    assert "layerScore" in body["occlusion"]

    # 資料庫真的寫進去了，且欄位對得起來
    session = SessionLocal()
    try:
        rows = (
            session.query(VerificationRecordRow)
            .filter_by(applicant_id=applicant_id)
            .all()
        )
        assert len(rows) == 1
        # DB 讀回來是 Decimal（Numeric 欄位），跟 float 比較前要先轉型
        assert float(rows[0].synthetic_fake_probability) == pytest.approx(0.87)
        assert rows[0].verdict == body["decision"]["verdict"]

        # 象徵性影片保存（PHASE1_NOTES §八）：走完整條管線的紀錄要真的
        # 把影片留在磁碟上，不是只寫路徑字串騙自己。
        assert rows[0].video_path is not None
        stored_path = config.BASE_DIR / rows[0].video_path
        assert stored_path.is_file()
        assert stored_path.stat().st_size > 0
    finally:
        session.close()


@requires_db
def test_verify_returns_404_for_nonexistent_applicant(client, tmp_path):
    video_path = tmp_path / "x.mp4"
    _make_test_video(video_path, 5, textured=False)
    challenges_payload, light_log = _build_payload()

    with open(video_path, "rb") as f:
        response = client.post(
            "/api/applicants/999999999/verify",
            files={"video": ("test.mp4", f, "video/mp4")},
            data={
                "light_log": json.dumps(light_log, ensure_ascii=False),
                "challenges": json.dumps(challenges_payload, ensure_ascii=False),
            },
            # X-Session-Id 是必填 header（HTTP header 值只能是 ASCII，
            # 值本身不重要）——applicant 不存在時，404 檢查在
            # _require_session() 之前就先擋下了。
            headers={"X-Session-Id": "irrelevant-value"},
        )

    assert response.status_code == 404
