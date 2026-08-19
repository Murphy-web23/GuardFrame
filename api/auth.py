"""FastAPI｜後台認證。

契約見 CONVENTIONS.md §4.9（verify_admin_login 的介面）、§5.5（
POST /api/admin/login）、§8.1（bcrypt 初始化腳本範例）。

跟 §4.8 申請人流程的 session_id 是不同機制：行員有事先建立好的帳號
密碼，這裡驗證的是「這組帳密對不對」，不是「這個請求是不是剛驗證過
的那個申請人」。
"""

import secrets
from datetime import datetime, timedelta

from passlib.hash import bcrypt
from sqlalchemy.orm import Session

import config
from api.models import AdminCredential


def verify_admin_login(username: str, password: str, db: Session) -> dict:
    """後台登入驗證，密碼以 bcrypt 雜湊比對（§4.9）。

    回傳:
        {
            "success": bool,
            "token": str | None    # 成功時回傳簡易 session token，失敗為 None
        }

    實作要點:
        - 使用 passlib.hash.bcrypt 比對，不自行實作雜湊演算法
        - 失敗時不透露是帳號不存在還是密碼錯誤——兩種情況回傳的 dict
          形狀完全相同，呼叫端不需要（也不能）另外判斷失敗原因
        - token 有效期 config.ADMIN_TOKEN_HOURS，過期需重新登入
        - 密碼欄位（明文與雜湊）不得出現在這個函式以外的任何地方，
          呼叫端（api/routes.py）也不能把 password 記錄到 log
    """
    admin = db.query(AdminCredential).filter_by(username=username).first()
    if admin is None or not bcrypt.verify(password, admin.password_hash):
        return {"success": False, "token": None}

    token = secrets.token_urlsafe(config.SESSION_TOKEN_BYTES)
    admin.token = token
    admin.token_expires_at = datetime.now() + timedelta(hours=config.ADMIN_TOKEN_HOURS)
    db.commit()

    return {"success": True, "token": token}
