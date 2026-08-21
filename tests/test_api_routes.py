"""api/routes.py 的測試，透過 FastAPI TestClient 接真的 Postgres。

沒有可用連線時自動 skip。純函式（mask_id_number）不需要資料庫，
一定會跑。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from api.database import DATABASE_URL, SessionLocal
from api.main import app
from api.models import Applicant, Base
from api.routes import mask_id_number


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


# --------------------------------------------------------------------------
# mask_id_number（純函式，不需要資料庫）
# --------------------------------------------------------------------------


def test_mask_id_number_keeps_first_and_last_three():
    assert mask_id_number("A123456789") == "A12****789"


def test_mask_id_number_short_string_fully_masked():
    assert mask_id_number("AB12") == "****"


# --------------------------------------------------------------------------
# POST /api/applicants
# --------------------------------------------------------------------------


@requires_db
def test_create_applicant_success(client):
    response = client.post(
        "/api/applicants",
        json={
            "name": "測試用戶",
            "idNumber": "A123456789",
            "birthDate": "2000-01-01",
            "phone": "0912345678",
            "email": "pytest-route@example.com",
            "address": "測試地址",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert "applicantId" in body

    session = SessionLocal()
    try:
        applicant = session.get(Applicant, body["applicantId"])
        # 驗證只存了遮蔽格式，完整身分證字號沒有被存下來
        assert applicant.id_number_masked == "A12****789"
        assert applicant.name == "測試用戶"
        session.delete(applicant)
        session.commit()
    finally:
        session.close()


@requires_db
def test_create_applicant_rejects_missing_required_field(client):
    response = client.post("/api/applicants", json={"name": "測試用戶"})
    assert response.status_code == 422


@requires_db
def test_create_applicant_rejects_invalid_birth_date(client):
    response = client.post(
        "/api/applicants",
        json={
            "name": "測試用戶",
            "idNumber": "A123456789",
            "birthDate": "不是日期",
            "phone": "0912345678",
            "email": "pytest-route2@example.com",
            "address": "測試地址",
        },
    )
    assert response.status_code == 422
