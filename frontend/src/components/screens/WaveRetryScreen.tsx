import React, { useEffect, useRef, useState } from 'react';
import { Hand, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { getWaveRetryInfo, submitWaveRetry, ApiError } from '../../api/client';
import { ACTION_DURATIONS_SEC, RECORDING_FPS } from '../../utils/verificationRecording';

// 2026-09-01 新增：揮手動作補錄頁，見 config.WAVE_RETRY_TOKEN_EXPIRY_HOURS
// 跟 api/routes.py _wave_retry_eligible() 的說明。使用者從 email 連結
// 直接打開這個頁面，不是走原本六步驟開戶流程的一部分，是完全獨立的
// 一次性頁面：驗證 token → 開相機 → 錄 7 秒揮手 → 送出 → 顯示結果。
//
// 刻意不重用 FaceVerificationEngine.tsx——那支元件緊密綁定完整六步驟
// 流程（挑戰順序、燈光反應、語音提示等），這裡只需要錄一個單一動作，
// 硬要共用反而要拆解一堆跟這個頁面無關的邏輯，風險比重寫一份簡化版
// 還高。相機解析度沿用 FaceVerificationEngine.tsx 手機版已經驗證有效
// 的 640x640（見當天對話紀錄：降低解析度讓 Chrome 固定位元率覆蓋的
// 像素變少，畫質變好），沒有沿用那邊還在實驗、未驗證有效的曝光鎖定
// （WAVE_EXPOSURE_LOCK_ENABLED）。

type ScreenState = 'loading' | 'invalid' | 'ready' | 'recording' | 'uploading' | 'done' | 'upload_error';

const WAVE_DURATION_SEC = ACTION_DURATIONS_SEC.wave_hand;

function getSupportedMimeType(): string | undefined {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return undefined;
}

interface WaveRetryScreenProps {
  token: string;
}

export const WaveRetryScreen: React.FC<WaveRetryScreenProps> = ({ token }) => {
  const [state, setState] = useState<ScreenState>('loading');
  const [applicantName, setApplicantName] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [secondsLeft, setSecondsLeft] = useState<number>(WAVE_DURATION_SEC);
  const [resultVerdict, setResultVerdict] = useState<'pass' | 'review' | 'reject' | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await getWaveRetryInfo(token);
        if (cancelled) return;
        setApplicantName(info.applicantName);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof ApiError ? err.message : '無法連線到伺服器，請稍後再試');
        setState('invalid');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    // 離開頁面時務必關掉相機，不留著佔用裝置鏡頭。
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = async () => {
    setErrorMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 640 },
          frameRate: { ideal: RECORDING_FPS, max: RECORDING_FPS },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      chunksRef.current = [];
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' });
        void uploadRetry(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setState('recording');
      setSecondsLeft(WAVE_DURATION_SEC);
    } catch (err: any) {
      setErrorMsg(err?.message || '無法取得相機權限，請確認已允許本頁面使用相機');
    }
  };

  useEffect(() => {
    if (state !== 'recording') return;
    if (secondsLeft <= 0) {
      recorderRef.current?.stop();
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [state, secondsLeft]);

  const uploadRetry = async (blob: Blob) => {
    setState('uploading');
    try {
      const result = await submitWaveRetry(token, blob);
      setResultVerdict(result.verdict);
      setState('done');
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : '上傳失敗，請確認網路連線後再試一次');
      setState('upload_error');
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-900 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 sm:p-8 space-y-5">
        {state === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-10 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">確認連結中...</p>
          </div>
        )}

        {state === 'invalid' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="h-12 w-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="text-base font-black text-slate-900">連結無法使用</h2>
            <p className="text-sm text-slate-500">{errorMsg}</p>
          </div>
        )}

        {(state === 'ready' || state === 'recording' || state === 'uploading') && (
          <>
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center shrink-0">
                <Hand className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-900">{applicantName} 您好</h2>
                <p className="text-xs text-slate-500">請重新錄製「臉前揮手」這個動作</p>
              </div>
            </div>

            <div className="relative w-full aspect-square rounded-2xl bg-slate-900 overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
              {state === 'recording' && (
                <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-rose-600 text-white text-xs font-bold">
                  {secondsLeft}s
                </div>
              )}
              {state === 'ready' && (
                <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs">
                  尚未開啟相機
                </div>
              )}
            </div>

            {state === 'ready' && (
              <>
                <p className="text-xs text-slate-500 leading-relaxed bg-amber-50 border border-amber-200/80 rounded-xl p-3">
                  建議將手機放穩（例如靠著桌面或用雙手扶著），放慢速度，將手抬到臉的高度前後揮動至少三次。
                </p>
                {errorMsg && <p className="text-xs text-rose-600">{errorMsg}</p>}
                <button
                  type="button"
                  onClick={startRecording}
                  className="w-full py-3.5 rounded-2xl bg-sky-500 hover:bg-sky-600 active:scale-[0.99] text-white font-bold text-sm shadow-lg shadow-sky-500/20 cursor-pointer transition-all"
                >
                  開始錄影
                </button>
              </>
            )}

            {state === 'recording' && (
              <p className="text-center text-sm font-bold text-slate-700">
                請放慢速度，在臉前來回揮手
              </p>
            )}

            {state === 'uploading' && (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                上傳中，請稍候...
              </div>
            )}
          </>
        )}

        {state === 'upload_error' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="h-12 w-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <p className="text-sm text-rose-600">{errorMsg}</p>
            <button
              type="button"
              onClick={() => setState('ready')}
              className="px-5 py-2.5 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm cursor-pointer transition-all"
            >
              再試一次
            </button>
          </div>
        )}

        {state === 'done' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="h-12 w-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h2 className="text-base font-black text-slate-900">已收到您重新錄製的影片</h2>
            <p className="text-sm text-slate-500">
              {resultVerdict === 'pass'
                ? '驗證已通過，我們已寄送通知信給您，請依信件指示完成開戶設定。'
                : '案件將由專人進一步複核，結果會透過 email 通知您，請留意信箱。'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
