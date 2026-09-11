import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { demoUsers, DemoUser } from '../../data/demoUsers';
import { FormData } from '../../types';
import { Sparkles, ChevronDown, Check, UserCheck, Zap } from 'lucide-react';

interface DemoUserPickerProps {
  onSelectUser: (user: DemoUser) => void;
  className?: string;
}

// 正式展示（例如專題發表）時關掉這顆按鈕，避免介面上出現「一鍵填入示範
// 資料」這種看起來像測試用途的設計；開發/自己測試時改回 true 即可，不用
// 動到四個呼叫端（BasicInfoScreen/SmsVerifyScreen 的手機版和桌面版）。
const SHOW_DEMO_PICKER = false;

export const DemoUserPicker: React.FC<DemoUserPickerProps> = ({
  onSelectUser,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 2026-08-28：原本下拉選單是 position: absolute，掛在觸發按鈕旁邊的
  // 一般文件流裡——真人手機測試（iOS、Android 都一樣）回報清單顯示
  // 不全，下半部被一塊空白區域擋住，畫面只能滑動上半部。追查原因：
  // 這個下拉選單活在手機版共用的滾動容器（MobileLayout.tsx 的
  // #mobile-scrollable-content，overflow-y-auto）裡面，絕對定位的元素
  // 不一定會被滾動容器正確納入 scrollHeight 計算，導致選單下半部
  // 被滾動容器的可視高度直接裁掉、滑動也滑不到那塊。改成用
  // createPortal 把選單整個掛到 document.body 底下、用 position:
  // fixed 對齊觸發按鈕的位置，不再依賴任何父層滾動容器的高度計算，
  // 這是這類問題最穩定的解法。
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(
    null
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  // 2026-08-28：選單現在是 portal 掛在 document.body，不再是
  // containerRef 底下的 DOM 子節點，只檢查 containerRef.contains()
  // 的話，點選單裡的項目會被誤判成「點了外面」，選單在 onClick 真的
  // 觸發前就被關掉。這裡多檢查一個 menuRef。
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!menuRef.current || !menuRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 開啟時量觸發按鈕在畫面上的實際位置，換算成 position: fixed 的座標
  // ——用 window.innerWidth 夾住右邊界，避免選單在窄螢幕上超出畫面。
  useEffect(() => {
    if (!isOpen || !triggerRef.current) {
      setMenuPos(null);
      return;
    }
    const updatePosition = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const desiredWidth = Math.max(rect.width, 320);
      const left = Math.min(rect.left, window.innerWidth - desiredWidth - 12);
      setMenuPos({
        top: rect.bottom + 6,
        left: Math.max(12, left),
        width: Math.min(desiredWidth, window.innerWidth - 24),
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  const handlePick = (user: DemoUser) => {
    setSelectedId(user.id);
    onSelectUser(user);
    setIsOpen(false);
  };

  if (!SHOW_DEMO_PICKER) return null;

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Secondary Button Trigger */}
      <button
        ref={triggerRef}
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

      {/* Dropdown Menu：portal 到 document.body，position: fixed 定位，
          見上方 menuPos 那個 useEffect 的說明。maxHeight + overflow-y-
          auto 讓選單自己在螢幕高度不夠時內部捲動，不依賴外層滾動容器。 */}
      {isOpen &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: `calc(100vh - ${menuPos.top}px - 16px)`,
              zIndex: 1000,
            }}
            className="overflow-y-auto bg-white rounded-2xl shadow-xl border border-slate-200/90 p-2 animate-in fade-in zoom-in-95 duration-150"
          >
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
          </div>,
          document.body
        )}
    </div>
  );
};
