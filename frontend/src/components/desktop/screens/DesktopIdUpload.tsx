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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let timer: any;
    if (isCameraOpen) {
      setIsCardAligned(false);
      // Simulate detection: after 1.2 seconds, 4 corners turn green!
      timer = setTimeout(() => {
        setIsCardAligned(true);
      }, 1200);
    } else {
      setIsCardAligned(false);
    }
    return () => clearTimeout(timer);
  }, [isCameraOpen, cameraSide]);

  const startCamera = async (side: IdCardSide) => {
    setCameraSide(side);
    setIsCameraOpen(true);
    setIsCardAligned(false);
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
                  <CheckCircle2 className="h-3 w-3" /> OCR 已辨識
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
              <div className="relative aspect-[16/10] w-full flex items-center justify-center overflow-hidden bg-slate-900">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover -scale-x-100"
                />

                <div className="relative w-[58%] max-w-[360px] aspect-[1.58/1] flex items-center justify-center pointer-events-none">
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
