import React from 'react';
import { VerificationStatus, HandlingStatus } from '../../../types';
import { CheckCircle2, Clock, AlertTriangle, XCircle, UserCheck } from 'lucide-react';

interface StatusBadgeProps {
  status: VerificationStatus;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const configs: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; bg: string }> = {
    passed: {
      label: '已通過',
      icon: CheckCircle2,
      bg: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    },
    pending: {
      label: '待審核',
      icon: Clock,
      bg: 'bg-sky-50 text-sky-700 border-sky-200/80',
    },
    high_risk: {
      label: '高風險',
      icon: AlertTriangle,
      bg: 'bg-rose-50 text-rose-700 border-rose-200/80',
    },
    failed: {
      label: '未通過',
      icon: XCircle,
      bg: 'bg-slate-100 text-slate-700 border-slate-200',
    },
    flagged: {
      label: '已處置',
      icon: UserCheck,
      bg: 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
    },
  };

  const config = configs[status] || configs.pending;
  const Icon = config.icon;
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-[11px] gap-1' : 'px-2.5 py-1 text-xs gap-1.5';

  return (
    <span className={`inline-flex items-center font-bold rounded-lg border ${config.bg} ${sizeClasses}`}>
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      <span>{config.label}</span>
    </span>
  );
};

export const HandlingStatusBadge: React.FC<{ status: HandlingStatus }> = ({ status }) => {
  const configs: Record<string, { label: string; bg: string }> = {
    completed: {
      label: '處理完成',
      bg: 'text-slate-600 bg-slate-100 border-slate-200',
    },
    manual_review: {
      label: '人工審核中',
      bg: 'text-sky-700 bg-sky-50 border-sky-200',
    },
    action_required: {
      label: '需要處理',
      bg: 'text-amber-700 bg-amber-50 border-amber-200',
    },
  };

  const config = configs[status] || configs.completed;

  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md border ${config.bg}`}>
      {config.label}
    </span>
  );
};
