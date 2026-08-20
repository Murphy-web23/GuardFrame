import React, { useState, useEffect } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';

interface SessionCountdownBadgeProps {
  startTime?: number | null;
  totalSeconds?: number;
  compact?: boolean;
  label?: string;
  className?: string;
}

export const SessionCountdownBadge: React.FC<SessionCountdownBadgeProps> = ({
  startTime,
  totalSeconds = 900, // 15 minutes default for session
  compact = false,
  label,
  className = '',
}) => {
  // If no startTime provided, default to a stored/initialized session time
  const [sessionStartTime] = useState<number>(() => startTime || Date.now());
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    const elapsed = Math.floor((Date.now() - (startTime || sessionStartTime)) / 1000);
    return Math.max(0, totalSeconds - elapsed);
  });

  useEffect(() => {
    const effectiveStart = startTime || sessionStartTime;
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - effectiveStart) / 1000);
      const remaining = Math.max(0, totalSeconds - elapsed);
      setRemainingSeconds(remaining);
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, sessionStartTime, totalSeconds]);

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const isWarning = remainingSeconds <= 120; // less than 2 minutes
  const isExpired = remainingSeconds === 0;

  const defaultLabel = label !== undefined ? label : compact ? '' : '操作時效：';

  return (
    <div
      title={
        isExpired
          ? '操作時效已結束，請重新開始'
          : `操作剩餘時間：${formattedTime}`
      }
      className={`inline-flex items-center gap-1.5 transition-all select-none ${
        compact
          ? 'px-2.5 py-1 rounded-full text-[11px] font-mono font-bold'
          : 'px-3 py-1.5 rounded-xl text-xs font-semibold'
      } ${
        isExpired
          ? 'bg-rose-50 text-rose-700 border border-rose-200'
          : isWarning
          ? 'bg-amber-50 text-amber-800 border border-amber-200 animate-pulse'
          : 'bg-sky-50 text-sky-800 border border-sky-200/70 shadow-2xs'
      } ${className}`}
    >
      {isWarning ? (
        <AlertTriangle className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} text-amber-600 shrink-0`} />
      ) : (
        <Clock className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} text-sky-600 shrink-0 animate-pulse`} />
      )}

      {defaultLabel && (
        <span className="font-sans text-[10px] sm:text-[11px] font-medium text-slate-500">
          {defaultLabel}
        </span>
      )}

      <span className={`font-mono font-black tracking-wider ${
        isExpired ? 'text-rose-600' : isWarning ? 'text-amber-700' : 'text-sky-900'
      }`}>
        {formattedTime}
      </span>
    </div>
  );
};
