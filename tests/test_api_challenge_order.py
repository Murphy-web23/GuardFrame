"""GET /api/applicants/{id}/challenge-order 的測試（§5.3、PHASE1_NOTES
§九）。透過 FastAPI TestClient 接真的 Postgres，沒有可用連線時自動 skip。
"""

import secrets
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

import config
from api.database import DATABASE_URL, SessionLocal
from api.main import app
from api.models import Applicant, Base


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


@pytest.fixture
def applicant_id():
    session = SessionLocal()
    try:
        applicant = Applicant(
            name="ChallengeOrder測試用戶", id_number_masked="F12****321", phone="0944555666",
            email="pytest-challenge-order@example.com", address="測試地址",
            birth_date=date(1993, 7, 7),
        )
        session.add(applicant)
        session.commit()
        session.refresh(applicant)
        yield applicant.id
    finally:
        session.query(Applicant).filter_by(id=applicant.id).delete()
        session.commit()
        session.close()


def _set_session(applicant_id, *, expired=False):
    token = secrets.token_urlsafe(config.SESSION_TOKEN_BYTES)
    session = SessionLocal()
    try:
        applicant = session.get(Applicant, applicant_id)
        applicant.session_id = token
        delta = timedelta(seconds=-1) if expired else timedelta(minutes=15)
        applicant.session_deadline_at = datetime.now() + delta
        session.commit()
    finally:
        session.close()
    return {"X-Session-Id": token}


@requires_db
def test_returns_all_four_actions_with_correct_durations(client, applicant_id):
    headers = _set_session(applicant_id)
    response = client.get(f"/api/applicants/{applicant_id}/challenge-order", headers=headers)
    assert response.status_code == 200

    challenges = response.json()["challenges"]
    assert len(challenges) == 4
    actions = {c["action"] for c in challenges}
    assert actions == {"blink", "turn_left", "turn_right", "wave_hand"}
    for c in challenges:
        assert c["durationSec"] == config.BASELINE_ACTION_DURATIONS[c["action"]]


@requires_db
def test_repeated_calls_within_same_session_return_same_order(client, applicant_id):
    headers = _set_session(applicant_id)
    first = client.get(f"/api/applicants/{applicant_id}/challenge-order", headers=headers)
    second = client.get(f"/api/applicants/{applicant_id}/challenge-order", headers=headers)
    assert first.json() == second.json()


@requires_db
def test_returns_401_without_valid_session(client, applicant_id):
    response = client.get(
        f"/api/applicants/{applicant_id}/challenge-order",
        headers={"X-Session-Id": "nonexistent-token"},
    )
    assert response.status_code == 401


@requires_db
def test_returns_404_for_nonexistent_applicant(client):
    response = client.get(
        "/api/applicants/999999999/challenge-order",
        headers={"X-Session-Id": "irrelevant-value"},
    )
    assert response.status_code == 404


@requires_db
def test_returns_409_when_session_expired(client, applicant_id):
    headers = _set_session(applicant_id, expired=True)
    response = client.get(f"/api/applicants/{applicant_id}/challenge-order", headers=headers)
    assert response.status_code == 409


@requires_db
def test_new_sms_verify_session_gets_a_fresh_order(client, applicant_id):
    """新一輪 session 不該沿用舊的挑戰順序——sms/verify 成功後要清空
    challenge_order（見 api/routes.py verify_sms()）。"""
    headers = _set_session(applicant_id)
    client.get(f"/api/applicants/{applicant_id}/challenge-order", headers=headers)

    session = SessionLocal()
    try:
        applicant = session.get(Applicant, applicant_id)
        assert applicant.challenge_order is not None

        applicant.sms_code = config.SMS_DEMO_CODE
        session.commit()
    finally:
        session.close()

    verify_resp = client.post(
        f"/api/applicants/{applicant_id}/sms/verify", json={"code": config.SMS_DEMO_CODE}
    )
    assert verify_resp.status_code == 200

    session = SessionLocal()
    try:
        applicant = session.get(Applicant, applicant_id)
        assert applicant.challenge_order is None
    finally:
        session.close()
