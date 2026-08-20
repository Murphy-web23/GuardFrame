import React from 'react';
import { RiskLevel } from '../../../types';
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';

interface RiskBadgeProps {
  level: RiskLevel;
  showIcon?: boolean;
}

export const RiskBadge: React.FC<RiskBadgeProps> = ({ level, showIcon = true }) => {
  const configs: Record<string, { label: string; fullName: string; bg: string; dot: string; icon: React.ComponentType<{ className?: string }> }> = {
    low: {
      label: 'Low',
      fullName: '低風險',
      bg: 'bg-emerald-50 text-emerald-700 border-emerald-200/70',
      dot: 'bg-emerald-500',
      icon: ShieldCheck,
    },
    medium: {
      label: 'Medium',
      fullName: '中風險',
      bg: 'bg-sky-50 text-sky-700 border-sky-200/70',
      dot: 'bg-sky-500',
      icon: Shield,
    },
    high: {
      label: 'High',
      fullName: '高風險',
      bg: 'bg-rose-50 text-rose-700 border-rose-200/70',
      dot: 'bg-rose-500',
      icon: ShieldAlert,
    },
  };

  const config = configs[level] || configs.low;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-bold border ${config.bg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      <span>{config.label}</span>
      <span className="text-[10px] opacity-75 font-normal">({config.fullName})</span>
    </span>
  );
};
