import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GuardianMood } from '../types';
import { Check, Heart } from 'lucide-react';

interface AIGuardianProps {
  mood?: GuardianMood;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showBadge?: boolean;
  className?: string;
  onClick?: () => void;
}

export const AIGuardian: React.FC<AIGuardianProps> = ({
  mood = 'idle',
  size = 'md',
  showBadge = false,
  className = '',
  onClick,
}) => {
  const [isInteracted, setIsInteracted] = useState(false);

  // Scaled dimensions precisely matching the original soft pastel blue marshmallow capsule
  const sizeMap = {
    xs: {
      container: 34,
      body: 30,
      eyeW: 4.5,
      eyeH: 8,
      mouthW: 4.5,
      dotR: 4.5,
      aiBadge: 11,
      statusBadge: 13,
      checkIcon: 9,
      cheek: 3,
    },
    sm: {
      container: 48,
      body: 42,
      eyeW: 6,
      eyeH: 10.5,
      mouthW: 6,
      dotR: 5.5,
      aiBadge: 14,
      statusBadge: 16,
      checkIcon: 11,
      cheek: 4.5,
    },
    md: {
      container: 74,
      body: 64,
      eyeW: 9,
      eyeH: 16,
      mouthW: 9,
      dotR: 8,
      aiBadge: 20,
      statusBadge: 23,
      checkIcon: 15,
      cheek: 7,
    },
    lg: {
      container: 112,
      body: 98,
      eyeW: 14,
      eyeH: 24,
      mouthW: 14,
      dotR: 11,
      aiBadge: 28,
      statusBadge: 32,
      checkIcon: 20,
      cheek: 10,
    },
    xl: {
      container: 144,
      body: 124,
      eyeW: 17,
      eyeH: 30,
      mouthW: 17,
      dotR: 14,
      aiBadge: 34,
      statusBadge: 38,
      checkIcon: 24,
      cheek: 13,
    },
  };

  const dim = sizeMap[size];

  // Dynamic lively floating & bouncing variants according to mood
  const capsuleVariants = {
    idle: {
      y: [0, -8, 2, -5, 0],
      rotate: [0, 2, -2, 1, 0],
      transition: {
        duration: 3.2,
        repeat: Infinity,
        ease: 'easeInOut',
      },
    },
    welcoming: {
      // 歡迎首頁：輕輕歪頭 (可愛側傾角 + 輕快彈跳)
      y: [0, -14, 2, -8, 0],
      rotate: [6, 12, 5, 10, 6],
      scale: [1, 1.06, 0.98, 1.04, 1],
      transition: {
        duration: 2.2,
        repeat: Infinity,
        ease: 'easeInOut',
      },
    },
    scanning: {
      y: [0, -3, 0, -3, 0],
      scale: [1, 1.06, 0.96, 1.04, 1],
      transition: {
        duration: 1.4,
        repeat: Infinity,
        ease: 'easeInOut',
      },
    },
    thinking: {
      // 好奇時微傾
      y: [0, -7, 0],
      rotate: [0, 9, 12, 8, 0],
      transition: {
        duration: 2.4,
        repeat: Infinity,
        ease: 'easeInOut',
      },
    },
    guiding: {
      // 引導時輕柔上下點頭呼吸
      y: [0, -6, 2, -4, 0],
      rotate: [-2, 2, -2, 1, -2],
      transition: {
        duration: 2.4,
        repeat: Infinity,
        ease: 'easeInOut',
      },
    },
    success: {
      // 成功完成時雀躍高高彈跳
      y: [0, -18, 3, -10, 0],
      scale: [1, 1.14, 0.96, 1.07, 1],
      rotate: [0, -5, 5, -2, 0],
      transition: {
        duration: 1.3,
        repeat: Infinity,
        ease: 'easeOut',
      },
    },
    warning: {
      x: [-4, 4, -4, 4, -2, 2, 0],
      y: [0, -2, 0],
      transition: {
        duration: 0.7,
        repeat: Infinity,
        repeatDelay: 1.4,
      },
    },
  };

  // Top blue floating dot bouncing animation
  const topDotVariants = {
    idle: {
      y: [0, -5, 0],
      scale: [1, 1.15, 1],
      transition: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' },
    },
    welcoming: {
      y: [-3, -10, -3],
      x: [2, 6, 2],
      scale: [1, 1.25, 1],
      transition: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' },
    },
    scanning: {
      y: [0, -3, 0],
      scale: [1, 1.35, 0.9, 1.3, 1],
      transition: { duration: 0.8, repeat: Infinity },
    },
    success: {
      y: [-4, -14, -4],
      scale: [1, 1.35, 1],
      transition: { duration: 1.0, repeat: Infinity },
    },
    thinking: {
      y: [0, -4, 0],
      x: [0, 3, 0],
      transition: { duration: 2.0, repeat: Infinity },
    },
    guiding: {
      y: [-1, -5, -1],
      transition: { duration: 1.6, repeat: Infinity },
    },
    warning: {
      scale: [1, 1.25, 1],
      transition: { duration: 0.5, repeat: Infinity },
    },
  };

  // AI badge floating animation
  const aiBadgeVariants = {
    idle: {
      y: [0, -3, 0],
      rotate: [0, -3, 0],
      transition: { duration: 2.8, repeat: Infinity, ease: 'easeInOut', delay: 0.1 },
    },
    welcoming: {
      y: [-2, -7, -2],
      rotate: [2, 10, 2],
      scale: [1, 1.1, 1],
      transition: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' },
    },
    success: {
      y: [-4, -9, -4],
      scale: [1, 1.16, 1],
      rotate: [0, 8, -4, 0],
      transition: { duration: 1.1, repeat: Infinity },
    },
    scanning: {
      scale: [1, 1.08, 1],
      transition: { duration: 0.9, repeat: Infinity },
    },
    thinking: {
      y: [0, -4, 0],
      transition: { duration: 2.0, repeat: Infinity },
    },
    guiding: {
      y: [0, -3, 0],
      transition: { duration: 1.8, repeat: Infinity },
    },
    warning: {
      x: [-2, 2, -2],
      transition: { duration: 0.5, repeat: Infinity },
    },
  };

  const handleTap = () => {
    setIsInteracted(true);
    setTimeout(() => setIsInteracted(false), 900);
    onClick?.();
  };

  return (
    <motion.div
      id="ai-guardian-robot"
      whileHover={{ scale: 1.1, y: -3 }}
      whileTap={{ scale: 0.92 }}
      onClick={handleTap}
      className={`relative inline-flex items-center justify-center select-none cursor-pointer group ${className}`}
      style={{ width: dim.container, height: dim.container }}
      title="AI Guardian 守護助手（點擊互動）"
    >
      {/* 1. SOFT GLOWING BACKDROP AURA (Light Cyan / Blue from reference) */}
      <div
        className="absolute -inset-1.5 rounded-[38%] bg-sky-200/45 blur-[3px] pointer-events-none transition-colors duration-300"
      />

      {mood === 'success' && (
        <motion.div
          className="absolute inset-0 rounded-[38%] bg-emerald-300/35 blur-sm"
          animate={{ scale: [0.95, 1.2, 0.95], opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Interactive Heart on tap */}
      <AnimatePresence>
        {isInteracted && (
          <motion.div
            initial={{ scale: 0, y: 0, opacity: 1 }}
            animate={{ scale: 1.4, y: -26, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="absolute z-40 flex items-center justify-center text-rose-500 pointer-events-none"
          >
            <Heart className="h-5 w-5 fill-rose-500 text-rose-500" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. TOP BLUE FLOATING SIGNAL DOT (Original Screenshot Feature) */}
      <motion.div
        id="guardian-top-dot"
        variants={topDotVariants}
        animate={mood}
        className="absolute -top-2 z-20 flex items-center justify-center"
      >
        <span
          className="rounded-full bg-blue-500 shadow-xs shadow-blue-400/60"
          style={{ width: dim.dotR, height: dim.dotR }}
        />
      </motion.div>

      {/* 3. TOP-LEFT FLOATING "Ai" BADGE PILL (Original Screenshot Feature) */}
      {size !== 'xs' && (
        <motion.div
          id="guardian-ai-pill"
          variants={aiBadgeVariants}
          animate={mood}
          className="absolute -top-1 -left-1.5 z-20 flex items-center justify-center rounded-full bg-blue-50/95 border border-blue-200/90 text-blue-500 font-bold shadow-xs select-none"
          style={{
            width: dim.aiBadge,
            height: dim.aiBadge,
            fontSize: dim.aiBadge * 0.46,
          }}
        >
          Ai
        </motion.div>
      )}

      {/* 4. MAIN PASTEL LIGHT-BLUE SQUIRCLE BODY (Exact match of reference image) */}
      <motion.div
        id="guardian-body"
        variants={capsuleVariants}
        animate={mood}
        className={`relative flex flex-col items-center justify-center rounded-[34%] border transition-all duration-300 shadow-[0_8px_24px_rgba(56,189,248,0.16)] ${
          mood === 'success'
            ? 'bg-gradient-to-b from-sky-50 to-emerald-50/80 border-emerald-200/80 ring-2 ring-emerald-300'
            : mood === 'scanning'
            ? 'bg-gradient-to-b from-sky-50 to-sky-100/90 border-sky-300 ring-2 ring-sky-300'
            : mood === 'warning'
            ? 'bg-gradient-to-b from-amber-50/90 to-sky-50/80 border-amber-200/80 ring-2 ring-amber-300'
            : 'bg-gradient-to-b from-[#f0f7ff] via-[#e8f3fe] to-[#def0fe] border-[#cbe5fc]'
        }`}
        style={{
          width: dim.body,
          height: dim.body,
        }}
      >
        {/* Soft Glass highlight on top curved surface */}
        <div className="absolute top-1 inset-x-2 h-1/3 rounded-t-[30%] bg-gradient-to-b from-white/90 to-transparent pointer-events-none" />

        {/* EYES CONTAINER: 動態神情轉換（平常/引導: 橢圓自動眨眼, 歡迎/成功: 歡喜彎月 ^ ^, 掃描: 科技脈衝） */}
        <div className="relative z-10 flex w-full items-center justify-center gap-[22%] pt-0.5">
          {/* LEFT EYE */}
          {mood === 'welcoming' || mood === 'success' ? (
            // 歡迎與成功時：歡喜微笑弧度（^ ^）
            <motion.div
              animate={{ y: [0, -1.5, 0], scale: [1, 1.12, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            >
              <svg
                width={dim.eyeW * 1.8}
                height={dim.eyeH * 0.85}
                viewBox="0 0 16 12"
                className={mood === 'success' ? 'text-emerald-700' : 'text-[#1e293b]'}
              >
                <path
                  d="M2 9 Q8 1.5 14 9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.4"
                  strokeLinecap="round"
                />
              </svg>
            </motion.div>
          ) : mood === 'scanning' ? (
            // 掃描核驗時：眼睛呈現科技節奏跳動與光束感
            <motion.div
              animate={{ scaleY: [1, 0.3, 1.25, 0.6, 1] }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
              className="bg-sky-600 rounded-full shadow-[0_0_6px_#38bdf8]"
              style={{ width: dim.eyeW, height: dim.eyeH }}
            />
          ) : mood === 'thinking' ? (
            // 好奇思考時：眼睛微上挑
            <motion.div
              animate={{ y: [0, -1.8, 0] }}
              transition={{ duration: 2.2, repeat: Infinity }}
              className="bg-[#1e293b] rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.15)] origin-center"
              style={{ width: dim.eyeW, height: dim.eyeH * 0.85 }}
            />
          ) : (
            // 平常與引導時：自然有機眨眼
            <motion.div
              id="guardian-left-eye"
              className="bg-[#1e293b] rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.15)] origin-center"
              style={{ width: dim.eyeW, height: dim.eyeH }}
              animate={{
                scaleY: [1, 1, 0.08, 1, 1, 1, 0.08, 1],
                scaleX: [1, 1, 1.15, 1, 1, 1, 1.15, 1],
              }}
              transition={{
                duration: 3.4,
                repeat: Infinity,
                times: [0, 0.42, 0.45, 0.49, 0.82, 0.85, 0.89, 1],
                ease: 'easeInOut',
              }}
            />
          )}

          {/* RIGHT EYE */}
          {mood === 'welcoming' || mood === 'success' ? (
            // 歡迎與成功時：歡喜微笑弧度（^ ^）
            <motion.div
              animate={{ y: [0, -1.5, 0], scale: [1, 1.12, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, delay: 0.04 }}
            >
              <svg
                width={dim.eyeW * 1.8}
                height={dim.eyeH * 0.85}
                viewBox="0 0 16 12"
                className={mood === 'success' ? 'text-emerald-700' : 'text-[#1e293b]'}
              >
                <path
                  d="M2 9 Q8 1.5 14 9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.4"
                  strokeLinecap="round"
                />
              </svg>
            </motion.div>
          ) : mood === 'scanning' ? (
            // 掃描核驗時：眼睛呈現科技節奏跳動與光束感
            <motion.div
              animate={{ scaleY: [1.25, 0.6, 1, 0.3, 1.25] }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
              className="bg-sky-600 rounded-full shadow-[0_0_6px_#38bdf8]"
              style={{ width: dim.eyeW, height: dim.eyeH }}
            />
          ) : mood === 'thinking' ? (
            <motion.div
              animate={{ y: [0, -1.8, 0] }}
              transition={{ duration: 2.2, repeat: Infinity }}
              className="bg-[#1e293b] rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.15)] origin-center"
              style={{ width: dim.eyeW, height: dim.eyeH * 0.85 }}
            />
          ) : (
            // 平常與引導時：自然有機眨眼
            <motion.div
              id="guardian-right-eye"
              className="bg-[#1e293b] rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.15)] origin-center"
              style={{ width: dim.eyeW, height: dim.eyeH }}
              animate={{
                scaleY: [1, 1, 0.08, 1, 1, 1, 0.08, 1],
                scaleX: [1, 1, 1.15, 1, 1, 1, 1.15, 1],
              }}
              transition={{
                duration: 3.4,
                repeat: Infinity,
                times: [0, 0.42, 0.45, 0.49, 0.82, 0.85, 0.89, 1],
                delay: 0.02,
                ease: 'easeInOut',
              }}
            />
          )}
        </div>

        {/* CUTE SUBTLE HORIZONTAL DASH MOUTH */}
        {size !== 'xs' && (
          <div className="mt-1 flex items-center justify-center z-10">
            {mood === 'welcoming' || mood === 'success' ? (
              <motion.div
                animate={{ scaleX: [1, 1.2, 1] }}
                transition={{ duration: 1.4, repeat: Infinity }}
                className="h-0.5 rounded-full bg-[#1e293b]"
                style={{ width: dim.mouthW }}
              />
            ) : (
              <div
                className="h-0.5 rounded-full bg-[#334155]"
                style={{ width: dim.mouthW * 0.75 }}
              />
            )}
          </div>
        )}

        {/* CUTE LIGHT PINK OVAL CHEEKS */}
        {size !== 'xs' && (
          <div className="absolute inset-x-2 bottom-2.5 flex justify-between px-1 pointer-events-none">
            <span
              className="rounded-full bg-[#fca5a5]/75"
              style={{ width: dim.cheek * 1.3, height: dim.cheek }}
            />
            <span
              className="rounded-full bg-[#fca5a5]/75"
              style={{ width: dim.cheek * 1.3, height: dim.cheek }}
            />
          </div>
        )}

        {/* 掃描雷射光束 (僅在掃描核驗時出現) */}
        {mood === 'scanning' && (
          <motion.div
            className="absolute inset-x-2 h-0.5 bg-sky-400 shadow-[0_0_8px_#38bdf8] z-20 rounded-full"
            animate={{ top: ['15%', '85%', '15%'] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </motion.div>

      {/* 5. BOTTOM-RIGHT GREEN/BLUE CIRCLE CHECKMARK BADGE */}
      {(showBadge || mood === 'success') && (
        <motion.div
          id="guardian-status-badge"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          whileHover={{ scale: 1.15 }}
          className="absolute -bottom-1 -right-1 z-30 flex items-center justify-center rounded-full bg-white/95 border border-emerald-300 shadow-xs"
          style={{
            width: dim.statusBadge,
            height: dim.statusBadge,
          }}
        >
          <div className="flex items-center justify-center rounded-full bg-emerald-50 text-emerald-600 w-full h-full">
            <Check
              className="stroke-[3.5]"
              style={{ width: dim.checkIcon, height: dim.checkIcon }}
            />
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};
