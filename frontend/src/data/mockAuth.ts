export interface AdminUser {
  email: string;
  name: string;
  role: string;
  department: string;
  avatarLetter: string;
}

// 2026-08-20：後台改接真的 POST /api/admin/login，這裡不再是唯一能登入
// 的帳密——保留這組常數只給 AdminLogin.tsx 的「填入示範帳密」按鈕用，
// 真正的帳號要用 scripts/init_admin.py 建立在資料庫裡，示範帳密只是
// 方便輸入，不代表這裡驗證。
export const DEMO_ADMIN_CREDENTIALS = {
  email: 'admin@guardframe.demo',
  password: 'GuardFrame123!',
};

export const MOCK_ADMIN_USER: AdminUser = {
  email: 'admin@guardframe.demo',
  name: '陳專員',
  role: '高級風控審核師',
  department: '數位金融處 • 風險控管部',
  avatarLetter: '陳',
};

const AUTH_STORAGE_KEY = 'guardframe_admin_auth';
const TOKEN_STORAGE_KEY = 'guardframe_admin_token';

export const getStoredAuth = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(AUTH_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const setStoredAuth = (isAuthenticated: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    if (isAuthenticated) {
      sessionStorage.setItem(AUTH_STORAGE_KEY, 'true');
    } else {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage exceptions in sandboxed environments
  }
};

// 2026-08-20 新增：真的 admin/login 回傳的 Authorization: Bearer token，
// 跟上面 AUTH_STORAGE_KEY（單純的「有沒有登入」布林值）分開存——
// admin/records、admin/records/{id} 這兩支查詢端點都要帶真的 token。
export const getStoredAdminToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const setStoredAdminToken = (token: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage exceptions in sandboxed environments
  }
};
