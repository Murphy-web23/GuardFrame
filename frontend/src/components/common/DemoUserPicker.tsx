import React, { useState, useRef, useEffect } from 'react';
import { demoUsers, DemoUser } from '../../data/demoUsers';
import { FormData } from '../../types';
import { Sparkles, ChevronDown, Check, UserCheck, Zap } from 'lucide-react';

interface DemoUserPickerProps {
  onSelectUser: (user: DemoUser) => void;
  className?: string;
}

export const DemoUserPicker: React.FC<DemoUserPickerProps> = ({
  onSelectUser,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePick = (user: DemoUser) => {
    setSelectedId(user.id);
    onSelectUser(user);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Secondary Button Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full sm:w-auto inline-flex items-center justify-between sm:justify-start gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200/80 bg-slate-50/80 hover:bg-sky-50/70 hover:border-sky-200 text-slate-700 hover:text-sky-700 text-xs font-semibold transition-all cursor-pointer shadow-2xs"
      >
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-400" />
          <span>⚡ 填入示範資料</span>
        </div>
        <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 right-0 sm:right-auto mt-1.5 sm:w-80 bg-white rounded-2xl shadow-xl border border-slate-200/90 p-2 z-40 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-2.5 py-1.5 mb-1 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              選擇示範使用者 (Demo User)
            </span>
            <span className="text-[10px] text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded font-mono font-bold">
              5 組
            </span>
          </div>

          <div className="space-y-1">
            {demoUsers.map((user, idx) => {
              const isSelected = selectedId === user.id;
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => handlePick(user)}
                  className={`w-full text-left px-2.5 py-2 rounded-xl text-xs transition-colors flex items-center justify-between group cursor-pointer ${
                    isSelected
                      ? 'bg-sky-50 text-sky-900 font-bold border border-sky-100'
                      : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-lg bg-slate-100 group-hover:bg-sky-100 text-slate-500 group-hover:text-sky-700 text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                      0{idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 group-hover:text-sky-700 flex items-center gap-1.5">
                        <span className="shrink-0">{user.fullName}</span>
                        <span className="text-[11px] font-normal text-slate-400 font-mono truncate">
                          {user.idNumber}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {user.phone} • {user.birthday}
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="h-3.5 w-3.5 text-sky-600 shrink-0 ml-1" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-1.5 pt-1.5 border-t border-slate-100 text-center">
            <span className="text-[10px] text-slate-400">
              💡 點選後自動填入完整基本資料（含 Email 及戶籍地址）
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
