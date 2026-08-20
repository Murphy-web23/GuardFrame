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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-detect / align simulation timer when camera is active
  useEffect(() => {
    let timer: any;
    if (isCameraOpen) {
      setIsCardAligned(false);
      // Simulate detection: after 1.2 seconds, the 4 corners align & turn green!
      timer = setTimeout(() => {
        setIsCardAligned(true);
      }, 1200);
    } else {
      setIsCardAligned(false);
    }
    return () => clearTimeout(timer);
  }, [isCameraOpen, cameraSide]);

  // Start Camera
  const startCamera = async (side: IdCardSide) => {
    setCameraSide(side);
    setIsCameraOpen(true);
    setIsCardAligned(false);
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
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

  // Perform Snap
  const handleSnapPhoto = () => {
    stopCamera();
    if (cameraSide === 'front') {
      setFrontCaptured(true);
      const url = '/id-card-sample.jpg';
      setFrontImage(url);
      triggerOcrRecognition('front', url);
    } else {
      setBackCaptured(true);
      const url = '/id-card-sample-back.jpg';
      setBackImage(url);
      triggerOcrRecognition('back', url);
    }
  };

  // File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      if (activeSide === 'front') {
        setFrontCaptured(true);
        setFrontImage(url);
        triggerOcrRecognition('front', url);
      } else {
        setBackCaptured(true);
        setBackImage(url);
        triggerOcrRecognition('back', url);
      }
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
                    系統將自動進行姓名與身分證字號 OCR 辨識
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
            <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-slate-950">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover -scale-x-100"
              />

              {/* Dimmed backdrop mask outside the ID frame */}
              <div className="absolute inset-0 bg-slate-950/40 pointer-events-none" />

              {/* 4-CORNER TARGET ALIGNMENT FRAME */}
              <div className="relative w-[72%] max-w-[280px] aspect-[1.58/1] flex items-center justify-center pointer-events-none">
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
