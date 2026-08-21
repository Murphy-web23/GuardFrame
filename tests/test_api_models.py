"""api/models.py + database.py 的測試，接真的 PostgreSQL（guardframe-pg 容器）。

沒有可用連線時整批自動 skip，不會擋到沒裝資料庫的人（例如 A）跑
其餘測試。每筆測試資料都在測試結束時自行清乾淨，不留垃圾在資料庫裡。
"""

import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from api.database import DATABASE_URL
from api.models import AdminCredential, Applicant, Base, VerificationRecordRow


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


@pytest.fixture(scope="module")
def engine():
    eng = create_engine(DATABASE_URL)
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def db_session(engine):
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.rollback()
    session.close()


@requires_db
def test_create_all_tables_succeeds(engine):
    tables = set(inspect(engine).get_table_names())
    assert {"applicants", "verification_records", "admin_credentials"} <= tables


@requires_db
def test_applicant_round_trip(db_session):
    applicant = Applicant(
        name="測試用戶", id_number_masked="A12****789", phone="0912345678",
        email="pytest-applicant@example.com", address="測試地址",
        birth_date=date(2000, 1, 1),
    )
    db_session.add(applicant)
    db_session.commit()
    db_session.refresh(applicant)

    fetched = db_session.get(Applicant, applicant.id)
    assert fetched.name == "測試用戶"
    assert fetched.created_at is not None

    db_session.delete(fetched)
    db_session.commit()


@requires_db
def test_verification_record_round_trip_with_jsonb_and_fk(db_session):
    applicant = Applicant(
        name="測試用戶2", id_number_masked="B34****567", phone="0987654321",
        email="pytest-record@example.com", address="測試地址2",
        birth_date=date(1995, 5, 5),
    )
    db_session.add(applicant)
    db_session.flush()  # 拿到 applicant.id，不用先 commit

    record = VerificationRecordRow(
        applicant_id=applicant.id,
        timestamp=datetime.now(),
        source_type="虛擬攝影機",
        duration_sec=Decimal("23.10"),
        fps=Decimal("30.00"),
        total_frames=693,
        phases={"action": [0, 599], "lighting": [600, 692], "occlusion": [420, 599]},
        quality_passed=True,
        blur_score=Decimal("142.60"),
        brightness=Decimal("118.40"),
        contrast=Decimal("52.10"),
        overexposed_ratio=Decimal("0.020"),
        face_ratio=Decimal("0.310"),
        quality_message="",
        baseline_challenges=[{"action": "blink", "passed": True}],
        baseline_verdict="pass",
        baseline_confidence_score=Decimal("0.1000"),
        synthetic_fake_probability=Decimal("0.9420"),
        synthetic_threshold=Decimal("0.5000"),
        synthetic_verdict="reject",
        synthetic_top_signals=[{"label": "x", "weight": 0.38}],
        rppg_detected=False,
        rppg_heart_rate=None,
        rppg_snr=Decimal("0.70"),
        rppg_roi_consistency=Decimal("0.210"),
        rppg_checks=[],
        rppg_waveform=[],
        rppg_spectrum=[],
        rppg_confidence_score=Decimal("0.8000"),
        photo_detected=False,
        photo_correlation=Decimal("0.060"),
        photo_latency_ms=None,
        photo_geometry_score=Decimal("0.090"),
        photo_sequence=["淡紅"],
        photo_checks=[],
        photo_light_curve=[],
        photo_reflect_curve=[],
        photo_confidence_score=Decimal("0.9000"),
        occ_detected=True,
        occ_wave_cycles=3,
        occ_identity_stability=Decimal("0.710"),
        occ_max_identity_drop=Decimal("0.340"),
        occ_segments=[[12, 34]],
        occ_layer_score=Decimal("0.280"),
        occ_anomaly_frames=[15, 62],
        occ_checks=[],
        occ_stability_curve=[],
        occ_confidence_score=Decimal("0.2000"),
        risk_score=94,
        verdict="reject",
        verdict_label="拒絕",
        reasons=["未偵測到照明響應，影像可能未經實體鏡頭擷取"],
        account_result="rejected",
        vlm_available=None,
        vlm_frame_observations=None,
        vlm_summary=None,
        vlm_model=None,
        vlm_latency_ms=None,
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    fetched = db_session.get(VerificationRecordRow, record.id)
    assert fetched.phases == {
        "action": [0, 599], "lighting": [600, 692], "occlusion": [420, 599]
    }
    assert fetched.rppg_heart_rate is None  # 未偵測到時應為 NULL，不是 0
    assert fetched.account_result == "rejected"
    assert fetched.applicant.name == "測試用戶2"  # 驗證 relationship 正確

    db_session.delete(fetched)
    db_session.delete(applicant)
    db_session.commit()


@requires_db
def test_admin_credential_username_must_be_unique(db_session):
    cred = AdminCredential(username="pytest_admin_unique", password_hash="x" * 60)
    db_session.add(cred)
    db_session.commit()

    try:
        dup = AdminCredential(username="pytest_admin_unique", password_hash="y" * 60)
        db_session.add(dup)
        with pytest.raises(IntegrityError):
            db_session.commit()
    finally:
        db_session.rollback()
        db_session.delete(db_session.get(AdminCredential, cred.id))
        db_session.commit()
