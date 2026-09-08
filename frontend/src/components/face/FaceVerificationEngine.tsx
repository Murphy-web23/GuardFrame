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
  Check,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { getChallengeOrder, verifyFace, ApiError, ChallengeOrderItem, RecordingPhases } from '../../api/client';
import { MOBILE_AUDIO_CUE_ACTION, MOBILE_AUDIO_CUE_SUCCESS } from '../../utils/mobileAudioCues';
import { detectCameraSourceType, CameraSourceType } from '../../lib/cameraSource';
import {
  ACTION_DURATIONS_SEC,
  RECORDING_FPS,
  generateLightLog,
  lightLogDurationMs,
  msToFrame,
} from '../../utils/verificationRecording';

export type ChallengeType = 'blink' | 'turn_left' | 'turn_right' | 'wave';
export type OverallStage = 'ready' | 'verifying_actions' | 'track3_photometric' | 'processing' | 'success' | 'error';
export type PhotometricSubState = 'prep' | 'holding' | 'analyzing' | 'completed';

// 前端 UI 內部沿用 'wave' 這個較短的名字（動畫/圖示/文字都用它），
// 但後端契約與上傳用的是 'wave_hand'——兩邊互轉集中在這兩個函式，
// 不要在別的地方各自手動拼字串。
const toLocalType = (action: ChallengeOrderItem['action']): ChallengeType =>
  action === 'wave_hand' ? 'wave' : action;
const toBackendAction = (type: ChallengeType): ChallengeOrderItem['action'] =>
  type === 'wave' ? 'wave_hand' : type;

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
    // 2026-08-31：申請人 1601（長輩）揮手動作實際有做，但速度太快、
    // 動態模糊導致 Track4 手部關鍵點模型整段 0 偵測（見當天對話紀錄），
    // MediaPipe 信心門檻、CLAHE 前處理兩條路都已實測無效。文案改成
    // 明確要求放慢速度，從源頭減少動態模糊，不動偵測演算法本身。
    title: '請放慢速度，在臉前來回揮手至少三次',
    sub: '放慢速度，將手抬到臉的高度前後揮動至少三次',
    // 7 秒，對應後端 config.BASELINE_ACTION_DURATIONS['wave_hand']。
    // 這裡原本寫 5 秒，跟後端對不起來——揮手這段同時也是 Track 4
    // 遮擋分析要用的區間（phases.occlusion），時長算錯會讓後端切出
    // 錯誤的影格範圍，見 verificationRecording.ts 的說明。
    //
    // 2026-08-27：原本文案「請在臉部前方揮手」容易被誤解成一般打招呼
    // 的揮手（手在肩膀/頭部旁邊擺動），但後端 baseline_challenge/
    // analyzer.py 的 _check_wave_hand() 跟 Track4 的遮擋偵測用的是
    // 同一套邏輯（common/hand_tracking.py detect_wave_cycles()），
    // 判定的是「手部座標有沒有真的進到臉部框範圍內」，不是單純有
    // 揮手動作。真人測試（申請人937）就踩到這個問題：手拉遠揮手打
    // 招呼，兩層判定都算 0 次遮擋循環直接失敗。改成更明確的說法。
    durationSec: ACTION_DURATIONS_SEC.wave_hand,
    voiceText: '請放慢速度，在臉前來回揮手至少三次。',
    icon: Hand,
    emoji: '👋',
  },
};

// 2026-08-27：真人測試發現 Track 3 光照相關係數連續好幾次都量到 0
// （925、935、969），追出根因：這個緩衝時間原本只加在送給後端的
// phases.lighting 影格範圍上（見下面 processing 階段的說明），但真正
// 停止錄影的計時器（見 track3_photometric 那個 useEffect）沒有跟著
// 延長——影片實際錄到的長度剛好在 lightingEndMs 那一刻就結束，後端
// 卻被告知燈光階段一路延伸到 lightingEndMs + 這段緩衝，要求的影格
// 範圍必然超出影片實際長度，correlation 自然算不出來（不是雜訊、
// 是系統性地每次都會發生）。現在提升成模組層級常數，兩處都要用
// 同一個值，才能讓「錄影實際停止的時間」跟「告訴後端的影格範圍」
// 對得上。
const LIGHTING_BUFFER_MS = 400;

// 2026-08-31：申請人 1601（長輩）揮手速度太快、動態模糊導致 Track4
// 手部關鍵點模型整段 0 偵測（track4_occlusion/hand_tracking.py 檔頭
// 已記錄：MediaPipe 信心門檻調低、CLAHE 前處理兩條路都實測無效，
// 因為模糊已經在編碼當下把邊緣資訊真的抹掉了）。這裡改成從源頭減少
// 模糊——只在揮手挑戰的 7 秒視窗鎖定曝光時間，範圍比 2026-08-28
// 那次「整個 session 都鎖」小很多（那次因為懷疑跟 Android Step5 卡頓
// 有關而整個移除，且從未實測過效果）。
//
// WAVE_EXPOSURE_LOCK_ENABLED 是唯一開關：測試完如果沒有幫助（Track4
// waveCyclesDetected 沒有改善），把這個改回 false 就完全恢復原狀，
// 不用刪 tryLockExposureForWave()/restoreAutoExposureAfterWave() 這兩個
// 函式——內部本來就會在裝置不支援、或任何錯誤時直接放棄，不影響錄影。
const WAVE_EXPOSURE_LOCK_ENABLED = true;

// 2026-09-07：iOS Safari 真人測試（兩支不同手機都一樣）回報跟 Android
// 同樣的症狀（音效正常、語音完全沒聲音）——但 iOS 一直以來從沒出現過
// 這個問題（見下面 speakPrompt() 裡多處「iOS Safari 完全沒有這個
// 問題」的舊註解），時間點對得上：這是上一次為了修 Android「提示音
// 搶音訊焦點」問題、把語音改成「等提示音播完的 ended 事件才觸發」
// 之後才出現的。查資料證實 iOS Safari 對 speak() 有更嚴格的要求——
// 呼叫時間點要夠接近使用者互動，透過事件監聽器/setTimeout 延後太久
// 容易被判定「不算使用者觸發」而整個靜音失敗，這正是那次改動做的事。
// Android 需要那個延遲（治音訊焦點搶占），iOS 不需要、而且會被那個
// 延遲害死，两边症狀相同、成因相反，不能用同一套延遲邏輯，只能拆開。
const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

async function tryLockExposureForWave(stream: MediaStream | null) {
  if (!WAVE_EXPOSURE_LOCK_ENABLED || !stream) return;
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.getCapabilities !== 'function') return;
  try {
    const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
      exposureTime?: { min: number; max: number };
    };
    if (!capabilities.exposureTime) return; // 裝置/瀏覽器不支援就直接放棄
    // 曝光時間取可調範圍偏短的那一端（15% 處），縮短單格曝光時間以
    // 減少動態模糊，不取最短——太短畫面會太暗，反而傷到其他判定。
    const { min, max } = capabilities.exposureTime;
    const shortExposure = min + (max - min) * 0.15;
    await track.applyConstraints({
      advanced: [{ exposureMode: 'manual', exposureTime: shortExposure } as any],
    });
  } catch {
    // 鎖定失敗就當作沒這回事，不影響錄影，只是模糊沒被緩解
  }
}

async function restoreAutoExposureAfterWave(stream: MediaStream | null) {
  if (!WAVE_EXPOSURE_LOCK_ENABLED || !stream) return;
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ exposureMode: 'continuous' } as any] });
  } catch {
    // 一樣忽略，恢復失敗頂多後面幾個動作曝光沒調回來，不影響錄影本身
  }
}

interface FaceVerificationEngineProps {
  applicantId: number;
  sessionId: string;
  // 2026-08-25：/verify 改非同步後，錄影上傳完當下只知道「送出成功」，
  // 還不知道真正 verdict（後端還在背景跑五層分析）——這裡不再回傳
  // confidence/verdict 這些要等分析跑完才有的值，見 client.ts
  // waitForVerifyResult() 的說明，真正的結果留到 TermsSubmitScreen
  // 送出開戶設定前才輪詢取得。
  onVerificationComplete: () => void;
  onProceedNext: () => void;
  isDesktop?: boolean;
}

export const FaceVerificationEngine: React.FC<FaceVerificationEngineProps> = ({
  applicantId,
  sessionId,
  onVerificationComplete,
  onProceedNext,
  isDesktop = false,
}) => {
  // 22-23 秒左右（動作階段固定 20 秒 + 燈光階段 5 段 400-600ms，實際
  // 總長要等伺服器指派的挑戰順序＋這次隨機產生的燈光序列都到手才知道
  // 確切數字，這裡先給一個含燈光平均值的初始估計值，開始錄影時會
  // 用 timelineRef 算出的真實值覆蓋）。
  const [totalSecondsRemaining, setTotalSecondsRemaining] = useState<number>(23);

  // 伺服器指派的挑戰順序（§5.3／PHASE1_NOTES §九），元件掛載時抓取，
  // 不是前端自己隨機排的——見下面的 useEffect。
  const [activeSequence, setActiveSequence] = useState<ChallengeType[]>([]);
  const [orderLoading, setOrderLoading] = useState<boolean>(true);
  const [orderError, setOrderError] = useState<string>('');
  const backendOrderRef = useRef<ChallengeOrderItem[]>([]);

  const [overallStage, setOverallStage] = useState<OverallStage>('ready');
  const [currentChallengeIndex, setCurrentChallengeIndex] = useState<number>(0);
  const [currentCountdown, setCurrentCountdown] = useState<number>(5);
  const [challengeState, setChallengeState] = useState<'active' | 'completed'>('active');

  // Wave Challenge Progress: waveCount (0, 1, 2) within the single 5s wave challenge
  const [waveCount, setWaveCount] = useState<number>(0);

  // Track 3 Photometric States (5 seconds total)
  const [photoSubState, setPhotoSubState] = useState<PhotometricSubState>('prep');
  const [photoCountdown, setPhotoCountdown] = useState<number>(5);
  // 目前正在顯示 light_log 的第幾段（驅動全螢幕顏色閃爍），見下面
  // Photometric Response 的 useEffect。
  const [currentLightSegmentIndex, setCurrentLightSegmentIndex] = useState<number>(0);

  // Voice Guidance Settings & Audio Controller
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  // 2026-08-30：純觀察用，不影響任何實際行為——手機語音真人測試回報
  // 完全沒聲音，但音效正常，之前亂猜著加解鎖邏輯反而把音效也弄壞了
  // （已經退回去）。這次只加診斷資訊、不碰邏輯，把 speechSynthesis
  // 實際發生什麼事顯示在畫面上（手機沒有 remote devtools 可以看
  // console），下次測試才有真的數據可以看，不是繼續用猜的。問題排查
  //完應該要把這個拿掉，不是正式功能。
  const lastSpokenKeyRef = useRef<string>('');
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // 2026-08-25：手機版動作提示音改用 <audio> 元素（見
  // ../../utils/mobileAudioCues.ts 的說明），跟桌面版的 AudioContext
  // 方案完全分開、互不影響。
  const mobileActionAudioRef = useRef<HTMLAudioElement | null>(null);
  const mobileSuccessAudioRef = useRef<HTMLAudioElement | null>(null);
  const availableVoicesRef = useRef<SpeechSynthesisVoice[]>([]);

  // Camera feed states
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  // 2026-08-22：真人測試發現，「重新錄製」重啟攝影機後如果馬上就能按
  // 「開始驗證」，鏡頭的自動對焦/曝光還沒穩定，錄出來的畫面容易模糊
  // （blurScore 不合格）。給一段短暫的「鏡頭準備中」緩衝時間，讓自動
  // 對焦先穩定下來，見 startCamera() 裡的說明。
  const [cameraWarmingUp, setCameraWarmingUp] = useState<boolean>(false);
  const [useSimulatedFeed, setUseSimulatedFeed] = useState<boolean>(false);
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // 送出 /verify 時要標記的鏡頭來源，startCamera() 拿到 stream 後才算得出來，
  // 見 lib/cameraSource.ts。
  const cameraSourceTypeRef = useRef<CameraSourceType>('實體相機');

  // 真的錄影＋上傳 /verify 用的狀態。timelineRef 在按下「開始驗證」的
  // 當下一次算好（見 handleStartVerification），之後動作/燈光階段只是
  // 照著這份預先算好的時間表播放，不會在過程中重新量測——這樣比較不會
  // 有計時器誤差累積的問題。
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timelineRef = useRef<{
    boundaries: { action: ChallengeOrderItem['action']; startMs: number; endMs: number }[];
    actionPhaseEndMs: number;
    lightLog: ReturnType<typeof generateLightLog> | null;
    totalMs: number;
    // 2026-08-25：見下面 track3_photometric 那個 useEffect 的說明——
    // 這裡多存一個「照明階段實際幾毫秒後才真的開始播放」的量測值，跟
    // actionPhaseEndMs（事先算好的理論值）分開，因為兩者被證實對不
    // 起來，會讓 Track 3 的相關係數失真。
    actualLightingStartMs: number | null;
  }>({ boundaries: [], actionPhaseEndMs: 0, lightLog: null, totalMs: 0, actualLightingStartMs: null });
  // 錄影真正開始的時間點（recorder.start() 當下的 performance.now()），
  // 用來量測「動作階段實際跑了多久才真的進入照明階段」。
  const recordingStartPerfMsRef = useRef<number>(0);
  const [verifyError, setVerifyError] = useState<string>('');

  // 掛載時跟後端要伺服器指派的隨機挑戰順序（§5.3／PHASE1_NOTES §九），
  // 不是前端自己 Math.random() 排——這是「隨機順序」這個安全機制真正
  // 生效的關鍵，見 verificationRecording.ts 頂部的說明。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getChallengeOrder(applicantId, sessionId);
        if (cancelled) return;
        backendOrderRef.current = result.challenges;
        setActiveSequence(result.challenges.map((c) => toLocalType(c.action)));
        setOrderLoading(false);
      } catch (err) {
        if (cancelled) return;
        setOrderError(
          err instanceof ApiError ? err.message : '無法連線到後端伺服器，請確認伺服器是否已啟動'
        );
        setOrderLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicantId, sessionId]);

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

  // 2026-08-25：手機版動作提示音改走 <audio> 元素（見
  // ../../utils/mobileAudioCues.ts 開頭的說明——AudioContext 方案在真人
  // 測試裡兩次都沒解決手機聽不到提示音的問題，使用者同意不用跟桌面版
  // 同一種音效，找一個能用的就好）。'wave' 目前借用跟 'action' 一樣的
  // 音檔，不是遺漏，只是沒有另外合成第三種音效，感受上差異不大。
  const playMobileAudioCue = (type: 'action' | 'success' | 'wave') => {
    if (!voiceEnabled || typeof window === 'undefined') return;
    try {
      const audio = type === 'success' ? mobileSuccessAudioRef.current : mobileActionAudioRef.current;
      if (!audio) return;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch (_) {}
  };

  // Web Speech API Voice Prompt Helper (with GC retention, delay safeguard & voice selection)
  const speakPrompt = (text: string, uniqueKey: string) => {
    if (!voiceEnabled) return;
    if (lastSpokenKeyRef.current === uniqueKey) return; // Prevent duplicate triggers

    lastSpokenKeyRef.current = uniqueKey;

    // 1. Play audible synthesizer cue tone immediately（手機/桌面分開
    // 實作，見 playMobileAudioCue() 的說明，桌面版這裡完全不動）
    const cueType = uniqueKey === 'verification_success' || uniqueKey === 'track3_completed' ? 'success' : 'action';
    if (isDesktop) {
      playAudioCue(cueType);
    } else {
      playMobileAudioCue(cueType);
    }

    // 2. Play Web Speech API Spoken Voice
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      // Cancel previous speech safely
      window.speechSynthesis.cancel();

      // Micro-timeout prevents Chromium bug where cancel() cancels the immediate next speak()。
      const doSpeak = () => {
        try {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'zh-TW';
          // 2026-08-24：桌面版維持原本的 1.05 不變（明確要求禁止更改）。
          // 手機版語音聽起來偏快，同樣的 rate 數值在不同裝置的原生 TTS
          // 引擎上基準語速不同，手機端另外調低。只在這裡分流，其餘
          // speakPrompt() 邏輯兩邊完全共用、沒有其他改動。
          utterance.rate = isDesktop ? 1.05 : 1.0;
          utterance.pitch = 1.0;
          utterance.volume = 1.0;

          // 2026-08-30：改成每次都即時重新呼叫 getVoices()，不要用
          // availableVoicesRef 這個很早之前快取的清單——查到的資料顯示
          // Android 上很多語音其實是 Google 的「網路語音」（要連線到
          // Google 伺服器才能合成，不是手機本機處理），這類語音在網路
          // 狀況不理想時容易直接回報 synthesis-failed。優先挑
          // localService === true（本機處理，不靠網路）的中文語音，
          // 真的找不到本機語音才退回原本「隨便挑一個 zh 開頭」的邏輯。
          const voices = window.speechSynthesis.getVoices() || [];
          const zhVoices = voices.filter(
            (v) => v.lang === 'zh-TW' || v.lang === 'zh_TW' || v.lang === 'cmn-Hant-TW' || v.lang.includes('TW') || v.lang === 'zh-HK' || v.lang.startsWith('zh')
          );
          const twVoice = zhVoices.find((v) => v.localService) || zhVoices[0];

          // 2026-08-30：先前試過「手機版乾脆不指定語音物件」沒解決
          // 問題，收回。查資料後改用更有根據的做法（見上面 zhVoices/
          // twVoice 的說明）：優先選 localService 的語音、且每次都
          // 即時重新查詢，不用舊快取——這次兩邊（手機/桌面）都套用同一套
          // 邏輯，不用再猜哪邊該不該指定。
          if (twVoice) {
            utterance.voice = twVoice;
          }

          // Retain ref to prevent V8 garbage collection
          activeUtteranceRef.current = utterance;
          utterance.onstart = () => {};
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
      };

      if (isDesktop || isIOS) {
        // 桌面版完全不動：原本的固定 50ms micro-timeout。
        // 2026-09-07：iOS Safari 併進這條路——它要求 speak() 呼叫時間點
        // 要貼近使用者互動，不能像下面 Android 那樣等提示音播完的
        // 'ended' 事件才觸發（那個延遲正是 iOS 語音突然消失的原因，
        // 見上面 isIOS 宣告處的說明）。iOS 從來沒有 Android 那種提示音
        // 搶音訊焦點的問題，不需要也不能等。
        setTimeout(doSpeak, 50);
      } else {
        // 2026-08-30：手機版真人測試抓到具體錯誤碼 utterance.onerror =
        // "synthesis-failed"——語音清單、聲音本身都正常抓得到，代表不是
        // 「沒裝語音包」，是引擎當下合成失敗。playMobileAudioCue()（上面
        // 那行）用 <audio> 元素播提示音，跟 Android 系統層級的 TTS 服務
        // 搶音訊焦點是已知的常見成因——提示音還沒播完，TTS 引擎搶不到
        // 音訊輸出就直接回報合成失敗。前一版用寫死的 400ms 延遲賭提示音
        // 播完，真人測試證實猜的時間不夠、問題還在。改成真的監聽提示音
        // 元素的 'ended' 事件——提示音真正播完的當下才叫 speechSynthesis，
        // 不用再猜時間。同時保留一個較短的保險逾時（600ms，仍比原本的
        // 猜測值短），避免提示音因為自動播放被擋、沒有 src 等原因永遠
        // 不觸發 'ended' 時，語音整個不會出現。
        // 2026-09-07：這條路現在只有 Android 會走到（isIOS 已經在上面
        // 分流出去），變數名稱/註解沿用原樣，邏輯本身沒有改變。
        const cueAudio = cueType === 'success' ? mobileSuccessAudioRef.current : mobileActionAudioRef.current;
        let spoken = false;
        const speakOnce = () => {
          if (spoken) return;
          spoken = true;
          doSpeak();
        };
        if (cueAudio) {
          cueAudio.addEventListener('ended', speakOnce, { once: true });
        }
        setTimeout(speakOnce, 600);
      }
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

        // 2026-08-21：鏡頭框（#camera-first-viewfinder）畫面用 object-cover
        // 撐滿框（見下面 <video> 的 className），不管鏡頭實際擷取的長寬比
        // 是什麼，畫面永遠會被裁成填滿框——顯示層的裁切早就跟擷取層的
        // 長寬比無關。原本想靠壓窄 aspectRatio 讓「螢幕上看到的」貼近
        // 「後端實際分析的」，這個假設本身沒必要，卻是後來 08-28 那個
        // bug 的元凶（見下面）。
        //
        // 2026-08-28：手機版曾經设 0.6、後來鬆到 0.75，兩個都還是太窄——
        // 真人測試回報前鏡頭「放大」很多，要把手臂完全伸直才能讓全臉
        // 入鏡，懷疑是手機為了滿足這麼窄的長寬比，用數位變焦裁切畫面
        // 中央，等於視野被縮小，逼人站遠。
        //
        // 2026-08-30：證實了——查 iOS 錄下來的影片，實際解出來是
        // 1100x660（橫向，寬高剛好對調），代表 iOS 根本沒有照要求的
        // 660x1100 給，Android 則是報告要手臂伸直才能整臉入鏡，兩邊
        // 都指向同一個成因。只調手機版：放寬 aspectRatio（不再窄窄地
        // 卡在接近螢幕框的比例），讓鏡頭用比較接近原生的視角，不逼
        // 手機數位變焦。畫面裁切完全交給下面的 object-cover，跟這裡的
        // 長寬比無關，放寬不會讓螢幕上看到的畫面跑掉。
        // QUALITY_FACE_RATIO_MIN 只有 0.10，目前實測（真人樣本）都在
        // 0.19-0.21，放寬視角後續空間還很夠，不會反過來卡到這個門檻。
        // 桌面版沒有回報過這個問題，維持原本的 864/1080/0.8 不動。
        //
        // 2026-08-30：清晰度過不了關（S23 Ultra 這種鏡頭規格不差的手機
        // 也一樣），查資料證實 Android Chrome 的 MediaRecorder **不遵守**
        // videoBitsPerSecond 設定（macOS/iOS 都會遵守，Android 是唯一
        // 例外），實測位元率被鎖在約 2.5Mbps 上限，不管解析度多大都一樣
        // ——代表剛加的 6Mbps 設定在 Android 上形同虛設，真正能動的只有
        // 解析度：同樣被鎖死的位元率預算，切給越多像素、每個像素分到的
        // 資料量越少、畫質就越糊。手機版把目標解析度從 960 降到 640
        // （像素數少於一半），讓固定的位元率預算集中在較少的像素上，
        // 藉此提升清晰度；長寬比依然不鎖（跟上面放寬視角的修法相容，
        // 不會重新逼手機數位變焦）。桌面版的位元率設定原本就有效
        // （macOS 平台會遵守），不受這個問題影響，維持 864/1080 不動。
        const MOBILE_CAPTURE_SIZE = 640;
        // 2026-09-08：實驗性——真人測試（Zoom）證實揮手動作真的有做
        // 足夠次數，系統只是把動態模糊的那幾次漏算掉（見當天對話紀錄，
        // 直接看畫面數過確實揮了 2-3 次，只算到 1 次）。動態模糊量大致
        // 跟「單格曝光時間 × 手部移動速度」成正比，提高幀率會逼相機
        // 縮短單格曝光時間，理論上能降低單格模糊量——這個方向還沒被
        // 真人測試證實有效或無效，門檻調整／CLAHE 前處理那兩條路才是
        // 已經證實走不通的。只在手機版試，桌面版完全不動。
        //
        // 一鍵退回：改成 false 就完全恢復原本的 30fps 行為，不用刪這段
        // 程式碼——真人測試如果沒有改善（waveCyclesDetected 沒有變化）
        // 或者暗光環境下 ISO 補償造成雜訊嚴重影響其他判定，直接關掉即可。
        //
        // 2026-09-08：真人測試（applicant 1707）證實——揮手循環數這項
        // 真的過了（3 次），但 Android Chrome 的固定位元率預算是「每秒」
        // 多少，不是「每格」多少，幀率翻倍等於每格分到的資料量少一半，
        // 單格壓縮畫質反而變差（blur_score 只有 44.80，明顯低於平常的
        // 200-400），連帶讓身分連續性判定（occ_max_identity_drop 直接
        // 頂到上限 1.0）失敗。解決一個問題、製造另一個問題，整體沒有
        // 變好，關閉退回 30fps。
        const MOBILE_HIGH_FPS_ENABLED = false;
        const MOBILE_RECORDING_FPS = MOBILE_HIGH_FPS_ENABLED ? 60 : RECORDING_FPS;
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: 'user',
            width: { ideal: isDesktop ? 864 : MOBILE_CAPTURE_SIZE },
            height: { ideal: isDesktop ? 1080 : MOBILE_CAPTURE_SIZE },
            ...(isDesktop ? { aspectRatio: { ideal: 0.8 } } : {}),
            // 要求瀏覽器盡量用固定的 fps 錄——後端切影格區間時不依賴這個
            // 宣告值本身（改用解碼後量到的真實 fps，見
            // verificationRecording.ts 頂部的說明），只是給瀏覽器一個
            // 明確目標，沒有這個限制的話瀏覽器選的 fps 可能落差很大。
            // 桌面版維持原本的 RECORDING_FPS（30）完全不動。
            frameRate: {
              ideal: isDesktop ? RECORDING_FPS : MOBILE_RECORDING_FPS,
              max: isDesktop ? RECORDING_FPS : MOBILE_RECORDING_FPS,
            },
          },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        cameraSourceTypeRef.current = detectCameraSourceType(
          stream.getVideoTracks()[0]?.label
        );
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

        // 讓畫面先顯示出來（上面已經 setCameraActive），但「開始驗證」
        // 按鈕多等一下再解鎖，給自動對焦/曝光時間穩定。
        setCameraWarmingUp(true);
        setTimeout(() => setCameraWarmingUp(false), 1500);
      } else {
        throw new Error('瀏覽器不支援相機 API');
      }
    } catch (err: any) {
      console.warn('Real camera error / fallback:', err);
      setCameraErrorMsg(err?.message || '未能獲取相機授權');
      setCameraActive(true);
      setUseSimulatedFeed(true);
      // 沒能拿到真的鏡頭 stream，走的是模擬畫面，不是真人裝置錄的內容，
      // 標記為虛擬攝影機比標成實體相機更貼近事實。
      cameraSourceTypeRef.current = '虛擬攝影機';
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

      // 揮手挑戰進來時嘗試鎖定曝光時間（見 WAVE_EXPOSURE_LOCK_ENABLED
      // 上方說明），離開揮手挑戰（不管換到下一個動作還是整個流程結束）
      // 都要恢復自動曝光，不能讓後面的動作/照明挑戰一直卡在手動曝光。
      // 2026-09-07：這段原本沒有限定只在手機版執行，導致桌面版鏡頭也
      // 被強制切成手動曝光——桌面版真人測試回報揮手步驟突然變頓、
      // 曝光跑掉，就是這裡造成的。這個功能設計的目標本來就是 Android
      // Chrome 手機錄影的動態模糊問題，桌面版從來沒有這個問題（見
      // FaceVerificationEngine.tsx 開頭多處「桌面版完全不動」的原則），
      // 加回 isDesktop 判斷，桌面版鏡頭完全不受這段影響。
      if (!isDesktop) {
        if (currentType === 'wave') {
          tryLockExposureForWave(streamRef.current);
        } else {
          restoreAutoExposureAfterWave(streamRef.current);
        }
      }

      setChallengeState('active');
      setWaveCount(0);
      let countdown = currentDef.durationSec;
      setCurrentCountdown(countdown);

      timer = setInterval(() => {
        countdown -= 1;

        // Wave mock progress within the 5s challenge
        if (currentType === 'wave') {
          if (countdown === 5) {
            setWaveCount(1); // First wave completed
            if (isDesktop) playAudioCue('wave'); else playMobileAudioCue('wave');
          } else if (countdown === 3) {
            setWaveCount(2); // Second wave completed
            if (isDesktop) playAudioCue('wave'); else playMobileAudioCue('wave');
          } else if (countdown === 1) {
            setWaveCount(3); // Third wave completed
            if (isDesktop) playAudioCue('wave'); else playMobileAudioCue('wave');
          }
        }

        if (countdown > 0) {
          setCurrentCountdown(countdown);
        } else {
          // 2026-08-26：countdown 歸零與「換下一個動作」原本分兩個 tick
          // 處理（歸零這個 tick 只顯示 completed，要再等一次 1000ms 的
          // tick 讓 countdown 變成 -1 才真的 clearInterval），導致每個
          // 動作實際多播了 1 秒，四個動作累積下來錄影總長變成約 26 秒，
          // 不是設計的 23 秒。改成同一個 tick 內完成「顯示完成」與
          // 「切換下一步」兩件事。
          setCurrentCountdown(0);
          if (currentType === 'wave') {
            setWaveCount(3);
          }
          setChallengeState('completed');
          // 2026-08-24：手機版動作結束時原本沒有任何提示音，只有等下一個
          // 動作開始時的提示才會有聲音，體驗上像是「完成」沒有被提示到。
          // 只加在手機版（!isDesktop），桌面版維持原樣、不動任何一行。
          if (!isDesktop) {
            playMobileAudioCue('action');
          }
          clearInterval(timer);
          if (currentChallengeIndex < activeSequence.length - 1) {
            setCurrentChallengeIndex((prev) => prev + 1);
          } else {
            // 挑戰順序規定最後一個動作永遠是 blink 或 wave_hand（見
            // api/routes.py get_challenge_order()），如果剛好是 wave_hand
            // 結束，曝光還鎖在手動模式，這裡要恢復，不能讓 Track3
            // 照明響應階段也卡在手動曝光。
            if (currentType === 'wave') {
              restoreAutoExposureAfterWave(streamRef.current);
            }
            // All 4 challenges completed -> Transition to Track 3: 照明響應 (5 seconds)
            setOverallStage('track3_photometric');
          }
        }
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [overallStage, currentChallengeIndex, activeSequence]);

  // Photometric Response：真的燈光序列，時長由這次隨機產生的 light_log
  // 決定（5 段、每段 400-600ms，不是固定 5 秒）。段落切換用 50ms 的
  // tick 檢查經過時間落在哪一段，不是逐秒遞減。
  useEffect(() => {
    if (overallStage !== 'track3_photometric') return;
    const lightLog = timelineRef.current.lightLog;
    if (!lightLog) {
      // 理論上 handleStartVerification 一定會先產生好，這裡只是防禦
      setOverallStage('processing');
      return;
    }

    // 2026-08-25：真人測試回報 Track 3 correlation 量不到，追問後使用者
    // 確認根因：如果隨機順序把 turn_left/turn_right 排在最後一個動作
    // 挑戰，語音提示一結束照明序列就立刻開始播放，使用者根本來不及把
    // 臉轉回正面，量到的是側臉反光，跟演算法預期「正面迎向螢幕」的
    // 反光模式完全不同。**原本在這裡加一段緩衝時間讓使用者轉回來，但
    // 使用者提出更好的做法**：與其拉長影片、拖慢後續分析，不如直接在
    // 挑戰順序洗牌時規定「最後一個動作永遠是 blink 或 wave_hand」（見
    // api/routes.py get_challenge_order() 的說明）——這兩個動作都不會
    // 讓頭轉離鏡頭，從源頭排除問題，不需要犧牲影片長度。這裡維持原本
    // 沒有緩衝的寫法。
    speakPrompt('請保持臉部不動。', 'track3_holding');
    setPhotoSubState('analyzing');

    // 2026-08-28：試過在這裡鎖定鏡頭曝光/白平衡（懷疑自動曝光會撫平
    // Track3 想量的反光訊號），但沒多久真人手機測試就回報「Step5
    // 設定開戶服務功能」畫面卡住滑不動，時間點剛好對得上（同一天新
    // 加的改動，鏡頭約束變更在 Android 上本來就容易讓鏡頭/GPU
    // pipeline 不穩定，殘留影響可能拖到下一個畫面才顯現）。這個功能
    // 本身的效果（Track3 correlation 有沒有真的改善）都還沒實測驗證
    // 過，卻先確定引發一個影響使用體驗的 bug，移除，不值得為了未確認
    // 的好處保留一個確定的問題。之後如果想再嘗試，建議先在獨立測試
    // 頁面驗證穩定性，不要直接跟正式驗證流程綁在一起。

    // 2026-08-25：phases.lighting 送給後端的影格範圍要用「照明序列真正
    // 開始播放」那一刻實測的經過時間，不用事先算好的理論值，兩者常常
    // 對不上、會讓相關係數失真。
    if (recordingStartPerfMsRef.current > 0) {
      timelineRef.current.actualLightingStartMs = performance.now() - recordingStartPerfMsRef.current;
    }

    const totalLightMs = lightLogDurationMs(lightLog);
    const phaseStart = performance.now();
    setCurrentLightSegmentIndex(0);

    const tick = setInterval(() => {
      const elapsed = performance.now() - phaseStart;
      const idx = lightLog.segments.findIndex(
        (seg) => elapsed >= seg.startMs && elapsed < seg.startMs + seg.durationMs
      );
      if (idx >= 0) setCurrentLightSegmentIndex(idx);
      setPhotoCountdown(Math.max(0, Math.ceil((totalLightMs - elapsed) / 1000)));
    }, 50);

    // 2026-08-27：真的停止錄影要比燈光序列播完再晚 LIGHTING_BUFFER_MS
    // ——下面 processing 階段送給後端的 phases.lighting 影格範圍，尾端
    // 會多加這段緩衝（見那邊的說明），如果這裡錄影提早停止，後端要求
    // 的影格範圍會超出影片實際長度，correlation 永遠算不出來（見這個
    // 常數宣告處的說明）。UI 上的語音提示／倒數還是照 totalLightMs
    // 結束，使用者不會感覺錄影變長，只是多錄了 0.4 秒沒人會注意到的
    // 尾巴。
    const endTimer = setTimeout(() => {
      clearInterval(tick);
      speakPrompt('照明響應驗證完成。', 'track3_completed');
      setPhotoSubState('completed');
    }, totalLightMs);

    const stopRecordingTimer = setTimeout(() => {
      // 停止錄影，onstop（在下面的 processing effect 裡等待）會 flush
      // 出最後一段資料，接著才真的組 payload 呼叫 /verify。
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setOverallStage('processing');
    }, totalLightMs + LIGHTING_BUFFER_MS);

    return () => {
      clearInterval(tick);
      clearTimeout(endTimer);
      clearTimeout(stopRecordingTimer);
    };
  }, [overallStage]);

  // Processing：真的呼叫 POST /verify，等後端五層分析跑完——實測數十秒
  // 到數分鐘（MediaPipe/InsightFace 在 CPU 上逐格運算），不是假的
  // 1.5 秒，見 07_Frontend_API_Integration_Specification.md 風險 7。
  useEffect(() => {
    if (overallStage !== 'processing') return;
    let cancelled = false;

    (async () => {
      // MediaRecorder.stop() 是非同步的，要等 onstop 真的把最後一段
      // 資料 flush 出來才能組出完整影片，不能提前用 recordedChunksRef
      // 現有內容當作已經完整。
      const recorder = mediaRecorderRef.current;
      const videoBlob = await new Promise<Blob>((resolve) => {
        if (!recorder || recorder.state === 'inactive') {
          resolve(new Blob(recordedChunksRef.current, { type: 'video/webm' }));
          return;
        }
        recorder.onstop = () => {
          resolve(new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'video/webm' }));
        };
      });

      // 2026-08-25：真人測試發現手機瀏覽器（推測是 iOS Safari 的
      // MediaRecorder 相容性問題）錄出來的檔案可能是 0 位元組，直接
      // 上傳的話後端只會回報「無法開啟影片檔」，看不出真正原因。這裡
      // 先擋下來，給使用者跟診斷都更明確的訊息，不要讓空檔案送出去。
      if (videoBlob.size === 0) {
        setVerifyError(
          '錄影失敗，沒有取得到任何影片資料，可能是瀏覽器不支援目前的錄影設定，請重新錄製，若持續發生請改用其他瀏覽器再試一次'
        );
        setOverallStage('error');
        return;
      }

      const { boundaries, actionPhaseEndMs, lightLog, totalMs, actualLightingStartMs } = timelineRef.current;
      if (cancelled) return;
      if (!lightLog || boundaries.length === 0) {
        setVerifyError('錄影資料不完整，請重新錄製');
        setOverallStage('error');
        return;
      }

      // 2026-08-25：lighting 階段的邊界改用 actualLightingStartMs
      // （track3_photometric 那個 useEffect 真正開始執行時量到的實際
      // 經過時間），不用 actionPhaseEndMs 這個事先算好的理論值——見
      // 那邊的說明，兩者常常對不上，會讓 Track 3 相關係數失真。
      // actualLightingStartMs 理論上一定會有值（handleStartVerification
      // 一定會先設定 recordingStartPerfMsRef，track3 階段一定會執行
      // 到），null 只是防禦性的 fallback，退回舊的理論值。
      const lightingStartMs = actualLightingStartMs ?? actionPhaseEndMs;

      // 2026-08-25：即使改用實測的 lightingStartMs，真人測試發現
      // correlation 還是會在不同次錄影間大幅波動（0.581／0.388／0.174）
      // ——因為切片是「剛好卡在理論時長邊界」，只要當次的實際延遲比量到
      // 的還多一點點，燈光序列尾端的畫面就會被整段切掉、後端完全沒有
      // 那幾格可以比對，訊號永久遺失，不是單純的雜訊。在頭尾各加一段
      // 緩衝時間，確保就算還有殘餘誤差，真正的燈光序列還是完整落在送
      // 出的影格範圍內。多送出來的緩衝影格無害：
      // track3_photometric/sequence.py 的 light_intensity_at() 本來就會
      // 把序列時間範圍外的時刻視為「第一段」或「最後一段」的亮度，
      // 不會產生假的訊號跳動。
      const lightingEndMs = lightingStartMs + lightLogDurationMs(lightLog);

      // 2026-08-27：phases 直接送毫秒，不在前端換算成影格索引——真人
      // 測試（申請人970）發現裝置實際錄影 fps 常常達不到假設的固定
      // 30fps（該次只有 24.4fps），前端算好的影格範圍會超出影片實際
      // 長度。換算這一步移到後端做，用解碼後量到的真實 fps，見
      // common/schemas.py RecordingPhases 的說明。
      const waveHandBoundary = boundaries.find((b) => b.action === 'wave_hand');
      const phases: RecordingPhases = {
        action: [0, lightingStartMs],
        lighting: [
          Math.max(0, lightingStartMs - LIGHTING_BUFFER_MS),
          lightingEndMs + LIGHTING_BUFFER_MS,
        ],
        occlusion: waveHandBoundary
          ? [waveHandBoundary.startMs, waveHandBoundary.endMs]
          : [0, lightingStartMs],
      };

      try {
        // 2026-08-25：verifyFace() 現在只回傳「已收到、背景處理中」的
        // 202 確認，不會等到五層分析全部跑完（實測數十秒到數分鐘）才
        // 回應——避免使用者被晾在這個畫面等太久，也避免 Cloudflare
        // Tunnel 這類 proxy 中途判定逾時掐斷連線。真正的 verdict（pass
        // /review/reject）留到 TermsSubmitScreen 送出開戶設定前才向
        // GET /verify-result 輪詢取得，見 client.ts waitForVerifyResult()。
        await verifyFace(
          applicantId,
          sessionId,
          videoBlob,
          lightLog,
          {
            challenges: backendOrderRef.current,
            recording: {
              durationSec: totalMs / 1000,
              fps: RECORDING_FPS,
              totalFrames: msToFrame(totalMs),
              phases,
            },
          },
          cameraSourceTypeRef.current
        );
        if (cancelled) return;

        setOverallStage('success');
        setTotalSecondsRemaining(0);
        speakPrompt('身分驗證資料已送出。', 'verification_success');
        onVerificationComplete();
      } catch (err) {
        if (cancelled) return;
        setVerifyError(
          err instanceof ApiError ? err.message : '無法連線到後端伺服器，請確認伺服器是否已啟動'
        );
        setOverallStage('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [overallStage, applicantId, sessionId, onVerificationComplete]);

  // Start verification handler：真的開始錄影，不是只播動畫
  const handleStartVerification = () => {
    if (useSimulatedFeed || !streamRef.current) {
      setVerifyError('需要真的相機權限才能進行人臉驗證，請允許存取相機後重新整理頁面再試一次');
      setOverallStage('error');
      return;
    }
    if (orderLoading || orderError || backendOrderRef.current.length === 0) {
      setVerifyError(orderError || '尚未取得驗證挑戰順序，請稍候再試');
      setOverallStage('error');
      return;
    }

    // Prime and unlock audio context & speech synthesis on user gesture
    // 2026-08-25：原本這裡建立一個用完就丟的暫時 AudioContext 來解鎖
    // 權限，但 playAudioCue() 之後會另外建立、快取進 audioCtxRef 的是
    // 完全不同的一個 AudioContext 實例——iOS Safari 的音效播放權限是
    // 綁在「這一個 AudioContext 物件」上解鎖的，不同物件之間不會共用
    // 解鎖狀態，導致後面 playAudioCue() 播放的提示音在手機上失敗（多半
    // 是這個原因造成動作完成提示音聽不到）。改成直接建立、解鎖
    // audioCtxRef.current 這個之後會真的拿來播放提示音的同一個物件。
    if (typeof window !== 'undefined') {
      if ('speechSynthesis' in window) {
        // 2026-08-30：試過在這裡加一個音量 0 的 speak() 呼叫來解鎖手機
        // 語音（理由見下面被拿掉的那段），結果真人測試回報**連原本能用
        // 的音效提示都跟著壞掉**——懷疑 speak() 這個呼叫本身在 Android
        // Chrome 上會影響同一次使用者手勢堆疊內接下來的 AudioContext/
        // <audio> 解鎖判定（可能是搶了 media session、或讓瀏覽器認定
        // 這次使用者手勢已經被消耗掉）。這是本末倒置——音效原本就正常
        // 能用，不該為了修語音把音效也弄壞。先退回只做 cancel()/
        // resume()，語音消失的問題保留、之後要修再另外想辦法, 不要
        // 在同一個使用者手勢的呼叫堆疊裡插一個真的 speak()。
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
      }
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          if (!audioCtxRef.current) {
            audioCtxRef.current = new AudioCtx();
          }
          audioCtxRef.current.resume().catch(() => {});
          // 2026-08-25：上面那個 AudioContext 統一的修法被真人測試證實
          // 沒有解決問題（提示音還是聽不到）——代表光是 resume() 不夠。
          // iOS Safari 有個更嚴格的已知需求：要在使用者手勢的呼叫堆疊
          // 內，真的啟動並播放（哪怕是無聲的）一個音源節點，`resume()`
          // 本身不算數。這裡額外播放一個極短、音量為 0 的 buffer
          // source 來完成這個「真的播放過一次」的解鎖動作，不會有
          // 使用者聽得到的聲音、純粹是解鎖用途。
          const ctx = audioCtxRef.current;
          const silentBuffer = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
          const silentSource = ctx.createBufferSource();
          silentSource.buffer = silentBuffer;
          silentSource.connect(ctx.destination);
          silentSource.start(0);
        }
      } catch (_) {}
    }

    // 2026-08-25：手機版 <audio> 提示音也要在同一個使用者手勢的呼叫
    // 堆疊內先播放解鎖過一次，之後 playMobileAudioCue() 用程式呼叫
    // play() 才會成功——這段完全獨立於上面桌面版的 AudioContext 解鎖
    // 邏輯，不影響桌面版任何行為。
    if (!isDesktop) {
      try {
        mobileActionAudioRef.current?.play().catch(() => {});
        mobileSuccessAudioRef.current?.play().then(() => {
          mobileSuccessAudioRef.current?.pause();
          if (mobileSuccessAudioRef.current) mobileSuccessAudioRef.current.currentTime = 0;
        }).catch(() => {});
      } catch (_) {}
    }

    // 預先算好整段時間表：動作階段照伺服器指派的順序＋固定秒數，
    // 加上這次隨機產生的燈光序列，一次決定、之後照表操課，不在過程中
    // 用計時器重新量測（避免誤差累積）。
    let cursor = 0;
    const boundaries = backendOrderRef.current.map((item) => {
      const durMs = ACTION_DURATIONS_SEC[item.action] * 1000;
      const startMs = cursor;
      cursor += durMs;
      return { action: item.action, startMs, endMs: cursor };
    });
    const actionPhaseEndMs = cursor;
    const lightLog = generateLightLog(Date.now());
    const totalMs = actionPhaseEndMs + lightLogDurationMs(lightLog);
    timelineRef.current = { boundaries, actionPhaseEndMs, lightLog, totalMs };

    // 啟動真的錄影，跟預覽共用同一個 camera stream。mimeType 優先選
    // 瀏覽器支援的 mp4，其次 webm——後端 OpenCV(ffmpeg) 兩種都能讀
    // （已實測驗證過 webm 容器的 fps/影格數讀取正確），不強求一定要
    // mp4，見 PHASE1_NOTES 的說明。
    const mimeCandidates = [
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = mimeCandidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    recordedChunksRef.current = [];
    // 2026-08-30：真人測試（Android，S23 Ultra，鏡頭硬體規格不差）持續
    // 回報清晰度過不了關（連續測到 23-32，門檻 50），iPhone 完全沒事。
    // 沒有指定 videoBitsPerSecond 時，MediaRecorder 用瀏覽器自己的預設
    // 位元率——同一天稍早把手機版鏡頭視角從窄長寬比放寬到 960x960
    // （為了解決要伸長手臂才能整臉入鏡的問題），畫面解析度變大了，
    // 如果編碼位元率沒有跟著調高，同樣的資料量攤到更多像素上，畫質
    // 就會被壓得更糊——這比較可能是「換視角之後才開始」的清晰度問題
    // 真正成因，不是鏡頭硬體或手震。明確指定一個夠高的位元率，不讓
    // 瀏覽器自己選保守的預設值。
    const recorderOptions: MediaRecorderOptions = {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 6_000_000,
    };
    const recorder = new MediaRecorder(streamRef.current, recorderOptions);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };
    mediaRecorderRef.current = recorder;
    // 2026-08-25：原本 start() 沒帶參數，代表 ondataavailable 只會在
    // stop() 那一刻觸發一次——這個寫法在部分手機瀏覽器（尤其 iOS
    // Safari）上不可靠，實測發現整支影片最後組出來是 0 位元組（見
    // PHASE1_NOTES.md）。改成帶 timeslice（每 1 秒觸發一次），資料
    // 分段累積，也降低最後那一次沒觸發就整支報銷的風險。
    recorder.start(1000);
    // 見上面 timelineRef 的說明：這是「錄影真正開始」的時間基準點，
    // track3_photometric 那個 useEffect 會拿它來量測照明階段實際延遲
    // 了多久才開始播放，不是用事先算好的理論值。
    recordingStartPerfMsRef.current = performance.now();

    lastSpokenKeyRef.current = '';
    setVerifyError('');
    setTotalSecondsRemaining(Math.ceil(totalMs / 1000));
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
    if (overallStage === 'error') return 'warning';
    if (overallStage === 'processing') return 'thinking';
    if (overallStage === 'verifying_actions' || overallStage === 'track3_photometric') return 'scanning';
    return 'welcoming';
  };

  return (
    <div className="w-full flex flex-col items-center">
      {/* 手機版動作提示音用的隱藏 <audio> 元素，見 playMobileAudioCue()
          跟 ../../utils/mobileAudioCues.ts 的說明，桌面版不會用到這兩個。 */}
      {!isDesktop && (
        <>
          <audio ref={mobileActionAudioRef} src={MOBILE_AUDIO_CUE_ACTION} preload="auto" className="hidden" />
          <audio ref={mobileSuccessAudioRef} src={MOBILE_AUDIO_CUE_SUCCESS} preload="auto" className="hidden" />
        </>
      )}
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

        {/* TRACK 3: 真的螢幕燈光顏色序列——顯示的顏色/切換時機就是實際
            寫進 light_log 上傳給後端的那組資料，不是裝飾動畫。這裡故意
            用高不透明度：Track 3 要靠反射到臉上的光夠亮才量得到訊號，
            原本那個柔和的半透明效果只是視覺演出，量不到真的反射。
            2026-08-23：試過改成 `fixed inset-0` 填滿整個瀏覽器視窗
            （猜測擴大發光面積能提高 correlation），真人測試兩筆的
            correlation（0.194、0.269）反而都比改之前的最佳值（0.523）
            差，證據指向反效果，改回原本只填滿鏡頭預覽框的版本。根因
            還沒查清楚，見 PHASE1_NOTES.md §10.14 後續。 */}
        {overallStage === 'track3_photometric' &&
          timelineRef.current.lightLog &&
          (() => {
            const seg = timelineRef.current.lightLog!.segments[currentLightSegmentIndex];
            return (
              <div
                id="photometric-lighting-effect"
                className="absolute inset-0 pointer-events-none z-10 transition-colors duration-150"
                style={{ backgroundColor: seg?.hex, opacity: 0.88, mixBlendMode: 'normal' }}
              />
            );
          })()}

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
                    if (isDesktop) playAudioCue('action'); else playMobileAudioCue('action');
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
                          ? `揮手進度: ${waveCount}/3 次 ${waveCount >= 3 ? '✓ (已完成)' : '(請將手抬至臉前揮手)'}`
                          : `揮手進度: ${waveCount}/3 次 ${waveCount >= 3 ? '✓ 已完成' : '(請將手抬至臉前)'}`}
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
              // 2026-08-21：框加大約 15%（235x305 / 285x355），鼓勵使用者
              // 站近一點，臉在畫面裡佔比才會夠（配合上面攝影機長寬比調整
              // 一起改的，見 handleStartCamera 的說明）。要退回原本大小，
              // 改回 w-[205px] h-[265px] sm:w-[250px] sm:h-[310px]
              // rounded-[105px] sm:rounded-[125px] 即可。
              className={`relative w-[235px] h-[305px] sm:w-[285px] sm:h-[355px] rounded-[120px] sm:rounded-[145px] transition-all duration-500 flex flex-col items-center justify-center ${
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

              {/* 2026-09-01：長輩使用者實測發現拿手機習慣性離很遠，臉在
                  畫面中偏小，Track3/baseline 判定失敗率也偏高。原本只
                  在動畫示範畫面最後放過一次提醒，使用者反饋「不明顯」，
                  改成在這裡（準備開始的中央取景框內）用動畫示範，這是
                  使用者按下開始鍵前最後、也最顯眼的畫面位置。 */}
              {overallStage === 'ready' && (
                <div className="relative w-full h-full flex flex-col items-center justify-center select-none px-4 text-center gap-3">
                  <motion.div
                    animate={{ scale: [0.55, 1.15, 0.55] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <AIGuardian size="lg" mood="guiding" />
                  </motion.div>
                  <div className="flex items-center gap-2.5 text-sm sm:text-base font-medium text-amber-800 bg-amber-50 px-3 py-2 rounded-2xl border border-amber-200 shadow-lg leading-snug">
                    <ScanFace className="h-5 w-5 text-amber-600 shrink-0" />
                    <span>
                      請將臉靠近鏡頭
                      <br />
                      讓臉部完整佔滿框內
                    </span>
                  </div>
                </div>
              )}

              {/* FACE LANDMARK GUIDE: Eyes, Nose, Mouth */}
              <div className={`relative w-full h-full flex flex-col items-center justify-center select-none ${overallStage === 'ready' ? 'hidden' : ''}`}>
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
                  {orderLoading
                    ? '正在向伺服器取得本次驗證的動作順序…'
                    : orderError
                    ? orderError
                    : cameraWarmingUp
                    ? '鏡頭準備中，正在校正對焦與曝光…'
                    : '共 4 項動作與照明響應，請依語音提示操作。'}
                </p>
              </div>

              <button
                id="start-face-verify-btn"
                type="button"
                onClick={handleStartVerification}
                disabled={orderLoading || !!orderError || cameraWarmingUp}
                className="w-full py-3.5 rounded-2xl bg-sky-500 hover:bg-sky-400 active:scale-[0.99] text-white font-bold text-sm shadow-lg shadow-sky-500/30 flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="h-4 w-4 fill-white" />
                <span>{orderLoading ? '準備中…' : cameraWarmingUp ? '鏡頭準備中…' : '開始動態驗證'}</span>
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

              {/* 2026-08-25：/verify 改非同步後，這裡只代表「錄影跟資料
                  已成功送出給後端」，不代表已經判定通過——真正的 verdict
                  還在背景分析中，不能在這裡就講「已通過」。文案改成中性
                  的「已送出、AI 正在複核」，使用者可以先繼續完成後面的
                  開戶設定步驟，不用在這裡空等。 */}
              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-300 bg-sky-950/80 px-3.5 py-1 rounded-full border border-sky-400/30">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>驗證資料已送出</span>
                </span>
                <h4 className="text-lg font-black text-white mt-2.5">系統正在進行最後複核</h4>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  動作核驗與照明響應資料已上傳，系統正在背景比對分析，您可以先繼續完成後面的開戶設定，結果將依您選擇的通知方式另行通知。
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

          {/* Error State：錄影/上傳/連線本身出錯（verifyError 有值）。
              /verify 改非同步後，pass/review/reject 的判定已經不在這個
              畫面裡揭曉了（見上面 processing effect 的說明），這裡只
              處理送出過程本身失敗的情況，不能讓使用者直接往下一步走，
              只能重新錄一次。 */}
          {overallStage === 'error' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-sm bg-slate-900/95 backdrop-blur-xl p-6 rounded-3xl border border-rose-400/50 text-white flex flex-col items-center text-center space-y-4 shadow-2xl"
            >
              <div className="h-14 w-14 rounded-2xl bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-500/30">
                <AlertTriangle className="h-8 w-8" />
              </div>

              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-300 bg-rose-950/80 px-3.5 py-1 rounded-full border border-rose-400/30">
                  驗證失敗
                </span>
                <h4 className="text-lg font-black text-white mt-2.5">發生錯誤</h4>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  {verifyError}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setVerifyError('');
                  setOverallStage('ready');
                  // 2026-08-21：原本只重置畫面狀態，沒有重新跟攝影機要一次
                  // 串流——同一個 MediaStream 會一路沿用到底，如果錄影
                  // 環境中途變了（例如重新打光），攝影機的自動曝光/白平衡
                  // 不一定會即時大幅重新校正。改成重新錄製時也重新啟動
                  // 攝影機，讓它有機會針對當下環境重新協商曝光參數。
                  if (!useSimulatedFeed) {
                    startCamera();
                  }
                }}
                className="w-full py-3.5 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-[0.99] text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-all border border-white/10"
              >
                <RotateCcw className="h-4 w-4" />
                <span>重新錄製</span>
              </button>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};
