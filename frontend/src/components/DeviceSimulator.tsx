import React, { useState, useEffect } from 'react';
import { OnboardingStep, GuardianMood, FormData } from '../types';
import { AIGuardian } from './AIGuardian';
import { 
  Smartphone, 
  Monitor, 
  Sparkles, 
  Wifi, 
  Battery, 
  Signal, 
  Laptop,
  Compass
} from 'lucide-react';

export type ViewMode = 'auto' | 'mobile' | 'desktop';

interface DeviceSimulatorProps {
  currentStep: OnboardingStep;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  formData?: FormData;
  appMode?: 'user_onboarding' | 'admin';
  onSwitchToAdmin?: () => void;
  children: React.ReactNode;
}

export const DeviceSimulator: React.FC<DeviceSimulatorProps> = ({
  currentStep,
  viewMode,
  onViewModeChange,
  formData,
  onSwitchToAdmin,
  children,
}) => {
  const [testMood, setTestMood] = useState<GuardianMood | null>(null);
  const [currentTime, setCurrentTime] = useState<string>('09:41');
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const mins = now.getMinutes().toString().padStart(2, '0');
      setCurrentTime(`${hours}:${mins}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  const moodsList: { mood: GuardianMood; label: string }[] = [
    { mood: 'idle', label: '平常' },
    { mood: 'welcoming', label: '歡迎' },
    { mood: 'scanning', label: '掃描' },
    { mood: 'thinking', label: '運算' },
    { mood: 'success', label: '成功' },
    { mood: 'guiding', label: '提示' },
    { mood: 'warning', label: '警示' },
  ];

  const isDesktop = viewMode === 'desktop' || (viewMode === 'auto' && windowWidth >= 1024);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-start py-3 px-2 sm:py-4 sm:px-4 text-slate-800 antialiased">
      {/* Top Designer & Inspection Control Bar */}
      <div className="w-full max-w-7xl mb-4 bg-white/95 backdrop-blur-md px-4 py-3 rounded-2xl border border-slate-200/90 shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* Brand Info & Mode Indicator */}
        <div className="flex items-center gap-3">
          <AIGuardian size="sm" mood={testMood || 'idle'} showBadge={false} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-sm tracking-tight text-slate-900">
                GuardFrame
              </span>
              <span className="bg-sky-50 text-sky-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-sky-200/70">
                Friendly Fintech
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              6-Step Digital Banking Onboarding & Identity Guard
            </p>
          </div>
        </div>

        {/* Device Mode Switcher */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/80">
          <button
            type="button"
            onClick={() => onViewModeChange('mobile')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              viewMode === 'mobile'
                ? 'bg-white text-sky-600 shadow-xs font-bold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
            title="手機模式 (390×844 模擬框)"
          >
            <Smartphone className="h-3.5 w-3.5" />
            <span>手機模式</span>
          </button>

          <button
            type="button"
            onClick={() => onViewModeChange('desktop')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              viewMode === 'desktop'
                ? 'bg-white text-sky-600 shadow-xs font-bold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
            title="桌面工作台 (1440×900 多欄佈局)"
          >
            <Laptop className="h-3.5 w-3.5" />
            <span>桌面工作台</span>
          </button>

          <button
            type="button"
            onClick={() => onViewModeChange('auto')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              viewMode === 'auto'
                ? 'bg-white text-sky-600 shadow-xs font-bold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
            title="自動響應 (根據瀏覽器視窗自動切換)"
          >
            <Compass className="h-3.5 w-3.5" />
            <span>自動響應</span>
          </button>
        </div>

        {/* Switch to Admin Risk Dashboard */}
        {onSwitchToAdmin && (
          <button
            type="button"
            onClick={onSwitchToAdmin}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
          >
            <Monitor className="h-3.5 w-3.5 text-sky-400" />
            <span>管理員入口</span>
            <span className="bg-slate-800 text-sky-300 text-[10px] px-1.5 py-0.5 rounded font-mono">
              /admin
            </span>
          </button>
        )}
      </div>

      {/* Main Viewport Container */}
      <div className="w-full flex-1 flex items-start justify-center">
        {viewMode === 'desktop' || (viewMode === 'auto' && windowWidth >= 1024) ? (
          /* Desktop 1440x900 Application View */
          <div className="w-full max-w-7xl transition-all duration-300">
            {children}
          </div>
        ) : (
          /* Realistic Mobile Phone Framing (390x844 with true vertical scrolling) */
          <div className="flex flex-col items-center py-2">
            <div
              id="mobile-phone-frame"
              className="relative w-[390px] h-[844px] max-w-full bg-slate-900 rounded-[52px] p-3 shadow-2xl shadow-sky-950/20 border-4 border-slate-800 ring-1 ring-slate-900/10 flex flex-col overflow-hidden select-none transition-all"
            >
              {/* Screen Glass Bezel */}
              <div className="relative w-full h-full bg-white rounded-[42px] overflow-hidden flex flex-col">
                {/* iOS Status Bar & Dynamic Island */}
                <div className="sticky top-0 z-30 w-full h-11 bg-white flex items-center justify-between px-6 shrink-0 select-none border-b border-slate-100/50">
                  {/* Time */}
                  <span className="text-xs font-semibold text-slate-800 tracking-tight">
                    {currentTime}
                  </span>

                  {/* Dynamic Island Capsule */}
                  <div className="h-5 w-24 bg-slate-900 rounded-full flex items-center justify-end px-2 gap-1.5 shadow-xs">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-800" />
                  </div>

                  {/* Icons */}
                  <div className="flex items-center gap-1.5 text-slate-800">
                    <Signal className="h-3 w-3" />
                    <Wifi className="h-3 w-3" />
                    <Battery className="h-3.5 w-3.5 text-slate-800" />
                  </div>
                </div>

                {/* Truly Scrollable Screen Content */}
                <div className="flex-1 flex flex-col overflow-y-auto min-h-0 bg-white">
                  {children}
                </div>

                {/* Bottom Home Indicator */}
                <div className="w-full h-5 bg-white flex items-center justify-center shrink-0 border-t border-slate-50">
                  <div className="h-1 w-32 bg-slate-300 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mascot Mood Gallery / Inspector Footer */}
      <div className="w-full max-w-7xl mt-4 bg-white/90 backdrop-blur-md p-3.5 rounded-2xl border border-slate-200/90 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-sky-500" />
          <span className="text-xs font-bold text-slate-800">
            AI Guardian 守護者表情檢核台：
          </span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {moodsList.map((m) => (
            <button
              key={m.mood}
              onClick={() => setTestMood(m.mood)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-50 hover:bg-sky-50 border border-slate-200/60 transition-all cursor-pointer"
            >
              <AIGuardian size="xs" mood={m.mood} />
              <span className="text-[11px] font-medium text-slate-600">
                {m.label} ({m.mood})
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
