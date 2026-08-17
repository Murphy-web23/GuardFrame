"""FastAPI｜路由。

契約見 CONVENTIONS.md §5.5 API 契約。這裡先實作 PLAN.md 階段2 範圍內
點名的核心端點：POST /api/applicants。sms/send、sms/verify、
admin/login、account-setup、/verify 排在後續逐步補上（/verify 牽涉
五層分析與資料庫寫入，是整個後端最大的一塊，另外處理）。
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import Applicant
from common.schemas import ApplicantCreateRequest, ApplicantCreateResponse

router = APIRouter(prefix="/api")


def mask_id_number(id_number: str) -> str:
    """身分證字號遮蔽格式，例如 A123456789 -> A12****789（NFR-14）。

    保留前三後三、中間全部改成星號。字串太短（正常身分證不會發生，
    但避免對非預期輸入還原出完整值）時保守地全部遮蔽。
    """
    if len(id_number) <= 6:
        return "*" * len(id_number)
    return id_number[:3] + "*" * (len(id_number) - 6) + id_number[-3:]


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
