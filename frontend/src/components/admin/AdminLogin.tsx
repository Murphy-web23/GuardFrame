import React, { useState } from 'react';
import { AIGuardian } from '../AIGuardian';
import { DEMO_ADMIN_CREDENTIALS, setStoredAuth, setStoredAdminToken } from '../../data/mockAuth';
import { adminLogin, ApiError } from '../../api/client';
import { 
  Shield, 
  Lock, 
  Mail, 
  ArrowRight, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  Sparkles,
  Smartphone,
  Eye,
  EyeOff,
  Zap
} from 'lucide-react';

interface AdminLoginProps {
  onLoginSuccess: () => void;
  onSwitchToUserPortal?: () => void;
  onBackToUser?: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({
  onLoginSuccess,
  onSwitchToUserPortal,
  onBackToUser,
}) => {
  const [account, setAccount] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [status, setStatus] = useState<'initial' | 'loading' | 'success' | 'error' | 'empty'>('initial');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleBackToUser = () => {
    if (onSwitchToUserPortal) {
      onSwitchToUserPortal();
    } else if (onBackToUser) {
      onBackToUser();
    } else {
      window.location.hash = '#user';
    }
  };

  const handleFillDemoAdmin = () => {
    setAccount(DEMO_ADMIN_CREDENTIALS.email);
    setPassword(DEMO_ADMIN_CREDENTIALS.password);
    setStatus('initial');
    setErrorMessage('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Check empty
    if (!account.trim() || !password.trim()) {
      setStatus('empty');
      setErrorMessage('請輸入管理員帳號與密碼');
      return;
    }

    // 2. Loading state
    setStatus('loading');
    setErrorMessage('');

    // 真的呼叫 POST /api/admin/login（bcrypt 比對，見 CONVENTIONS §4.9）。
    // 成功失敗都是 HTTP 200，用 success 欄位分辨（07 spec §三 API 9），
    // 帳號不存在跟密碼錯誤回傳同樣的訊息，不透露是哪一種失敗。
    try {
      const result = await adminLogin(account.trim(), password);
      if (result.success && result.token) {
        setStatus('success');
        setStoredAuth(true);
        setStoredAdminToken(result.token);
        setTimeout(() => {
          onLoginSuccess();
        }, 400);
      } else {
        setStatus('error');
        setErrorMessage('帳號或密碼錯誤，請確認後重試');
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(
        err instanceof ApiError
          ? `登入失敗：${err.message}`
          : '無法連線到後端伺服器，請確認伺服器是否已啟動'
      );
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-between py-8 px-4 sm:px-6 lg:px-8 font-sans text-slate-800">
      {/* Top Header Navigation */}
      <div className="max-w-md w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-sky-500 text-white flex items-center justify-center shadow-xs">
            <Shield className="h-4 w-4" />
          </div>
          <span className="font-black text-slate-900 tracking-tight text-base">GuardFrame</span>
          <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-100">
            Admin
          </span>
        </div>

        <button
          type="button"
          onClick={handleBackToUser}
          className="text-xs font-semibold text-slate-500 hover:text-sky-700 flex items-center gap-1 transition-colors cursor-pointer"
        >
          <Smartphone className="h-3.5 w-3.5" />
          <span>返回開戶前台</span>
        </button>
      </div>

      {/* Main Login Card */}
      <div className="max-w-md w-full mx-auto my-auto">
        <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-200/80 space-y-6">
          {/* Card Header & Mascot */}
          <div className="text-center space-y-2">
            <div className="flex justify-center mb-1">
              <AIGuardian size="md" mood={status === 'loading' ? 'thinking' : status === 'error' ? 'warning' : 'idle'} showBadge={false} />
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              GuardFrame 管理後台
            </h1>
            <p className="text-xs text-slate-400">
              登入以管理驗證案件
            </p>
          </div>

          {/* Alert Message Box */}
          {status === 'error' && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-700 flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          {status === 'empty' && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-semibold text-amber-800 flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {status === 'success' && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-800 flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>驗證成功，正在進入風控總覽...</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Account Input */}
            <div className="space-y-1.5 text-left">
              <label className="block text-xs font-bold text-slate-700">
                管理員帳號
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={account}
                  onChange={(e) => {
                    setAccount(e.target.value);
                    if (status !== 'loading') setStatus('initial');
                  }}
                  placeholder="admin@guardframe.demo"
                  disabled={status === 'loading'}
                  className="w-full text-xs pl-10 pr-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-sky-400 focus:outline-hidden focus:ring-2 focus:ring-sky-100 transition-all font-medium text-slate-800"
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1.5 text-left">
              <label className="block text-xs font-bold text-slate-700">
                登入密碼
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (status !== 'loading') setStatus('initial');
                  }}
                  placeholder="請輸入密碼"
                  disabled={status === 'loading'}
                  className="w-full text-xs pl-10 pr-10 py-3 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-sky-400 focus:outline-hidden focus:ring-2 focus:ring-sky-100 transition-all font-medium text-slate-800"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-1"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Quick Demo Autofill Pill */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleFillDemoAdmin}
                className="text-[11px] font-semibold text-sky-600 hover:text-sky-800 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Zap className="h-3 w-3 text-amber-500 fill-amber-400" />
                <span>⚡ 填入示範管理員帳密</span>
              </button>

              <span className="text-[10px] text-slate-400 font-mono">
                admin@guardframe.demo
              </span>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={status === 'loading' || status === 'success'}
              className="w-full py-3 px-4 rounded-xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white text-xs font-bold shadow-md shadow-sky-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {status === 'loading' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>登入中…</span>
                </>
              ) : status === 'success' ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>登入成功</span>
                </>
              ) : (
                <>
                  <span>登入</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Footer copyright */}
      <div className="max-w-md w-full mx-auto text-center text-xs text-slate-400">
        GuardFrame Financial Risk Management • Demo Version
      </div>
    </div>
  );
};
