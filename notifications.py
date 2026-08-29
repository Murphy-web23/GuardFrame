"""驗證結果通知信。

自動判定案件（通過／拒絕）在使用者送出驗證的當下就已經確定，系統
立刻寄信通知。人工複核案件的通知，要等審核人員在後台操作對應按鈕後
才會觸發（見 api/routes.py resolve_admin_record()）。

用 Resend 的 API 寄信，不用 SMTP——Gmail 應用程式密碼這條路在 demo 前
測試時發現該帳戶已被 Google 直接關閉這項設定，改走 API Key 的方式更
穩定、不依賴 Google 帳戶安全設定的變動。

沒有設定 RESEND_API_KEY 時（例如本機開發、demo 環境還沒申請帳號），
直接跳過寄信、印一行提示，不拋例外——寄信失敗不該讓整筆驗證的分析
結果連帶存不進資料庫。
"""

import requests

import config

_RESEND_ENDPOINT = "https://api.resend.com/emails"

_SIGNATURE = "此為系統自動發送之通知信，請勿直接回覆本郵件。\nGuardFrame 身分驗證團隊 敬上"

_VERDICT_SUBJECT = {
    "pass": "【GuardFrame 數位開戶】您的身分驗證已通過",
    "reject": "【GuardFrame 數位開戶】您的身分驗證未通過",
}

_VERDICT_BODY = {
    "pass": (
        "{name} 您好，\n\n"
        "感謝您使用 GuardFrame 數位開戶服務。\n\n"
        "您的身分驗證已通過審核，請重新登入開戶頁面完成後續帳戶設定，"
        "即可正式啟用帳戶：\n"
        "{app_url}\n"
        "{case_line}"
        "驗證結果：通過\n\n"
        "若您並未申請本次開戶服務，請盡速與客服聯繫。\n\n"
        "{signature}"
    ),
    "reject": (
        "{name} 您好，\n\n"
        "感謝您使用 GuardFrame 數位開戶服務。\n\n"
        "很抱歉，您本次的身分驗證未通過審核，本次開戶申請無法繼續進行。\n"
        "{case_line}"
        "驗證結果：未通過\n\n"
        "若您對本次結果有疑問，歡迎與客服聯繫進一步了解。\n\n"
        "{signature}"
    ),
}

# 人工複核案件經行員操作後的通知（見 api/routes.py resolve_admin_record()）。
# "approve" 沿用 _VERDICT_SUBJECT/_VERDICT_BODY 的 "pass" 版本，
# 因為對申請人來說收到的訊息應該一致，不用另外寫一份幾乎一樣的文字。
_REVIEW_ACTION_SUBJECT = {
    "request_docs": "【GuardFrame 數位開戶】您的開戶申請需要補充資料",
    "branch_visit": "【GuardFrame 數位開戶】您的開戶申請需要親自至分行辦理",
}

_REVIEW_ACTION_BODY = {
    "request_docs": (
        "{name} 您好，\n\n"
        "您的開戶申請經專員人工複核後，仍需補充部分資料才能完成審核。\n"
        "{case_line}"
        "處理狀態：待補件\n\n"
        "請您於 3 個工作天內，重新登入開戶頁面依指示線上補齊所需資料，"
        "以免影響開戶進度：\n"
        "{app_url}\n\n"
        "{signature}"
    ),
    "branch_visit": (
        "{name} 您好，\n\n"
        "您的開戶申請經專員人工複核後，需要請您親自攜帶身分證明文件至"
        "鄰近分行辦理後續手續，無法完全透過線上流程完成。\n"
        "{case_line}"
        "處理狀態：待臨櫃辦理\n\n"
        "請您攜帶身分證正本及第二證件，於營業時間內至任一分行辦理，"
        "造成不便，敬請見諒。\n\n"
        "{signature}"
    ),
}


def _case_line(record_id: int | None) -> str:
    return f"案件編號：{record_id}\n" if record_id is not None else ""


def _send(to_email: str, subject: str, body: str, tag: str) -> bool:
    """實際打 Resend API 的共用邏輯。tag 只用於失敗時的 log 訊息。"""
    if not config.RESEND_API_KEY:
        print(f"[notifications] RESEND_API_KEY 未設定，略過寄信給 {to_email}（{tag}）")
        return False

    payload = {
        "from": f"{config.RESEND_FROM_NAME} <{config.RESEND_FROM_ADDRESS}>",
        "to": [to_email],
        "subject": subject,
        "text": body,
    }

    try:
        resp = requests.post(
            _RESEND_ENDPOINT,
            headers={"Authorization": f"Bearer {config.RESEND_API_KEY}"},
            json=payload,
            timeout=10,
        )
        if resp.status_code >= 400:
            print(f"[notifications] 寄信失敗（{tag}, to={to_email}）：{resp.status_code} {resp.text}")
            return False
        return True
    except requests.RequestException as exc:
        print(f"[notifications] 寄信失敗（{tag}, to={to_email}）：{exc}")
        return False


def send_verdict_email(
    to_email: str, applicant_name: str, verdict: str, record_id: int | None = None
) -> bool:
    """寄送通過／拒絕結果通知信。

    參數:
        to_email: 申請人信箱
        applicant_name: 申請人姓名，用於信件稱呼
        verdict: "pass" 或 "reject"，其餘值（例如 "review"）直接跳過
        record_id: 驗證紀錄編號，放進信件內文供申請人／客服對照，
            不給時信件直接省略這一行

    回傳:
        bool，是否實際寄出。API Key 未設定、verdict 不是 pass/reject、
        或寄送過程出錯，都回傳 False 而不拋例外。
    """
    if verdict not in _VERDICT_SUBJECT:
        return False

    body = _VERDICT_BODY[verdict].format(
        name=applicant_name,
        case_line=_case_line(record_id),
        signature=_SIGNATURE,
        app_url=config.FRONTEND_BASE_URL,
    )
    return _send(to_email, _VERDICT_SUBJECT[verdict], body, tag=f"verdict={verdict}")


def send_review_action_email(
    to_email: str, applicant_name: str, action: str, record_id: int | None = None
) -> bool:
    """寄送人工複核案件的行員操作通知信。

    參數:
        to_email: 申請人信箱
        applicant_name: 申請人姓名，用於信件稱呼
        action: "approve"／"request_docs"／"branch_visit"，其餘值直接跳過
        record_id: 驗證紀錄編號，同 send_verdict_email()

    回傳:
        bool，是否實際寄出，規則同 send_verdict_email()。
    """
    if action == "approve":
        return send_verdict_email(to_email, applicant_name, "pass", record_id=record_id)

    if action not in _REVIEW_ACTION_SUBJECT:
        return False

    body = _REVIEW_ACTION_BODY[action].format(
        name=applicant_name,
        case_line=_case_line(record_id),
        signature=_SIGNATURE,
        app_url=config.FRONTEND_BASE_URL,
    )
    return _send(to_email, _REVIEW_ACTION_SUBJECT[action], body, tag=f"action={action}")
