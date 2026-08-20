// 申請人開戶流程的組合動作，建立在 client.ts 的原始端點上。
//
// 為什麼要在這裡把「建立申請人」跟「簡訊驗證」綁在一起：
// 後端 POST /api/applicants 要求 name/idNumber/birthDate/email/address
// 全部欄位（見 CONVENTIONS §5.5），但這些資料要到「確認個人資料」那一步
// （BasicInfoScreen）使用者才填完；可是畫面上「驗證手機號碼」
// （SmsVerifyScreen）在更早的步驟就發生了，那時候後端根本沒有
// applicantId 可以掛簡訊驗證。
//
// 折衷做法：SmsVerifyScreen 維持原本的畫面互動（使用者體感不變），
// 真正呼叫後端建立申請人＋完成簡訊驗證，延後到 BasicInfoScreen 確認送出
// 的當下才一次做完——這是目前前端畫面流程跟後端 API 流程的落差下，
// 影響最小的接法，不用重排既有的六步驟順序。
//
// 用的是後端 Demo 模式固定驗證碼（config.SMS_DEMO_CODE，跟前端
// SmsVerifyScreen 原本「填入示範驗證碼」按鈕用的是同一組 123456，
// 不是新引入的密碼或機密）。

import { createApplicant, sendSms, verifySms, ApplicantCreateInput } from './client';

const DEMO_SMS_CODE = '123456';

export interface ApplicantSession {
  applicantId: number;
  sessionId: string;
}

export async function createApplicantAndSession(
  input: ApplicantCreateInput
): Promise<ApplicantSession> {
  const { applicantId } = await createApplicant(input);
  await sendSms(applicantId, input.phone);
  const result = await verifySms(applicantId, DEMO_SMS_CODE);
  return { applicantId, sessionId: result.sessionId };
}
