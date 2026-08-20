export interface AdminUser {
  email: string;
  name: string;
  role: string;
  department: string;
  avatarLetter: string;
}

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
    }
  } catch {
    // Ignore storage exceptions in sandboxed environments
  }
};
