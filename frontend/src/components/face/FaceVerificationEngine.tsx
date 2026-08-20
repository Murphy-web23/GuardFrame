import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AIGuardian } from '../AIGuardian';
import { GuardianMood } from '../../types';
import { 
  CheckCircle2, 
  ShieldCheck, 
  ArrowRight,
  ArrowLeft,
  Eye,
  ScanFace,
  Hand,
  SunMedium,
  CheckCheck,
  Volume2,
  VolumeX,
  Play,
  Check
} from 'lucide-react';

export type ChallengeType = 'blink' | 'turn_left' | 'turn_right' | 'wave';
export type OverallStage = 'ready' | 'verifying_actions' | 'track3_photometric' | 'processing' | 'success' | 'error';
export type PhotometricSubState = 'prep' | 'holding' | 'analyzing' | 'completed';

export interface ChallengeConfig {
  type: ChallengeType;
  title: string;
  sub: string;
  durationSec: number;
  voiceText: string;
  icon: React.ComponentType<{ className?: string }>;
  emoji: string;
}

// 4 Challenge Configurations with exact durations and voice lines
export const CHALLENGE_MAP: Record<ChallengeType, ChallengeConfig> = {
  blink: {
    type: 'blink',
    title: '請眨眼',
    sub: '自然眨眼 1 ~ 2 次，確認動態活體特徵',
    durationSec: 3, // 3 seconds
    voiceText: '請眨眼。',
    icon: Eye,
    emoji: '👁️',
  },
  turn_left: {
    type: 'turn_left',
    title: '請向左轉頭',
    sub: '請向左轉動您的臉部約 15 ~ 20 度',
    durationSec: 5, // 5 seconds
    voiceText: '請向左轉動您的臉部。',
    icon: ArrowLeft,
    emoji: '👈',
  },
  turn_right: {
    type: 'turn_right',
    title: '請向右轉頭',
    sub: '請向右轉動您的臉部約 15 ~ 20 度',
    durationSec: 5, // 5 seconds
    voiceText: '請向右轉動您的臉部。',
    icon: ArrowRight,
    emoji: '👉',
  },
  wave: {
    type: 'wave',
    title: '請在臉部前方揮手至少 2 次',
    sub: '在臉部前方左右自然揮動手部至少兩次',
    durationSec: 5, // 5 seconds
    voiceText: '請在臉部前方揮手至少兩次。',
    icon: Hand,
    emoji: '👋',
  },
};

// Default Mock Challenge Sequence (4 actions, each appearing exactly once)
export const DEFAULT_MOCK_CHALLENGE_SEQUENCE: ChallengeType[] = [
  'turn_left',
  'wave',
  'blink',
  'turn_right',
];

// Helper to generate a random permutation of the 4 actions
export const generateRandomChallengeSequence = (): ChallengeType[] => {
  const pool: ChallengeType[] = ['blink', 'turn_left', 'turn_right', 'wave'];
  return [...pool].sort(() => Math.random() - 0.5);
};

interface FaceVerificationEngineProps {
  challengeSequence?: ChallengeType[];
  onVerificationComplete: (confidence: number, photometricPassed?: boolean) => void;
  onProceedNext: () => void;
  isDesktop?: boolean;
}

export const FaceVerificationEngine: React.FC<FaceVerificationEngineProps> = ({
  challengeSequence = DEFAULT_MOCK_CHALLENGE_SEQUENCE,
  onVerificationComplete,
  onProceedNext,
  isDesktop = false,
}) => {
  // Total Verification Time is strictly 23 seconds (3 + 5 + 5 + 5 + 5 = 23)
  const TOTAL_SESSION_SECONDS = 23;
  const [totalSecondsRemaining, setTotalSecondsRemaining] = useState<number>(TOTAL_SESSION_SECONDS);

  // Active Challenge sequence (4 actions)
  const [activeSequence, setActiveSequence] = useState<ChallengeType[]>(challengeSequence);
  const [overallStage, setOverallStage] = useState<OverallStage>('ready');
  const [currentChallengeIndex, setCurrentChallengeIndex] = useState<number>(0);
  const [currentCountdown, setCurrentCountdown] = useState<number>(5);
  const [challengeState, setChallengeState] = useState<'active' | 'completed'>('active');

  // Wave Challenge Progress: waveCount (0, 1, 2) within the single 5s wave challenge
  const [waveCount, setWaveCount] = useState<number>(0);

  // Track 3 Photometric States (5 seconds total)
  const [photoSubState, setPhotoSubState] = useState<PhotometricSubState>('prep');
  const [photoCountdown, setPhotoCountdown] = useState<number>(5);

  // Voice Guidance Settings & Audio Controller
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  const lastSpokenKeyRef = useRef<string>('');
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const availableVoicesRef = useRef<SpeechSynthesisVoice[]>([]);

  // Camera feed states
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [useSimulatedFeed, setUseSimulatedFeed] = useState<boolean>(false);
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Pre-fetch speech synthesis voices
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const updateVoices = () => {
        try {
          availableVoicesRef.current = window.speechSynthesis.getVoices() || [];
        } catch (_) {}
      };
      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  // Helper for Web Audio sound cues to guarantee audible tone on all browsers & mobile devices
  const playAudioCue = (type: 'action' | 'success' | 'wave') => {
    if (!voiceEnabled || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      if (type === 'action') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.12); // G5
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'wave') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now); // A5
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
        osc.frequency.setValueAtTime(1046.5, now + 0.24); // C6
        gain.gain.setValueAtTime(0.28, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc.start(now);
        osc.stop(now + 0.55);
      }
    } catch (_) {}
  };

  // Web Speech API Voice Prompt Helper (with GC retention, delay safeguard & voice selection)
  const speakPrompt = (text: string, uniqueKey: string) => {
    if (!voiceEnabled) return;
    if (lastSpokenKeyRef.current === uniqueKey) return; // Prevent duplicate triggers

    lastSpokenKeyRef.current = uniqueKey;

    // 1. Play audible synthesizer cue tone immediately
    if (uniqueKey === 'verification_success' || uniqueKey === 'track3_completed') {
      playAudioCue('success');
    } else {
      playAudioCue('action');
    }

    // 2. Play Web Speech API Spoken Voice
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      // Cancel previous speech safely
      window.speechSynthesis.cancel();

      // Micro-timeout prevents Chromium bug where cancel() cancels the immediate next speak()
      setTimeout(() => {
        try {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'zh-TW';
          utterance.rate = 1.05;
          utterance.pitch = 1.0;
          utterance.volume = 1.0;

          const voices = availableVoicesRef.current.length > 0 
            ? availableVoicesRef.current 
            : window.speechSynthesis.getVoices() || [];
          
          const twVoice = voices.find(
            (v) => v.lang === 'zh-TW' || v.lang === 'zh_TW' || v.lang === 'cmn-Hant-TW' || v.lang.includes('TW') || v.lang === 'zh-HK'
          ) || voices.find((v) => v.lang.startsWith('zh'));

          if (twVoice) {
            utterance.voice = twVoice;
          }

          // Retain ref to prevent V8 garbage collection
          activeUtteranceRef.current = utterance;
          utterance.onend = () => {
            activeUtteranceRef.current = null;
          };
          utterance.onerror = () => {
            activeUtteranceRef.current = null;
          };

          window.speechSynthesis.speak(utterance);
        } catch (innerErr) {
          console.warn('SpeechSynthesis speak failed:', innerErr);
        }
      }, 50);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
    }
  };

  // Initialize camera
  const startCamera = async () => {
    try {
      setCameraErrorMsg(null);
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }

        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: 'user',
            width: { ideal: isDesktop ? 1280 : 720 },
            height: { ideal: isDesktop ? 720 : 960 },
          },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        setCameraActive(true);
        setUseSimulatedFeed(false);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (playErr) {
            console.log('Autoplay handled', playErr);
          }
        }
      } else {
        throw new Error('瀏覽器不支援相機 API');
      }
    } catch (err: any) {
      console.warn('Real camera error / fallback:', err);
      setCameraErrorMsg(err?.message || '未能獲取相機授權');
      setCameraActive(true);
      setUseSimulatedFeed(true);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  // Video feed binding
  useEffect(() => {
    if (videoRef.current && streamRef.current && !useSimulatedFeed) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch((e) => console.log('Video play error:', e));
    }
  }, [useSimulatedFeed, cameraActive]);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  // Global 23-Second Overall Verification Countdown
  useEffect(() => {
    let globalTimer: any;
    if (overallStage === 'verifying_actions' || overallStage === 'track3_photometric') {
      globalTimer = setInterval(() => {
        setTotalSecondsRemaining((prev) => (prev > 1 ? prev - 1 : 1));
      }, 1000);
    }
    return () => clearInterval(globalTimer);
  }, [overallStage]);

  // Action Sequence Management & Individual Countdown Loop (Steps 1 to 4)
  useEffect(() => {
    let timer: any;
    if (overallStage === 'verifying_actions') {
      const currentType = activeSequence[currentChallengeIndex];
      const currentDef = CHALLENGE_MAP[currentType] || CHALLENGE_MAP.blink;

      // Speak prompt ONCE when entering this challenge step
      speakPrompt(currentDef.voiceText, `challenge_step_${currentChallengeIndex}_${currentType}`);

      setChallengeState('active');
      setWaveCount(0);
      let countdown = currentDef.durationSec;
      setCurrentCountdown(countdown);

      timer = setInterval(() => {
        countdown -= 1;

        // Wave mock progress within the 5s challenge
        if (currentType === 'wave') {
          if (countdown === 3) {
            setWaveCount(1); // First wave completed
            playAudioCue('wave');
          } else if (countdown === 1) {
            setWaveCount(2); // Second wave completed
            playAudioCue('wave');
          }
        }

        if (countdown > 0) {
          setCurrentCountdown(countdown);
        } else if (countdown === 0) {
          setCurrentCountdown(0);
          if (currentType === 'wave') {
            setWaveCount(2);
          }
          setChallengeState('completed');
        } else if (countdown <= -1) {
          clearInterval(timer);
          if (currentChallengeIndex < activeSequence.length - 1) {
            setCurrentChallengeIndex((prev) => prev + 1);
          } else {
            // All 4 challenges completed -> Transition to Track 3: 照明響應 (5 seconds)
            setOverallStage('track3_photometric');
          }
        }
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [overallStage, currentChallengeIndex, activeSequence]);

  // Photometric Response (Fixed 5 Seconds)
  useEffect(() => {
    let photoTimer: any;
    if (overallStage === 'track3_photometric') {
      speakPrompt('請保持臉部不動。', 'track3_holding');
      setPhotoSubState('analyzing');
      let count = 5;
      setPhotoCountdown(count);

      photoTimer = setInterval(() => {
        count -= 1;
        if (count > 0) {
          setPhotoCountdown(count);
        } else if (count === 0) {
          setPhotoCountdown(0);
          speakPrompt('照明響應驗證完成。', 'track3_completed');
          setPhotoSubState('completed');
        } else if (count <= -1) {
          clearInterval(photoTimer);
          setOverallStage('processing');
        }
      }, 1000);

      return () => {
        if (photoTimer) clearInterval(photoTimer);
      };
    }
  }, [overallStage]);

  // Processing to Success Transition
  useEffect(() => {
    if (overallStage === 'processing') {
      const timer = setTimeout(() => {
        setOverallStage('success');
        setTotalSecondsRemaining(0);
        speakPrompt('身分驗證完成。', 'verification_success');
        onVerificationComplete(99.8, true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [overallStage, onVerificationComplete]);

  // Start verification handler
  const handleStartVerification = () => {
    // Prime and unlock audio context & speech synthesis on user gesture
    if (typeof window !== 'undefined') {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
      }
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const testCtx = new AudioCtx();
          testCtx.resume();
        }
      } catch (_) {}
    }
    // Generate fresh random sequence of 4 challenges
    const freshSequence = generateRandomChallengeSequence();
    setActiveSequence(freshSequence);
    lastSpokenKeyRef.current = '';
    setTotalSecondsRemaining(TOTAL_SESSION_SECONDS);
    setCurrentChallengeIndex(0);
    setChallengeState('active');
    setWaveCount(0);
    setPhotoSubState('prep');
    setOverallStage('verifying_actions');
  };

  const currentType = activeSequence[currentChallengeIndex] || activeSequence[0] || 'turn_left';
  const currentDef = CHALLENGE_MAP[currentType] || CHALLENGE_MAP.turn_left;

  // Guardian Mood
  const getGuardianMood = (): GuardianMood => {
    if (overallStage === 'success') return 'success';
    if (overallStage === 'processing') return 'thinking';
    if (overallStage === 'verifying_actions' || overallStage === 'track3_photometric') return 'scanning';
    return 'welcoming';
  };

  return (
    <div className="w-full flex flex-col items-center">
      {/* 
        ========================================================================
        CAMERA VIEWPORT CONTAINER
        ========================================================================
      */}
      <div 
        id="camera-first-viewfinder"
        className={`relative w-full overflow-hidden bg-slate-950 shadow-2xl border-4 transition-all duration-300 ${
          isDesktop 
            ? 'h-[600px] rounded-3xl border-slate-800 ring-1 ring-sky-500/20' 
            : 'h-[550px] rounded-[36px] border-slate-900 ring-1 ring-slate-800'
        }`}
      >
        {/* Real / Simulated Video Stream (Mirrored with -scale-x-100) */}
        <div className="absolute inset-0 w-full h-full overflow-hidden">
          {cameraActive && !useSimulatedFeed ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover -scale-x-100"
            />
          ) : (
            /* Friendly Simulated Live Camera Feed */
            <div className="w-full h-full bg-gradient-to-b from-slate-900 via-slate-800 to-slate-950 flex items-center justify-center relative select-none">
              <div className="w-72 h-96 rounded-[120px] bg-slate-700/30 blur-2xl animate-pulse" />
              <div className="absolute flex flex-col items-center justify-center text-slate-300">
                <div className="relative">
                  <div className="w-36 h-48 rounded-full border-2 border-dashed border-sky-400/40 flex items-center justify-center">
                    <AIGuardian size="md" mood={getGuardianMood()} />
                  </div>
                </div>
                <span className="text-xs font-semibold text-sky-200 mt-4 bg-slate-900/80 px-3 py-1 rounded-full border border-white/10">
                  {cameraErrorMsg ? '已啟用模擬鏡頭環境' : '鏡頭初始化中...'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* TRACK 3: SOFT LIGHTING CHANGE OVERLAY (Gentle Normal -> Slightly Brighter -> Normal) */}
        {overallStage === 'track3_photometric' && (
          <motion.div
            id="photometric-lighting-effect"
            className="absolute inset-0 pointer-events-none z-10"
            animate={{
              backgroundColor: [
                'rgba(255, 255, 255, 0)',
                'rgba(240, 249, 255, 0.12)',
                'rgba(255, 255, 255, 0.20)',
                'rgba(240, 249, 255, 0.10)',
                'rgba(255, 255, 255, 0)',
              ],
            }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )}

        {/* Camera Vignette */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/75 via-transparent to-black/85" />

        {/* 
          ======================================================================
          TOP STATUS BAR (Voice Toggle, 23s Session Counter)
          ======================================================================
        */}
        <div className="absolute top-0 inset-x-0 p-2.5 sm:p-4 z-20 flex flex-col gap-1.5 pointer-events-auto">
          <div className="flex items-center justify-between">
            {/* GuardFrame Security Status Pill */}
            <div className="flex items-center gap-1.5 bg-slate-900/85 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10 text-white shadow-xs">
              <AIGuardian size="xs" mood={getGuardianMood()} />
              <span className="text-[10px] sm:text-[11px] font-bold tracking-tight">人臉活體防偽</span>
            </div>

            {/* Right: Voice Toggle Button & Total 23s Counter */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                id="face-voice-toggle-btn"
                onClick={() => {
                  const nextState = !voiceEnabled;
                  setVoiceEnabled(nextState);
                  if (nextState) {
                    playAudioCue('action');
                  } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                  }
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-bold transition-all cursor-pointer backdrop-blur-md border ${
                  voiceEnabled
                    ? 'bg-sky-500/90 text-white border-sky-300/40 shadow-sm'
                    : 'bg-slate-900/80 text-slate-300 border-white/10 hover:bg-slate-800'
                }`}
                title="切換語音動作提示"
              >
                {voiceEnabled ? (
                  <>
                    <Volume2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                    <span>語音 ON</span>
                  </>
                ) : (
                  <>
                    <VolumeX className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-slate-400" />
                    <span>語音 OFF</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 
          ======================================================================
          TOP ACTION PROMPT HUD (Adaptive Size: Large on Desktop, Ultra-Compact on Mobile)
          ======================================================================
        */}
        {overallStage === 'verifying_actions' && (
          <div className={`absolute inset-x-2 sm:inset-x-6 z-25 flex flex-col items-center pointer-events-none ${
            isDesktop ? 'top-12 sm:top-14 max-w-lg mx-auto' : 'top-11 sm:top-14 max-w-md mx-auto'
          }`}>
            <motion.div
              key={`${currentType}_${currentChallengeIndex}`}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.2 }}
              className={`w-full bg-slate-950/95 backdrop-blur-xl border border-sky-400/70 shadow-xl text-white flex items-center justify-between ring-1 ring-sky-500/30 ${
                isDesktop 
                  ? 'px-4 sm:px-5 py-3 sm:py-3.5 rounded-2xl gap-3.5 ring-2 ring-sky-400/40' 
                  : 'px-2.5 sm:px-4 py-1.5 sm:py-2.5 rounded-xl sm:rounded-2xl gap-2'
              }`}
            >
              {/* Left: Action Icon + Instruction Text */}
              <div className={`flex items-center min-w-0 flex-1 ${isDesktop ? 'gap-3.5' : 'gap-2'}`}>
                <div className={`bg-sky-500/25 border border-sky-300/60 flex items-center justify-center text-sky-100 shrink-0 ${
                  isDesktop 
                    ? 'h-11 w-11 rounded-xl shadow-md' 
                    : 'h-7 w-7 sm:h-9 sm:w-9 rounded-lg sm:rounded-xl'
                }`}>
                  {currentType === 'wave' && (
                    <motion.div
                      animate={{ rotate: [0, 16, -16, 16, 0], x: [-2, 2, -2, 2, 0] }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <Hand className={isDesktop ? 'h-6 w-6 stroke-[2.5] text-amber-300' : 'h-4 w-4 sm:h-5 sm:w-5 stroke-[2.5] text-amber-300'} />
                    </motion.div>
                  )}
                  {currentType === 'turn_left' && (
                    <motion.div
                      animate={{ x: [0, -3, 0] }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <ArrowLeft className={isDesktop ? 'h-6 w-6 stroke-[2.5] text-sky-200' : 'h-4 w-4 sm:h-5 sm:w-5 stroke-[2.5] text-sky-200'} />
                    </motion.div>
                  )}
                  {currentType === 'turn_right' && (
                    <motion.div
                      animate={{ x: [0, 3, 0] }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <ArrowRight className={isDesktop ? 'h-6 w-6 stroke-[2.5] text-sky-200' : 'h-4 w-4 sm:h-5 sm:w-5 stroke-[2.5] text-sky-200'} />
                    </motion.div>
                  )}
                  {currentType === 'blink' && (
                    <Eye className={isDesktop ? 'h-6 w-6 stroke-[2.5] text-sky-200 animate-pulse' : 'h-4 w-4 sm:h-5 sm:w-5 stroke-[2.5] text-sky-200 animate-pulse'} />
                  )}
                </div>

                {/* Main Instruction Text */}
                <div className="flex flex-col text-left min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-black text-white tracking-tight leading-tight ${
                      isDesktop ? 'text-base sm:text-lg' : 'text-[11px] sm:text-sm'
                    }`}>
                      第 {currentChallengeIndex + 1}/4 步：{currentDef.title}
                    </span>
                    <span className={`select-none shrink-0 ${isDesktop ? 'text-base' : 'text-xs'}`}>
                      {currentDef.emoji}
                    </span>
                  </div>
                  <span className={`font-medium leading-tight mt-0.5 whitespace-nowrap ${
                    isDesktop ? 'text-xs sm:text-sm' : 'text-[10px] sm:text-xs'
                  }`}>
                    {currentType === 'wave' ? (
                      <span className="text-amber-300 font-bold">
                        {isDesktop 
                          ? `揮手進度: ${waveCount}/2 次 ${waveCount >= 2 ? '✓ (已完成)' : '(請在鏡頭前左右揮手)'}`
                          : `揮手進度: ${waveCount}/2 次 ${waveCount >= 2 ? '✓ 已完成' : '(請揮手)'}`}
                      </span>
                    ) : (
                      <span className="text-sky-200">
                        {isDesktop 
                          ? currentDef.sub 
                          : currentType === 'blink'
                          ? '請自然眨眼 1 至 2 次'
                          : currentType === 'turn_left'
                          ? '請將臉部向左微轉'
                          : currentType === 'turn_right'
                          ? '請將臉部向右微轉'
                          : currentDef.sub}
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {/* Right: Countdown Timer */}
              <div className={`flex items-center border-l border-white/15 shrink-0 ${
                isDesktop ? 'gap-2 pl-3.5' : 'gap-1 pl-2'
              }`}>
                {challengeState === 'active' ? (
                  <div className={`flex items-center gap-1 text-amber-300 font-bold bg-amber-500/15 rounded border border-amber-400/30 ${
                    isDesktop ? 'px-2.5 py-1 text-sm sm:text-base font-black' : 'px-1.5 sm:px-2 py-0.5 text-xs sm:text-sm'
                  }`}>
                    <span className={`rounded-full bg-amber-400 animate-ping ${isDesktop ? 'h-2 w-2' : 'h-1.5 w-1.5'}`} />
                    <span className="font-mono tracking-tight tabular-nums">
                      {currentCountdown < 10 ? `0${currentCountdown}s` : `${currentCountdown}s`}
                    </span>
                  </div>
                ) : (
                  <div className={`flex items-center gap-1 text-emerald-300 font-black bg-emerald-500/20 rounded border border-emerald-400/40 ${
                    isDesktop ? 'px-2.5 py-1 text-xs sm:text-sm' : 'px-1.5 py-0.5 text-[10px] sm:text-xs'
                  }`}>
                    <Check className={isDesktop ? 'h-4 w-4 stroke-[3]' : 'h-3 w-3 stroke-[3]'} />
                    <span>完成</span>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}

        {/* 
          ======================================================================
          CENTER OVERLAY: FACE GUIDE & LANDMARKS (Eyes, Nose, Mouth)
          ======================================================================
        */}
        {(overallStage === 'ready' || overallStage === 'verifying_actions' || overallStage === 'track3_photometric') && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 pt-10 sm:pt-14">
            <div 
              id="face-positioning-guide"
              className={`relative w-[205px] h-[265px] sm:w-[250px] sm:h-[310px] rounded-[105px] sm:rounded-[125px] transition-all duration-500 flex flex-col items-center justify-center ${
                overallStage === 'track3_photometric'
                  ? photoSubState === 'completed'
                    ? 'border-[2.5px] border-emerald-400 shadow-[0_0_35px_rgba(52,211,153,0.4)] scale-[1.02]'
                    : 'border-[2.5px] border-sky-300 shadow-[0_0_30px_rgba(56,189,248,0.35)]'
                  : challengeState === 'completed'
                  ? 'border-[2.5px] border-emerald-400/90 shadow-[0_0_35px_rgba(52,211,153,0.35)] scale-[1.02]'
                  : 'border-2 border-sky-300/65 shadow-[0_0_25px_rgba(56,189,248,0.25)]'
              }`}
            >
              {/* Subtle Rounded Accents */}
              <div className="absolute -top-1.5 left-10 right-10 h-1 bg-gradient-to-r from-transparent via-sky-300/60 to-transparent rounded-full" />
              <div className="absolute -bottom-1.5 left-10 right-10 h-1 bg-gradient-to-r from-transparent via-sky-300/60 to-transparent rounded-full" />

              {/* FACE LANDMARK GUIDE: Eyes, Nose, Mouth */}
              <div className="relative w-full h-full flex flex-col items-center justify-center select-none">
                {/* 1. Eyes Row */}
                <div className="absolute top-[32%] inset-x-6 sm:inset-x-7 flex items-center justify-between">
                  {/* Left Eye */}
                  <div className="flex flex-col items-center">
                    <motion.div
                      className="w-9 h-6 sm:w-10 sm:h-7 rounded-full border border-sky-300/60 bg-sky-500/15 flex items-center justify-center"
                      animate={overallStage === 'verifying_actions' && currentType === 'blink' ? { scaleY: [1, 0.15, 1] } : {}}
                      transition={{ duration: 1.0, repeat: Infinity }}
                    >
                      <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-sky-200/90 shadow-sm" />
                    </motion.div>
                  </div>

                  {/* Right Eye */}
                  <div className="flex flex-col items-center">
                    <motion.div
                      className="w-9 h-6 sm:w-10 sm:h-7 rounded-full border border-sky-300/60 bg-sky-500/15 flex items-center justify-center"
                      animate={overallStage === 'verifying_actions' && currentType === 'blink' ? { scaleY: [1, 0.15, 1] } : {}}
                      transition={{ duration: 1.0, repeat: Infinity }}
                    >
                      <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-sky-200/90 shadow-sm" />
                    </motion.div>
                  </div>
                </div>

                {/* 2. Nose Center Landmark */}
                <div className="absolute top-[52%] flex items-center justify-center">
                  <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-sky-200/70 shadow-[0_0_8px_rgba(56,189,248,0.5)] border border-white/60" />
                </div>

                {/* 3. Mouth Landmark */}
                <div className="absolute top-[66%] flex flex-col items-center">
                  <motion.div 
                    className="w-10 h-3.5 sm:w-12 sm:h-4 rounded-b-full border-b-[2.5px] border-sky-200/80 shadow-[0_2px_10px_rgba(56,189,248,0.3)]"
                    animate={
                      overallStage === 'verifying_actions' && currentType === 'turn_left' ? { x: -4 } :
                      overallStage === 'verifying_actions' && currentType === 'turn_right' ? { x: 4 } : { x: 0 }
                    }
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 
          ======================================================================
          DIRECTION ARROWS (Turn Left / Turn Right - Positioned at Outer Edges)
          ======================================================================
        */}
        {overallStage === 'verifying_actions' && (
          <div className="absolute inset-0 pointer-events-none z-15 flex items-center justify-between px-2 sm:px-6">
            {/* Left Turn Directional Arrow */}
            {currentType === 'turn_left' ? (
              <motion.div 
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: [0, -10, 0] }}
                transition={{ duration: 1.0, repeat: Infinity, ease: "easeInOut" }}
                className="flex items-center gap-1"
              >
                <div className="h-10 w-10 sm:h-16 sm:w-16 rounded-full bg-sky-500/30 backdrop-blur-md border border-sky-300/50 flex items-center justify-center text-sky-100 shadow-[0_0_20px_rgba(56,189,248,0.4)]">
                  <ArrowLeft className="h-5 w-5 sm:h-8 sm:w-8 stroke-[2.5]" />
                </div>
              </motion.div>
            ) : <div className="w-10" />}

            {/* Right Turn Directional Arrow */}
            {currentType === 'turn_right' ? (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: [0, 10, 0] }}
                transition={{ duration: 1.0, repeat: Infinity, ease: "easeInOut" }}
                className="flex items-center gap-1"
              >
                <div className="h-10 w-10 sm:h-16 sm:w-16 rounded-full bg-sky-500/30 backdrop-blur-md border border-sky-300/50 flex items-center justify-center text-sky-100 shadow-[0_0_20px_rgba(56,189,248,0.4)]">
                  <ArrowRight className="h-5 w-5 sm:h-8 sm:w-8 stroke-[2.5]" />
                </div>
              </motion.div>
            ) : <div className="w-10" />}
          </div>
        )}

        {/* 
          ======================================================================
          PHOTOMETRIC HUD (5 Seconds Countdown) - Clean & Minimal
          ======================================================================
        */}
        {overallStage === 'track3_photometric' && (
          <div className="absolute inset-0 pointer-events-none z-30 flex flex-col items-center justify-center p-6">
            <div className="flex flex-col items-center text-center space-y-2">
              {photoSubState === 'prep' && (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-slate-950/85 backdrop-blur-md px-5 py-2.5 rounded-2xl border border-white/20 text-white"
                >
                  <p className="text-xs sm:text-sm font-bold text-sky-200">
                    正在進行照明響應驗證
                  </p>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    請保持臉部在框線內 • 不要移動
                  </p>
                </motion.div>
              )}

              {photoSubState === 'analyzing' && (
                <motion.div
                  key={photoCountdown}
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="flex flex-col items-center"
                >
                  <div className="bg-slate-950/90 backdrop-blur-xl px-6 py-3.5 rounded-3xl border border-sky-400/60 shadow-2xl flex flex-col items-center">
                    <span className="text-xs font-black tracking-wider text-sky-300">
                      照明響應驗證
                    </span>
                    <span className="text-sm font-bold text-white mt-0.5">
                      請保持臉部不動
                    </span>
                    <div className="mt-2 text-2xl font-black text-amber-400 tracking-widest flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-ping" />
                      <span>0{photoCountdown}</span>
                    </div>
                  </div>
                </motion.div>
              )}

              {photoSubState === 'completed' && (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-emerald-950/90 backdrop-blur-xl px-6 py-3.5 rounded-3xl border border-emerald-400/60 shadow-2xl text-white flex items-center gap-2.5"
                >
                  <div className="h-7 w-7 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                    <CheckCheck className="h-4 w-4 stroke-[3]" />
                  </div>
                  <span className="text-sm font-black text-emerald-300">
                    ✓ 照明響應驗證完成
                  </span>
                </motion.div>
              )}
            </div>
          </div>
        )}

        {/* 
          ======================================================================
          BOTTOM HUD / BUTTONS
          ======================================================================
        */}
        <div className="absolute bottom-5 inset-x-4 z-25 flex flex-col items-center text-center pointer-events-auto">
          {/* Ready State CTA */}
          {overallStage === 'ready' && (
            <motion.div 
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-sm bg-slate-900/90 backdrop-blur-md p-4 rounded-3xl border border-white/10 text-white flex flex-col items-center space-y-3"
            >
              <div className="text-center">
                <h4 className="text-base font-bold">準備好開始人臉核驗了嗎？</h4>
                <p className="text-xs text-slate-300 mt-0.5">
                  共 4 項動作與照明響應（全程 23 秒），請依語音提示操作。
                </p>
              </div>

              <button
                id="start-face-verify-btn"
                type="button"
                onClick={handleStartVerification}
                className="w-full py-3.5 rounded-2xl bg-sky-500 hover:bg-sky-400 active:scale-[0.99] text-white font-bold text-sm shadow-lg shadow-sky-500/30 flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <Play className="h-4 w-4 fill-white" />
                <span>開始 23 秒動態驗證</span>
              </button>
            </motion.div>
          )}

          {/* Processing State */}
          {overallStage === 'processing' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-sm bg-slate-900/95 backdrop-blur-xl p-6 rounded-3xl border border-sky-400/40 text-white flex flex-col items-center text-center space-y-4"
            >
              <div className="relative">
                <div className="h-16 w-16 rounded-full border-4 border-sky-400/30 border-t-sky-400 animate-spin flex items-center justify-center" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <AIGuardian size="sm" mood="thinking" />
                </div>
              </div>

              <div>
                <h4 className="text-base font-black text-white">正在確認你的身分...</h4>
                <p className="text-xs text-sky-200 mt-1">
                  GuardFrame 正在彙整動作特徵與照明響應數據。
                </p>
              </div>
            </motion.div>
          )}

          {/* Success State Overlay (Clean Customer View: NO Internal Risk Scores) */}
          {overallStage === 'success' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-sm bg-slate-900/95 backdrop-blur-xl p-6 rounded-3xl border border-emerald-400/60 text-white flex flex-col items-center text-center space-y-4 shadow-2xl"
            >
              <div className="h-14 w-14 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/30">
                <CheckCircle2 className="h-8 w-8" />
              </div>

              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300 bg-emerald-950/80 px-3.5 py-1 rounded-full border border-emerald-400/30">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>身分核驗通過</span>
                </span>
                <h4 className="text-lg font-black text-white mt-2.5">身分驗證完成</h4>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  已確認為您本人辦理，動作核驗與照明響應已全數通過。
                </p>
              </div>

              <button
                id="face-verify-success-next-btn"
                type="button"
                onClick={onProceedNext}
                className="w-full py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-white font-bold text-sm shadow-lg shadow-emerald-500/30 flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <span>下一步：設定開戶服務</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};
