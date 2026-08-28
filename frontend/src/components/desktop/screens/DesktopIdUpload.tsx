import React, { useState, useRef, useEffect } from 'react';
import { FormData } from '../../../types';
import { defaultMockOcrData } from '../../../data/mockOcrData';
import { 
  ArrowRight, 
  Camera, 
  Upload, 
  CheckCircle2, 
  RotateCcw, 
  AlertTriangle, 
  RefreshCw, 
  X, 
  Check,
  CreditCard,
  ScanLine,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { rectifyIdCard } from '../../../api/client';

interface DesktopIdUploadProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

type IdCardSide = 'front' | 'back';

export const DesktopIdUpload: React.FC<DesktopIdUploadProps> = ({
  formData,
  updateFormData,
  onNext,
}) => {
  const [activeSide, setActiveSide] = useState<IdCardSide>('front');
  const [frontCaptured, setFrontCaptured] = useState<boolean>(formData.idFrontCaptured || false);
  const [backCaptured, setBackCaptured] = useState<boolean>(formData.idBackCaptured || false);
  const [frontImage, setFrontImage] = useState<string | null>(formData.idFrontImage || null);
  const [backImage, setBackImage] = useState<string | null>(formData.idBackImage || null);

  // Camera modal state
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [cameraSide, setCameraSide] = useState<IdCardSide>('front');
  const [isCardAligned, setIsCardAligned] = useState<boolean>(false);
  const [ocrStatus, setOcrStatus] = useState<'idle' | 'scanning' | 'success' | 'failed'>('idle');
  const [rectifyStatus, setRectifyStatus] = useState<'idle' | 'capturing' | 'failed'>('idle');
  const [rectifyError, setRectifyError] = useState<string>('');
  // 2026-08-25：見下面 startCamera() 的說明——getUserMedia 失敗時，原本
  // 只有 console.warn，畫面完全沒有任何反應，使用者看不出鏡頭其實沒有
  // 真的啟動（下面假的「已對齊」計時器還是照樣跑，誤導使用者以為一切
  // 正常）。加這個狀態把失敗原因顯示出來。
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 2026-08-25：定期取樣畫面中央區域算邊緣密度用的暫存 canvas，跟下面
  // 拍照用的 canvasRef 分開，避免互相干擾（同 IdUploadScreen.tsx 的
  // scanCanvasRef，見那邊的說明）。
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // 2026-08-25：見下面掃描 useEffect 的說明——即時對齊偵測要抓「畫面上
  // 真正顯示的四角引導框」所在的實際區域，這兩個 ref 用來量測引導框
  // 跟它的容器在螢幕上的實際位置。
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const guideBoxRef = useRef<HTMLDivElement | null>(null);
  // 2026-08-25：見 IdUploadScreen.tsx（mobile 版）同一段說明——原本掛
  // 在 DOM 上、用 CSS `hidden` 藏起來的 <canvas> 在部分 iOS Safari
  // 版本上，拍照畫進去的內容有可能沒有真的被畫出來（真人測試證實
  // mobile 版拍出純黑畫面），改成懶建立、完全不掛 DOM 的離屏 canvas。
  // 桌面版理論上不受這個 WebKit 怪癖影響（一般用桌面瀏覽器），但兩邊
  // 共用同一套邏輯模式，這裡一起改掉避免同一顆坑分岔成兩份程式碼。
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 2026-08-25：這裡原本是假的——不管鏡頭前面有沒有東西，固定等 1.2
  // 秒就顯示「已對齊」，跟後端真的偵測結果常常對不起來。mobile 版
  // （IdUploadScreen.tsx）已經改成真的定期取樣邊緣密度，桌面版卻一直
  // 沒有跟著改，這是「桌面版身分證問題一樣沒解決」的原因之一——桌面版
  // 使用者看到的「已對齊」指示燈其實從來沒有跟真實畫面有任何關係。
  // 改成跟 mobile 版同一套邏輯：定期（350ms）取樣畫面中央區域，算
  // 邊緣密度當作「這裡有沒有明顯邊界」的粗略指標。這不是跟後端一樣的
  // Canny＋四邊形偵測，只是前端即時回饋用的粗略估計，真正的判斷還是
  // 以拍照後送到後端的結果為準。
  //
  // 2026-08-25 修正：見 IdUploadScreen.tsx（mobile 版）同一段說明——
  // 取樣區域原本寫死「畫面中央 70% 寬、45% 高」，但畫面上顯示的引導框
  // 是 `w-[58%] max-w-[360px] aspect-[1.58/1]`，兩者對不起來，導致
  // 使用者對準畫面上的框、實際取樣到的卻大半是框外背景，永遠亮不起
  // 「已對齊」。改成直接量測引導框的實際像素位置。桌面版鏡頭畫面另外
  // 有 `-scale-x-100` 鏡像（見上面 <video> 的說明，這裡刻意保留，不能
  // 拿掉），換算取樣區域時要多考慮這個水平鏡像，不然取樣到的會是
  // 引導框的鏡像位置、跟真人測試的表現完全對不起來。
  useEffect(() => {
    if (!isCameraOpen) {
      setIsCardAligned(false);
      return;
    }
    setIsCardAligned(false);

    const SAMPLE_W = 64;
    const SAMPLE_H = 40;
    const EDGE_DENSITY_THRESHOLD = 18;

    const interval = setInterval(() => {
      const video = videoRef.current;
      const container = videoContainerRef.current;
      const guideBox = guideBoxRef.current;
      if (!video || video.videoWidth === 0 || !container || !guideBox) return;

      if (!scanCanvasRef.current) {
        scanCanvasRef.current = document.createElement('canvas');
      }
      const canvas = scanCanvasRef.current;
      canvas.width = SAMPLE_W;
      canvas.height = SAMPLE_H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;

      const containerRect = container.getBoundingClientRect();
      const guideRect = guideBox.getBoundingClientRect();
      const scale = Math.max(containerRect.width / vw, containerRect.height / vh);
      const displayedW = vw * scale;
      const displayedH = vh * scale;
      const offsetX = (displayedW - containerRect.width) / 2;
      const offsetY = (displayedH - containerRect.height) / 2;

      // 鏡像：畫面上看到的引導框左緣，對應到未鏡像原始畫面的右側，
      // 所以左緣要用「容器寬度 - 引導框右緣」來換算，不是直接用左緣。
      const guideLeftOnScreen = guideRect.left - containerRect.left;
      const guideRightOnScreen = guideRect.right - containerRect.left;
      const unmirroredLeft = containerRect.width - guideRightOnScreen;

      const cropX = (unmirroredLeft + offsetX) / scale;
      const cropY = (guideRect.top - containerRect.top + offsetY) / scale;
      const cropW = guideRect.width / scale;
      const cropH = guideRect.height / scale;
      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, SAMPLE_W, SAMPLE_H);

      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
      } catch (_) {
        return;
      }

      const gray = new Float32Array(SAMPLE_W * SAMPLE_H);
      for (let i = 0; i < SAMPLE_W * SAMPLE_H; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      }

      let edgeSum = 0;
      let count = 0;
      for (let y = 0; y < SAMPLE_H; y++) {
        for (let x = 0; x < SAMPLE_W - 1; x++) {
          edgeSum += Math.abs(gray[y * SAMPLE_W + x] - gray[y * SAMPLE_W + x + 1]);
          count++;
        }
      }
      for (let y = 0; y < SAMPLE_H - 1; y++) {
        for (let x = 0; x < SAMPLE_W; x++) {
          edgeSum += Math.abs(gray[y * SAMPLE_W + x] - gray[(y + 1) * SAMPLE_W + x]);
          count++;
        }
      }

      const edgeDensity = count > 0 ? edgeSum / count : 0;
      setIsCardAligned(edgeDensity >= EDGE_DENSITY_THRESHOLD);
    }, 350);

    return () => clearInterval(interval);
  }, [isCameraOpen, cameraSide]);

  const startCamera = async (side: IdCardSide) => {
    setCameraSide(side);
    setIsCameraOpen(true);
    setIsCardAligned(false);
    setCameraErrorMsg(null);
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      } else {
        throw new Error('瀏覽器不支援相機 API');
      }
    } catch (err: any) {
      // 2026-08-25：原本這裡只有 console.warn，畫面上完全沒有任何提示
      // ——鏡頭其實沒有啟動，但假的對齊計時器照樣會跑、拍照按鈕照樣
      // 可以按，使用者完全看不出來鏡頭沒開，拍出來的自然是空畫面。
      // 改成把錯誤顯示出來、關閉相機 modal，不要讓使用者對著一個沒有
      // 真的在錄影的畫面按快門。
      console.warn('Camera not directly accessible', err);
      setCameraErrorMsg(err?.message || '未能取得相機權限，請確認瀏覽器已允許存取攝影機');
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  const captureVideoFrameAsBlob = (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return Promise.resolve(null);
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92));
  };

  const runRectify = async (side: IdCardSide, blob: Blob) => {
    setRectifyStatus('capturing');
    setRectifyError('');
    try {
      const result = await rectifyIdCard(blob);
      if (!result.success || !result.rectified) {
        setRectifyStatus('failed');
        setRectifyError(result.message || '未偵測到證件邊界，請重新拍攝');
        return;
      }
      setRectifyStatus('idle');
      if (side === 'front') {
        setFrontCaptured(true);
        setFrontImage(result.rectified);
      } else {
        setBackCaptured(true);
        setBackImage(result.rectified);
      }
      triggerOcrRecognition(side, result.rectified);
    } catch (err) {
      setRectifyStatus('failed');
      setRectifyError('無法連線到後端伺服器，請確認伺服器是否已啟動');
    }
  };

  const handleSnapPhoto = async () => {
    const blob = await captureVideoFrameAsBlob();
    stopCamera();
    if (!blob) {
      setRectifyStatus('failed');
      setRectifyError('無法擷取相機畫面，請重新開啟相機');
      return;
    }
    await runRectify(cameraSide, blob);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await runRectify(activeSide, file);
    }
  };

  const triggerOcrRecognition = (side: IdCardSide, imgUrl: string) => {
    setOcrStatus('scanning');
    setTimeout(() => {
      setOcrStatus('success');
      if (side === 'front') {
        updateFormData({
          idFrontCaptured: true,
          idFrontImage: imgUrl,
          fullName: formData.fullName || defaultMockOcrData.fullName,
          idNumber: formData.idNumber || defaultMockOcrData.idNumber,
          birthday: formData.birthday || defaultMockOcrData.birthday,
          address: formData.address || defaultMockOcrData.address,
        });
        if (!backCaptured) {
          setActiveSide('back');
        }
      } else {
        updateFormData({
          idBackCaptured: true,
          idBackImage: imgUrl,
          ocrCompleted: true,
        });
      }
    }, 1000);
  };

  const handleRetake = (side: IdCardSide) => {
    if (side === 'front') {
      setFrontCaptured(false);
      setFrontImage(null);
      updateFormData({ idFrontCaptured: false, idFrontImage: undefined });
    } else {
      setBackCaptured(false);
      setBackImage(null);
      updateFormData({ idBackCaptured: false, idBackImage: undefined });
    }
    setOcrStatus('idle');
  };

  const isBothCompleted = frontCaptured && backCaptured;

  return (
    <div className="flex flex-col flex-1 justify-center py-6 px-4 sm:px-8 max-w-4xl mx-auto w-full">
      <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200/80 shadow-xs space-y-6">
        <div>
          <span className="text-xs font-bold text-sky-600 bg-sky-50 px-2.5 py-1 rounded-md border border-sky-100">
            Step 2 / 6
          </span>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-2">
            身分證正反面驗證
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            請分別完成中華民國國民身分證「正面」與「反面」之拍攝或上傳。
          </p>
        </div>

        {rectifyStatus === 'capturing' && (
          <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs font-semibold text-sky-700 flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            <span>正在偵測證件邊界…</span>
          </div>
        )}
        {rectifyStatus === 'failed' && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{rectifyError}</span>
          </div>
        )}
        {cameraErrorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>相機無法啟動：{cameraErrorMsg}，請改用「上傳正面圖檔」</span>
          </div>
        )}

        {/* 2-Column Side by Side Layout for Desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 1. FRONT CARD CONTAINER */}
          <div className="p-5 rounded-3xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-sky-600" />
                身分證【正面】
              </span>
              {frontCaptured ? (
                <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> 已完成
                </span>
              ) : (
                <span className="text-xs text-rose-500 font-bold bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200">
                  尚未上傳
                </span>
              )}
            </div>

            {/* Preview or Frame */}
            {!frontCaptured ? (
              <div className="relative w-full aspect-[16/10] rounded-2xl border border-dashed border-sky-300 bg-white flex flex-col items-center justify-center p-3 text-center overflow-hidden">
                <div className="relative w-40 h-25 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between p-2">
                  <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-sky-400 rounded-tl-xs pointer-events-none" />
                  <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-sky-400 rounded-tr-xs pointer-events-none" />
                  <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-sky-400 rounded-bl-xs pointer-events-none" />
                  <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-sky-400 rounded-br-xs pointer-events-none" />
                  <div className="flex items-center gap-1.5">
                    <div className="w-3.5 h-3.5 rounded-full bg-sky-100 flex items-center justify-center text-[7px] text-sky-600 font-bold">正</div>
                    <div className="w-14 h-1.5 rounded-full bg-slate-200" />
                  </div>
                  <div className="flex justify-between items-end">
                    <div className="w-16 h-1.5 rounded-full bg-slate-200" />
                    <div className="w-7 h-9 rounded-xs bg-sky-100 flex items-center justify-center text-[7px] text-sky-400 font-medium">照片</div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 font-medium">含姓名、身分證字號與大頭照</p>
              </div>
            ) : (
              <div className="relative w-full aspect-[16/10] rounded-2xl border border-slate-200 bg-slate-900 overflow-hidden flex items-center justify-center">
                <img src={frontImage || '/id-card-sample.jpg'} alt="正面" className="w-full h-full object-cover" />
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> 資料辨識完成
                </div>
              </div>
            )}

            {/* Front Controls */}
            {!frontCaptured ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => startCamera('front')}
                  className="py-2.5 px-3 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs cursor-pointer transition-all"
                >
                  <Camera className="h-4 w-4" />
                  <span>鏡頭拍照</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSide('front');
                    fileInputRef.current?.click();
                  }}
                  className="py-2.5 px-3 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-200 cursor-pointer transition-all"
                >
                  <Upload className="h-4 w-4 text-slate-500" />
                  <span>檔案上傳</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleRetake('front')}
                className="w-full py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center gap-1 border border-slate-200 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>重新上傳正面</span>
              </button>
            )}
          </div>

          {/* 2. BACK CARD CONTAINER */}
          <div className="p-5 rounded-3xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-sky-600" />
                身分證【反面】
              </span>
              {backCaptured ? (
                <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> 已完成
                </span>
              ) : (
                <span className="text-xs text-rose-500 font-bold bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200">
                  尚未上傳
                </span>
              )}
            </div>

            {/* Preview or Frame */}
            {!backCaptured ? (
              <div className="relative w-full aspect-[16/10] rounded-2xl border border-dashed border-sky-300 bg-white flex flex-col items-center justify-center p-3 text-center overflow-hidden">
                <div className="relative w-40 h-25 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between p-2">
                  <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-sky-400 rounded-tl-xs pointer-events-none" />
                  <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-sky-400 rounded-tr-xs pointer-events-none" />
                  <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-sky-400 rounded-bl-xs pointer-events-none" />
                  <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-sky-400 rounded-br-xs pointer-events-none" />
                  <div className="flex items-center gap-1.5">
                    <div className="w-3.5 h-3.5 rounded-full bg-slate-200 flex items-center justify-center text-[7px] text-slate-600 font-bold">反</div>
                    <div className="w-14 h-1.5 rounded-full bg-slate-200" />
                  </div>
                  <div className="space-y-1">
                    <div className="w-24 h-1.5 rounded-full bg-slate-200" />
                    <div className="w-18 h-1.5 rounded-full bg-slate-200" />
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 font-medium">含父母姓名與戶籍地址</p>
              </div>
            ) : (
              <div className="relative w-full aspect-[16/10] rounded-2xl border border-slate-200 bg-slate-900 overflow-hidden flex items-center justify-center">
                <img src={backImage || '/id-card-sample-back.jpg'} alt="反面" className="w-full h-full object-cover" />
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> 戶籍核驗完成
                </div>
              </div>
            )}

            {/* Back Controls */}
            {!backCaptured ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => startCamera('back')}
                  className="py-2.5 px-3 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs cursor-pointer transition-all"
                >
                  <Camera className="h-4 w-4" />
                  <span>鏡頭拍照</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSide('back');
                    fileInputRef.current?.click();
                  }}
                  className="py-2.5 px-3 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-200 cursor-pointer transition-all"
                >
                  <Upload className="h-4 w-4 text-slate-500" />
                  <span>檔案上傳</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleRetake('back')}
                className="w-full py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center gap-1 border border-slate-200 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>重新上傳反面</span>
              </button>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
        />

        {/* Footer Next Button */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-500 font-medium">
            {!isBothCompleted && '※ 需完成身分證正、反兩面上傳後方可進入下一步資料確認。'}
            {isBothCompleted && '✓ 身分證正反面皆已就緒，可進行資料確認。'}
          </p>

          <button
            id="desktop-id-upload-next-btn"
            type="button"
            disabled={!isBothCompleted || ocrStatus === 'scanning'}
            onClick={onNext}
            className="py-3.5 px-8 rounded-2xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-bold text-sm shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40"
          >
            <span>下一步：資料確認</span>
            <ArrowRight className="h-4 w-4 stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* CAMERA POPUP / MODAL FOR DESKTOP WITH 4-CORNER GREEN DETECTION */}
      <AnimatePresence>
        {isCameraOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4 backdrop-blur-md"
          >
            <div className="relative w-full max-w-2xl bg-slate-950 rounded-3xl overflow-hidden border border-white/20 shadow-2xl flex flex-col">
              {/* Header */}
              <div className="p-4 flex items-center justify-between text-white bg-slate-900/80 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <span className="text-base font-bold">
                    {cameraSide === 'front' ? '拍攝身分證【正面】' : '拍攝身分證【反面】'}
                  </span>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    isCardAligned ? 'bg-emerald-500 text-white animate-pulse' : 'bg-sky-500/30 text-sky-200'
                  }`}>
                    {isCardAligned ? '✓ 已對齊四角標記' : '請將證件置於四角內'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Viewfinder with 4 Corners */}
              <div ref={videoContainerRef} className="relative aspect-[16/10] w-full flex items-center justify-center overflow-hidden bg-slate-900">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  // 2026-08-24：桌面版沒有指定 facingMode，用的是筆電
                  // 內建的前鏡頭，鏡像維持不變（符合直覺）。手機版
                  // （IdUploadScreen.tsx）用 facingMode:'environment'
                  // 後鏡頭拍證件才需要拿掉鏡像，兩邊鏡頭方向不一樣，
                  // 不能套用同一個修法——這裡改錯過一次，已經修回來。
                  className="absolute inset-0 w-full h-full object-cover -scale-x-100"
                />

                <div ref={guideBoxRef} className="relative w-[58%] max-w-[360px] aspect-[1.58/1] flex items-center justify-center pointer-events-none">
                  {/* Top-Left Corner */}
                  <div
                    className={`absolute top-0 left-0 w-6 h-6 rounded-tl-md border-t-[3.5px] border-l-[3.5px] transition-all duration-300 ${
                      isCardAligned
                        ? 'border-emerald-400 shadow-[0_0_15px_#10b981]'
                        : 'border-white shadow-[0_0_8px_rgba(255,255,255,0.6)]'
                    }`}
                  />
                  {/* Top-Right Corner */}
                  <div
                    className={`absolute top-0 right-0 w-6 h-6 rounded-tr-md border-t-[3.5px] border-r-[3.5px] transition-all duration-300 ${
                      isCardAligned
                        ? 'border-emerald-400 shadow-[0_0_15px_#10b981]'
                        : 'border-white shadow-[0_0_8px_rgba(255,255,255,0.6)]'
                    }`}
                  />
                  {/* Bottom-Left Corner */}
                  <div
                    className={`absolute bottom-0 left-0 w-6 h-6 rounded-bl-md border-b-[3.5px] border-l-[3.5px] transition-all duration-300 ${
                      isCardAligned
                        ? 'border-emerald-400 shadow-[0_0_15px_#10b981]'
                        : 'border-white shadow-[0_0_8px_rgba(255,255,255,0.6)]'
                    }`}
                  />
                  {/* Bottom-Right Corner */}
                  <div
                    className={`absolute bottom-0 right-0 w-6 h-6 rounded-br-md border-b-[3.5px] border-r-[3.5px] transition-all duration-300 ${
                      isCardAligned
                        ? 'border-emerald-400 shadow-[0_0_15px_#10b981]'
                        : 'border-white shadow-[0_0_8px_rgba(255,255,255,0.6)]'
                    }`}
                  />

                  {/* Center Badge */}
                  <div className={`px-4 py-2 rounded-full text-xs font-black flex items-center gap-2 shadow-lg backdrop-blur-md transition-all ${
                    isCardAligned
                      ? 'bg-emerald-500/90 text-white border border-emerald-300/60 ring-2 ring-emerald-400/40'
                      : 'bg-slate-950/75 text-sky-200 border border-white/20'
                  }`}>
                    {isCardAligned ? (
                      <>
                        <Check className="h-4 w-4 stroke-[3]" />
                        <span>已就定位，四角對齊完成</span>
                      </>
                    ) : (
                      <>
                        <ScanLine className="h-4 w-4 animate-pulse text-sky-400" />
                        <span>請將證件四角對準框線</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Snap Footer */}
              <div className="p-6 bg-slate-900 flex flex-col items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handleSnapPhoto}
                  className={`h-16 w-16 rounded-full border-4 transition-all flex items-center justify-center shadow-lg active:scale-95 cursor-pointer ${
                    isCardAligned
                      ? 'border-white bg-emerald-500 shadow-emerald-500/50 hover:bg-emerald-400 scale-105'
                      : 'border-white bg-sky-500 shadow-sky-500/50 hover:bg-sky-400'
                  }`}
                >
                  <Camera className="h-7 w-7 text-white" />
                </button>
                <span className="text-xs text-slate-300 font-medium">
                  {isCardAligned ? '點擊拍照完成擷取' : '保持證件水平穩定'}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
