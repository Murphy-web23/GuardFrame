import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Eye, ArrowLeft, ArrowRight, Hand, PlayCircle, ChevronLeft, ChevronRight, Check, Lock, Glasses } from 'lucide-react';

// 2026-08-29：使用者反饋——人臉驗證開始前，現在是邊做動作邊看文字/
// 語音提示，沒有機會事先知道接下來要做什麼，尤其對長輩使用者容易措手
// 不及。加一個動畫示範畫面，讓使用者在真正開始錄影前，先看一次接下來
// 動作分別長怎樣（不是文字說明，是真的有動畫示意），手機、桌面版共用
// 同一份元件。
//
// 2026-08-29（第二輪）：使用者反饋一次塞 5 格文字太小、太密，長輩看
// 不清楚。改成「一次只看一項」的輪播——圖示、文字都放大很多，用底下
// 的圓點導覽或左右箭頭切換，畫面乾淨好懂。
//
// 2026-08-29（第三輪）：使用者要求要完整看過全部 5 張示範，才能點下
// 「開始驗證」，避免有人一進來就直接跳過示範。用 seenIndexes 記錄看
// 過哪幾張（不限順序），全部看過前按鈕停用並顯示還差幾張。

interface ActionsDemoPreviewProps {
  onStart: () => void;
}

interface DemoItem {
  key: string;
  label: string;
  hint: string;
  render: () => React.ReactNode;
}

// 每個動作各自的示意動畫，用現有的 lucide icon 疊 motion 動畫做出來，
// 不用額外的動畫素材檔案。
const DEMO_ITEMS: DemoItem[] = [
  {
    key: 'blink',
    label: '眨眼',
    hint: '看著鏡頭，自然眨眼 1～2 次',
    render: () => (
      <motion.div
        animate={{ scaleY: [1, 1, 0.12, 1, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, times: [0, 0.4, 0.5, 0.6, 1] }}
      >
        <Eye className="h-16 w-16 text-sky-600" strokeWidth={2.2} />
      </motion.div>
    ),
  },
  {
    key: 'turn_left',
    label: '向左轉頭',
    hint: '臉部緩慢轉向左邊',
    render: () => (
      <motion.div
        animate={{ x: [0, -14, 0], rotate: [0, -18, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <ArrowLeft className="h-16 w-16 text-sky-600" strokeWidth={2.2} />
      </motion.div>
    ),
  },
  {
    key: 'turn_right',
    label: '向右轉頭',
    hint: '臉部緩慢轉向右邊',
    render: () => (
      <motion.div
        animate={{ x: [0, 14, 0], rotate: [0, 18, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <ArrowRight className="h-16 w-16 text-sky-600" strokeWidth={2.2} />
      </motion.div>
    ),
  },
  {
    key: 'wave',
    label: '臉前揮手',
    hint: '手抬到臉的高度，前後揮動',
    render: () => (
      <motion.div
        animate={{ rotate: [-18, 18, -18] }}
        style={{ transformOrigin: 'bottom center' }}
        transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Hand className="h-16 w-16 text-sky-600" strokeWidth={2.2} />
      </motion.div>
    ),
  },
  {
    key: 'lighting',
    label: '螢幕忽亮忽暗',
    hint: '請保持不動、臉正對鏡頭',
    // 2026-08-29：使用者提醒——除了動作之外，也該示範一下 Track3 會有
    // 的「螢幕連續切換亮度」，讓使用者知道那是正常的，並提醒這段期間
    // 要保持不動、臉朝向鏡頭，不要跟著亮度變化亂動。
    render: () => (
      <motion.div
        className="h-16 w-16 rounded-2xl border-2 border-slate-300"
        animate={{ backgroundColor: ['#fef9c3', '#1e293b', '#fef9c3', '#38bdf8', '#fef9c3'] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      />
    ),
  },
  {
    key: 'no_accessories',
    label: '拿下眼鏡、口罩、帽子',
    hint: '請先拿下眼鏡、口罩、帽子，讓臉部完整露出',
    // 2026-09-07：目前模型對戴眼鏡（口罩、帽子同理，會遮住臉部特徵）
    // 的真人辨識穩定度不足，容易誤判為人工複核。在補齊訓練資料前，
    // 先在驗證開始前提醒使用者拿下，降低這個已知情境出現的頻率。放在
    // 動畫示範卡片的最後一張，強迫使用者看完全部卡片才能開始驗證，
    // 比放在前一頁的文字提醒明顯。這是暫時的止血作法，不能取代之後
    // 補資料練模型。
    render: () => (
      <motion.div
        animate={{ opacity: [1, 0.25, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Glasses className="h-16 w-16 text-sky-600" strokeWidth={2.2} />
      </motion.div>
    ),
  },
];

const AUTO_ADVANCE_MS = 3200;

export const ActionsDemoPreview: React.FC<ActionsDemoPreviewProps> = ({ onStart }) => {
  const [index, setIndex] = useState(0);
  const [seenIndexes, setSeenIndexes] = useState<Set<number>>(() => new Set([0]));
  const total = DEMO_ITEMS.length;
  const current = DEMO_ITEMS[index];
  const hasSeenAll = seenIndexes.size >= total;
  const remainingCount = total - seenIndexes.size;

  // 自動輪播，使用者也可以隨時用圓點或左右箭頭手動切換（切換後計時器
  // 會重新開始，不會跟手動操作打架）。全部看過一輪之後就停止自動播
  // 放，讓使用者可以停在最後一張準備按「開始驗證」。
  useEffect(() => {
    if (hasSeenAll) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % total);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [index, total, hasSeenAll]);

  useEffect(() => {
    setSeenIndexes((prev) => (prev.has(index) ? prev : new Set(prev).add(index)));
  }, [index]);

  const goTo = (next: number) => setIndex(((next % total) + total) % total);

  return (
    <div className="w-full max-w-md mx-auto bg-white rounded-3xl border border-slate-200/80 shadow-xl p-6 space-y-5">
      <div className="text-center">
        <h3 className="text-lg font-black text-slate-900">先看一下等一下要做的動作</h3>
        <p className="text-sm text-slate-500 mt-1">系統會依序提示，順序隨機安排</p>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          aria-label="上一個"
          className="h-10 w-10 shrink-0 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="flex-1 min-w-0 rounded-2xl bg-sky-50/70 border border-sky-100 py-6 px-4 flex flex-col items-center gap-3">
          <AnimatePresence mode="wait">
            <motion.div
              key={current.key}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center gap-3"
            >
              <div className="h-24 w-24 rounded-full bg-white border-2 border-sky-200/80 flex items-center justify-center shadow-sm">
                {current.render()}
              </div>
              <div className="text-center">
                <p className="text-xl font-black text-slate-900">{current.label}</p>
                <p className="text-sm text-slate-500 mt-1">{current.hint}</p>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <button
          type="button"
          onClick={() => goTo(index + 1)}
          aria-label="下一個"
          className="h-10 w-10 shrink-0 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="flex items-center justify-center gap-2.5">
        {DEMO_ITEMS.map((item, i) => {
          const isSeen = seenIndexes.has(i);
          const isActive = i === index;
          return (
            <button
              key={item.key}
              type="button"
              aria-label={`看${item.label}`}
              onClick={() => goTo(i)}
              className={`h-6 w-6 rounded-full flex items-center justify-center transition-all cursor-pointer border-2 ${
                isActive
                  ? 'bg-sky-500 border-sky-500'
                  : isSeen
                  ? 'bg-sky-100 border-sky-300'
                  : 'bg-white border-slate-200'
              }`}
            >
              {isSeen && <Check className={`h-3.5 w-3.5 ${isActive ? 'text-white' : 'text-sky-500'}`} strokeWidth={3} />}
            </button>
          );
        })}
      </div>

      <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 text-sm text-slate-500 leading-relaxed text-center">
        {hasSeenAll
          ? '每個動作都有足夠時間完成，不用緊張，照著畫面提示自然做就好。'
          : `請看完全部 ${total} 張示範（還差 ${remainingCount} 張），就可以開始驗證。`}
      </div>

      {/* 2026-09-01：「靠近鏡頭」提醒原本放在這裡，使用者反饋不夠顯眼，
          已經搬到 FaceVerificationEngine.tsx 的 ready 階段中央取景框
          （按下開始鍵前最後、也最顯眼的畫面位置），這裡不用重複放。 */}

      <button
        type="button"
        onClick={onStart}
        disabled={!hasSeenAll}
        className={`w-full py-4 rounded-2xl font-bold text-base shadow-lg flex items-center justify-center gap-2 transition-all ${
          hasSeenAll
            ? 'bg-sky-500 hover:bg-sky-600 active:scale-[0.99] text-white shadow-sky-500/20 cursor-pointer'
            : 'bg-slate-100 text-slate-400 shadow-none cursor-not-allowed'
        }`}
      >
        {hasSeenAll ? <PlayCircle className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
        <span>{hasSeenAll ? '我知道了，開始驗證' : `看完全部示範才能開始（${seenIndexes.size}/${total}）`}</span>
      </button>
    </div>
  );
};
