import React, { useState, useRef, useEffect } from 'react';
import { FormData } from '../../types';
import { defaultMockOcrData } from '../../data/mockOcrData';
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
  Sparkles,
  CreditCard,
  ScanLine
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { rectifyIdCard } from '../../api/client';

interface IdUploadScreenProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

type IdCardSide = 'front' | 'back';

export const IdUploadScreen: React.FC<IdUploadScreenProps> = ({
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
  // 2026-08-20 新增：真的呼叫 /id-card/rectify 時的狀態，跟上面
  // ocrStatus（姓名/字號辨識，後端沒有真的 OCR，維持 mock）分開——
  // rectifyStatus 是「有沒有偵測到證件四個角」，ocrStatus 是「有沒有
  // 辨識出文字」，兩件事後端目前是分開的能力。
  const [rectifyStatus, setRectifyStatus] = useState<'idle' | 'capturing' | 'failed'>('idle');
  const [rectifyError, setRectifyError] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 2026-08-25：原本這個 ref 指向掛在 DOM 上、用 CSS `hidden`
  // （display:none）藏起來的 <canvas>。真人測試發現：畫面預覽明明看
  // 得到證件、對齊指示燈也亮了，拍照送出去的卻是純黑畫面（存到
  // data/_debug_id_card_failures/ 的診斷圖是純黑、而且兩次檔案大小
  // 一模一樣——不是真的拍到暗場景，是根本沒畫到東西）。已知的 WebKit
  // 怪癖：`display:none` 的 <canvas> 在部分 iOS Safari 版本上，畫進去
  // 的內容有可能沒有真的被畫出來。下面的 scanCanvasRef（即時邊緣密度
  // 偵測用，已經證實在真機上正常運作）完全不掛在 DOM 上（純
  // document.createElement，不 append），改成同一種寫法：這個 ref 現在
  // 是懶建立的離屏 canvas，不再對應任何 JSX 元素。
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // 2026-08-25：定期取樣畫面中央區域算邊緣密度用的暫存 canvas，跟上面
  // 拍照用的 canvasRef 分開，避免互相干擾。
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // 2026-08-25：見下面掃描 useEffect 的說明——即時對齊偵測要抓「畫面上
  // 真正顯示的四角引導框」所在的實際區域，不能用寫死的畫面中央固定
  // 比例，這兩個 ref 用來量測引導框跟它的容器在螢幕上的實際位置。
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const guideBoxRef = useRef<HTMLDivElement | null>(null);

  // 2026-08-25：原本這裡是假的——不管畫面裡有沒有東西，固定等 1.2 秒就
  // 顯示「已對齊」，跟後端真的偵測結果常常對不起來（畫面顯示偵測到，
  // 拍下去卻可能顯示未偵測到）。改成真的定期（每 350ms）取樣畫面中央
  // 區域，算邊緣密度：把區域縮小成 64×40 灰階小圖，算相鄰像素差異的
  // 平均值當作「這裡有沒有明顯邊界」的粗略指標——證件邊緣、文字、圖案
  // 會產生高對比邊緣，均勻的桌面/背景邊緣密度低。這不是跟後端一樣的
  // Canny＋四邊形偵測，只是前端給使用者即時回饋用的粗略估計，真正的
  // 判斷還是以拍照後送到後端的結果為準。
  //
  // 2026-08-25 修正：一開始這裡取樣區域是寫死「畫面中央 70% 寬、45%
  // 高」，假設這個比例跟畫面上顯示的四角引導框差不多大——但引導框的
  // CSS 是 `w-[72%] max-w-[280px] aspect-[1.58/1]`，桌面版視窗較寬時
  // `max-w-[280px]` 這個上限會讓引導框實際比 70% 小很多（例如
  // 1280px 寬的視訊畫面，280px 大概只佔 22%，不是 70%）。取樣區域比
  // 引導框大這麼多，使用者把證件對準畫面上看到的框，取樣到的其實
  // 大半是框外的背景，邊緣密度自然被稀釋、永遠亮不起「已對齊」的
  // 綠燈——這就是真人測試回報「明明對準框線，拍照時卻偵測不到」的
  // 根因。改成直接量測引導框（guideBoxRef）跟它的容器
  // （videoContainerRef）在畫面上的實際像素位置，換算成 object-cover
  // 縮放前、影片原始像素座標系裡的裁切區域，取樣範圍才會跟畫面上
  // 使用者實際看到的框真正一致。
  useEffect(() => {
    if (!isCameraOpen) {
      setIsCardAligned(false);
      return;
    }
    setIsCardAligned(false);

    const SAMPLE_W = 64;
    const SAMPLE_H = 40;
    const EDGE_DENSITY_THRESHOLD = 18; // 灰階值 0-255 尺度下的平均邊緣強度

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

      // video 用 object-cover 撐滿 container：先算出縮放比例（取較大的
      // 那一邊，讓短邊也能填滿），再算出因為裁切而在畫面外的偏移量。
      const containerRect = container.getBoundingClientRect();
      const guideRect = guideBox.getBoundingClientRect();
      const scale = Math.max(containerRect.width / vw, containerRect.height / vh);
      const displayedW = vw * scale;
      const displayedH = vh * scale;
      const offsetX = (displayedW - containerRect.width) / 2;
      const offsetY = (displayedH - containerRect.height) / 2;

      // 引導框相對 container 左上角的畫面座標，換算回影片原始像素座標。
      const cropX = (guideRect.left - containerRect.left + offsetX) / scale;
      const cropY = (guideRect.top - containerRect.top + offsetY) / scale;
      const cropW = guideRect.width / scale;
      const cropH = guideRect.height / scale;
      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, SAMPLE_W, SAMPLE_H);

      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
      } catch (_) {
        return; // 部分瀏覽器在畫面還沒 ready 時讀取會丟例外，忽略即可
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

  // Start Camera
  const startCamera = async (side: IdCardSide) => {
    setCameraSide(side);
    setIsCameraOpen(true);
    setIsCardAligned(false);
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          // 2026-08-24：原本要求橫的 1280×720，但鏡頭框在手機上是直的
          // 窄長容器，object-cover 會裁掉左右一大塊「畫面上看不到、但
          // 後端還是收得到」的範圍，導致畫面上看起來對準了，證件在
          // 後端拿到的原始畫面裡佔比卻很小——跟人臉驗證那邊修過的
          // 同一類問題（見 FaceVerificationEngine.tsx 的說明）。改成
          // 接近容器直式比例的解析度。
          video: {
            facingMode: 'environment',
            width: { ideal: 720 },
            height: { ideal: 1280 },
            aspectRatio: { ideal: 0.6 },
          },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }
    } catch (err) {
      console.warn('Camera not directly accessible, fallback stream', err);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  // 把目前的相機畫面截成一張 Blob，共用給拍照跟上傳兩條路徑用
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
    // 2026-08-24：預覽畫面已經不鏡像了（見上面 <video> 的說明），這裡
    // 直接照畫面截圖即可，跟送去矯正的原始方向一致。
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92));
  };

  // 真的呼叫 POST /api/id-card/rectify（§4.7）。失敗時（沒偵測到四個角）
  // 停在原地讓使用者重拍，不前進、不填假資料。
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

  // Perform Snap
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

  // File Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await runRectify(activeSide, file);
    }
  };

  // OCR Recognition Simulation
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
        // If back not captured yet, prompt switch to back
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
    <div className="relative flex flex-col flex-1 px-5 pt-3 pb-8 bg-white select-none">
      {/* Step Header */}
      <div className="mb-3">
        <span className="text-[11px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-100">
          Step 2 / 6
        </span>
        <h1 className="text-xl font-black text-slate-900 tracking-tight mt-1.5">
          身分證驗證
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          請將身分證放入框線內，系統將自動偵測對齊並辨識資料。
        </p>
      </div>

      {/* Front & Back Tabs Switcher */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl mb-4 border border-slate-200/70">
        <button
          type="button"
          onClick={() => setActiveSide('front')}
          className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeSide === 'front'
              ? 'bg-white text-sky-600 shadow-xs'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <span>身分證正面</span>
          {frontCaptured ? (
            <span className="h-4 w-4 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px]">
              ✓
            </span>
          ) : (
            <span className="text-[10px] text-rose-500 font-semibold">• 必填</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSide('back')}
          className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeSide === 'back'
              ? 'bg-white text-sky-600 shadow-xs'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <span>身分證反面</span>
          {backCaptured ? (
            <span className="h-4 w-4 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px]">
              ✓
            </span>
          ) : (
            <span className="text-[10px] text-rose-500 font-semibold">• 必填</span>
          )}
        </button>
      </div>

      {rectifyStatus === 'capturing' && (
        <div className="mb-3 p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs font-semibold text-sky-700 flex items-center gap-2">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          <span>正在偵測證件…</span>
        </div>
      )}
      {rectifyStatus === 'failed' && (
        <div className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{rectifyError}</span>
        </div>
      )}

      {/* Active Card Side View */}
      <div className="flex flex-col flex-1 justify-between space-y-4">
        {/* FRONT SIDE PANEL */}
        {activeSide === 'front' && (
          <div className="space-y-3">
            {!frontCaptured ? (
              <div className="space-y-4">
                {/* 4-Corner Target Box Area */}
                <div className="relative w-full aspect-[16/10] rounded-2xl border border-dashed border-sky-300 bg-sky-50/40 flex flex-col items-center justify-center p-4 text-center overflow-hidden">
                  {/* Visual card silhouette with 4-corner brackets */}
                  <div className="relative w-44 h-28 rounded-xl bg-white/95 shadow-xs flex flex-col justify-between p-2.5 border border-slate-200/70">
                    {/* 4 Corner Markers */}
                    <div className="absolute top-0 left-0 w-3.5 h-3.5 border-t-2 border-l-2 border-sky-400 rounded-tl-xs pointer-events-none" />
                    <div className="absolute top-0 right-0 w-3.5 h-3.5 border-t-2 border-r-2 border-sky-400 rounded-tr-xs pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-3.5 h-3.5 border-b-2 border-l-2 border-sky-400 rounded-bl-xs pointer-events-none" />
                    <div className="absolute bottom-0 right-0 w-3.5 h-3.5 border-b-2 border-r-2 border-sky-400 rounded-br-xs pointer-events-none" />

                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-4 rounded-full bg-sky-100 flex items-center justify-center text-[8px] text-sky-600 font-bold">正</div>
                      <div className="w-16 h-1.5 rounded-full bg-slate-200" />
                    </div>
                    <div className="flex justify-between items-end">
                      <div className="space-y-1">
                        <div className="w-20 h-1.5 rounded-full bg-slate-200" />
                        <div className="w-14 h-1.5 rounded-full bg-slate-200" />
                      </div>
                      <div className="w-8 h-10 rounded-xs bg-sky-100 flex items-center justify-center text-[8px] text-sky-400 font-medium">大頭照</div>
                    </div>
                  </div>

                  <p className="text-xs font-bold text-slate-700 mt-2.5">
                    請將【身分證正面】置於四角標記內
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    系統將自動進行姓名與身分證字號資料辨識
                  </p>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    id="open-front-camera-btn"
                    type="button"
                    onClick={() => startCamera('front')}
                    className="py-3 px-4 rounded-2xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    <Camera className="h-4 w-4" />
                    <span>拍攝正面</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="py-3 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer border border-slate-200/80"
                  >
                    <Upload className="h-4 w-4 text-slate-500" />
                    <span>上傳正面圖檔</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Captured Front Preview */}
                <div className="relative w-full aspect-[16/10] rounded-2xl border border-slate-200 bg-slate-900 overflow-hidden flex items-center justify-center">
                  <img
                    src={frontImage || '/id-card-sample.jpg'}
                    alt="身分證正面預覽"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full bg-emerald-500/90 text-white text-[11px] font-bold flex items-center gap-1 shadow-md backdrop-blur-xs">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>正面辨識完成</span>
                  </div>
                </div>

                <div className="flex items-center justify-between px-1">
                  <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                    ✓ 正面姓名/字號已自動辨識
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRetake('front')}
                    className="text-xs text-slate-500 hover:text-slate-700 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>重新拍攝正面</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* BACK SIDE PANEL */}
        {activeSide === 'back' && (
          <div className="space-y-3">
            {!backCaptured ? (
              <div className="space-y-4">
                {/* 4-Corner Target Box Area */}
                <div className="relative w-full aspect-[16/10] rounded-2xl border border-dashed border-sky-300 bg-sky-50/40 flex flex-col items-center justify-center p-4 text-center overflow-hidden">
                  <div className="relative w-44 h-28 rounded-xl bg-white/95 shadow-xs flex flex-col justify-between p-2.5 border border-slate-200/70">
                    {/* 4 Corner Markers */}
                    <div className="absolute top-0 left-0 w-3.5 h-3.5 border-t-2 border-l-2 border-sky-400 rounded-tl-xs pointer-events-none" />
                    <div className="absolute top-0 right-0 w-3.5 h-3.5 border-t-2 border-r-2 border-sky-400 rounded-tr-xs pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-3.5 h-3.5 border-b-2 border-l-2 border-sky-400 rounded-bl-xs pointer-events-none" />
                    <div className="absolute bottom-0 right-0 w-3.5 h-3.5 border-b-2 border-r-2 border-sky-400 rounded-br-xs pointer-events-none" />

                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center text-[8px] text-slate-600 font-bold">反</div>
                      <div className="w-16 h-1.5 rounded-full bg-slate-200" />
                    </div>
                    <div className="space-y-1">
                      <div className="w-28 h-1.5 rounded-full bg-slate-200" />
                      <div className="w-20 h-1.5 rounded-full bg-slate-200" />
                      <div className="w-14 h-1.5 rounded-full bg-slate-200" />
                    </div>
                  </div>

                  <p className="text-xs font-bold text-slate-700 mt-2.5">
                    請將【身分證反面】置於四角標記內
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    系統將核驗父母姓名、配偶及戶籍地址資料
                  </p>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    id="open-back-camera-btn"
                    type="button"
                    onClick={() => startCamera('back')}
                    className="py-3 px-4 rounded-2xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    <Camera className="h-4 w-4" />
                    <span>拍攝反面</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="py-3 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer border border-slate-200/80"
                  >
                    <Upload className="h-4 w-4 text-slate-500" />
                    <span>上傳反面圖檔</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Captured Back Preview */}
                <div className="relative w-full aspect-[16/10] rounded-2xl border border-slate-200 bg-slate-900 overflow-hidden flex items-center justify-center">
                  <img
                    src={backImage || '/id-card-sample-back.jpg'}
                    alt="身分證反面預覽"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full bg-emerald-500/90 text-white text-[11px] font-bold flex items-center gap-1 shadow-md backdrop-blur-xs">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>反面辨識完成</span>
                  </div>
                </div>

                <div className="flex items-center justify-between px-1">
                  <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                    ✓ 反面戶籍資訊已核驗
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRetake('back')}
                    className="text-xs text-slate-500 hover:text-slate-700 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>重新拍攝反面</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
        />
        {/* Primary CTA: 下一步 (Enabled only when BOTH front & back are captured) */}
        <div className="pt-2">
          {!isBothCompleted && (
            <p className="text-[11px] text-amber-600 font-semibold text-center mb-2">
              {!frontCaptured && !backCaptured && '請完成身分證正面與反面拍攝'}
              {frontCaptured && !backCaptured && '身分證正面已完成，請切換至「反面」拍攝'}
              {!frontCaptured && backCaptured && '身分證反面已完成，請切換至「正面」拍攝'}
            </p>
          )}

          <button
            id="id-upload-next-btn"
            type="button"
            disabled={!isBothCompleted || ocrStatus === 'scanning'}
            onClick={onNext}
            className="w-full py-3.5 px-6 rounded-2xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-bold text-sm shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40"
          >
            <span>{isBothCompleted ? '確認並進入下一步' : '請先完成正反兩面拍攝'}</span>
            <ArrowRight className="h-4 w-4 stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* CAMERA POPUP / MODAL WITH 4 CORNERS THAT TURN GREEN WHEN ALIGNED */}
      <AnimatePresence>
        {isCameraOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black flex flex-col"
          >
            {/* Camera Header */}
            <div className="p-4 flex items-center justify-between text-white bg-slate-900/80 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">
                  {cameraSide === 'front' ? '拍攝身分證【正面】' : '拍攝身分證【反面】'}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  isCardAligned ? 'bg-emerald-500 text-white animate-pulse' : 'bg-sky-500/30 text-sky-200'
                }`}>
                  {isCardAligned ? '✓ 已對齊四角' : '對準四角標記'}
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

            {/* Video Feed & 4-Corner Target Alignment Box */}
            <div ref={videoContainerRef} className="relative flex-1 flex items-center justify-center overflow-hidden bg-slate-950">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                // 2026-08-24：這裡用的是 facingMode: 'environment'（後鏡頭）
                // 拍證件，不是自拍，不該鏡像——鏡像只會讓證件上的文字看
                // 起來是反的。鏡像效果只適合前鏡頭自拍情境（見人臉驗證
                // 那邊 FaceVerificationEngine.tsx 才需要 -scale-x-100）。
                className="absolute inset-0 w-full h-full object-cover"
              />

              {/* Dimmed backdrop mask outside the ID frame */}
              <div className="absolute inset-0 bg-slate-950/40 pointer-events-none" />

              {/* 4-CORNER TARGET ALIGNMENT FRAME */}
              <div ref={guideBoxRef} className="relative w-[72%] max-w-[280px] aspect-[1.58/1] flex items-center justify-center pointer-events-none">
                {/* Visual cutout clear box */}
                <div className={`absolute inset-0 rounded-xl transition-all duration-500 ${
                  isCardAligned
                    ? 'bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.5),0_0_24px_rgba(16,185,129,0.5)]'
                    : 'bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]'
                }`} />

                {/* 4 CORNER BRACKETS - TURNS GREEN WHEN isCardAligned IS TRUE */}
                {/* Top-Left Corner */}
                <div
                  className={`absolute top-0 left-0 w-5 h-5 rounded-tl-md border-t-[3px] border-l-[3px] transition-all duration-300 ${
                    isCardAligned
                      ? 'border-emerald-400 shadow-[0_0_12px_#10b981]'
                      : 'border-white shadow-[0_0_6px_rgba(255,255,255,0.6)]'
                  }`}
                />
                {/* Top-Right Corner */}
                <div
                  className={`absolute top-0 right-0 w-5 h-5 rounded-tr-md border-t-[3px] border-r-[3px] transition-all duration-300 ${
                    isCardAligned
                      ? 'border-emerald-400 shadow-[0_0_12px_#10b981]'
                      : 'border-white shadow-[0_0_6px_rgba(255,255,255,0.6)]'
                  }`}
                />
                {/* Bottom-Left Corner */}
                <div
                  className={`absolute bottom-0 left-0 w-5 h-5 rounded-bl-md border-b-[3px] border-l-[3px] transition-all duration-300 ${
                    isCardAligned
                      ? 'border-emerald-400 shadow-[0_0_12px_#10b981]'
                      : 'border-white shadow-[0_0_6px_rgba(255,255,255,0.6)]'
                  }`}
                />
                {/* Bottom-Right Corner */}
                <div
                  className={`absolute bottom-0 right-0 w-5 h-5 rounded-br-md border-b-[3px] border-r-[3px] transition-all duration-300 ${
                    isCardAligned
                      ? 'border-emerald-400 shadow-[0_0_12px_#10b981]'
                      : 'border-white shadow-[0_0_6px_rgba(255,255,255,0.6)]'
                  }`}
                />

                {/* Center Badge Status Indicator */}
                <motion.div
                  key={isCardAligned ? 'aligned' : 'aligning'}
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className={`px-4 py-1.5 rounded-full text-xs font-black flex items-center gap-1.5 shadow-lg backdrop-blur-md transition-all ${
                    isCardAligned
                      ? 'bg-emerald-500/90 text-white border border-emerald-300/60 ring-2 ring-emerald-400/40'
                      : 'bg-slate-950/70 text-sky-200 border border-white/20'
                  }`}
                >
                  {isCardAligned ? (
                    <>
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                      <span>已就定位，四角對齊成功</span>
                    </>
                  ) : (
                    <>
                      <ScanLine className="h-3.5 w-3.5 animate-pulse text-sky-400" />
                      <span>請將身分證四角對齊四邊標記</span>
                    </>
                  )}
                </motion.div>
              </div>
            </div>

            {/* Snap Button Footer */}
            <div className="p-6 bg-slate-900/90 backdrop-blur-md flex flex-col items-center justify-center gap-2">
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
              <span className="text-[11px] text-slate-300 font-medium">
                {isCardAligned ? '點擊拍照完成擷取' : '保持手部穩定'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
