"""api/auth.py｜verify_admin_login() 的測試（§4.9）。透過真的 Postgres，
沒有可用連線時自動 skip（跟其他 api 測試同一套判斷方式）。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from passlib.hash import bcrypt
from sqlalchemy import create_engine

import config
from api.auth import verify_admin_login
from api.database import DATABASE_URL, SessionLocal
from api.models import AdminCredential, Base


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
def admin():
    session = SessionLocal()
    try:
        credential = AdminCredential(
            username="pytest-admin",
            password_hash=bcrypt.using(rounds=4).hash("correct-horse-battery-staple"),
        )
        session.add(credential)
        session.commit()
        session.refresh(credential)
        yield credential.id
    finally:
        session.query(AdminCredential).filter_by(id=credential.id).delete()
        session.commit()
        session.close()


@requires_db
def test_correct_credentials_succeed_and_return_token(admin):
    session = SessionLocal()
    try:
        result = verify_admin_login("pytest-admin", "correct-horse-battery-staple", session)
        assert result["success"] is True
        assert result["token"]

        row = session.get(AdminCredential, admin)
        assert row.token == result["token"]
        assert row.token_expires_at is not None
    finally:
        session.close()


@requires_db
def test_wrong_password_fails_without_token(admin):
    session = SessionLocal()
    try:
        result = verify_admin_login("pytest-admin", "wrong-password", session)
        assert result == {"success": False, "token": None}
    finally:
        session.close()


@requires_db
def test_nonexistent_username_fails_with_same_shape_as_wrong_password(admin):
    """§4.9：失敗時不得透露是帳號不存在還是密碼錯誤——兩種情況的回傳
    形狀必須完全相同，不能讓呼叫端能區分出帳號存不存在（避免帳號枚舉）。
    """
    session = SessionLocal()
    try:
        result = verify_admin_login("no-such-user", "anything", session)
        assert result == {"success": False, "token": None}
    finally:
        session.close()
