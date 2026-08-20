import React from 'react';
import { FormData } from '../../types';
import { FaceVerificationEngine } from '../face/FaceVerificationEngine';
import { ShieldCheck, Info } from 'lucide-react';

interface FaceVerifyScreenProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

export const FaceVerifyScreen: React.FC<FaceVerifyScreenProps> = ({
  formData,
  updateFormData,
  onNext,
}) => {
  const handleVerificationComplete = (confidence: number, photometricPassed = true) => {
    updateFormData({
      faceVerified: true,
      faceConfidence: confidence,
      photometricPassed: photometricPassed,
      photometricScore: 99.6,
    });
  };

  return (
    <div className="flex flex-col flex-1 px-4 pt-2 pb-8 bg-white select-none">
      {/* Compact Title & Status Pill */}
      <div className="text-center mb-3">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600 bg-sky-50 px-2.5 py-0.5 rounded-full border border-sky-100 mb-1">
          <ShieldCheck className="h-3.5 w-3.5 text-sky-500" />
          <span>Step 4 / 6 • 動態人臉防偽</span>
        </span>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          人臉驗證
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          請注視鏡頭，依據畫面提示完成動作
        </p>
      </div>

      {/* Primary Camera-first Viewport */}
      <div className="w-full flex-1 flex flex-col items-center justify-center">
        <FaceVerificationEngine
          onVerificationComplete={handleVerificationComplete}
          onProceedNext={onNext}
          isDesktop={false}
        />
      </div>

      {/* Subtle Security Tip at Bottom */}
      <div className="mt-4 p-3 rounded-2xl bg-slate-50 border border-slate-200/60 flex items-start gap-2.5 text-xs text-slate-500">
        <Info className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          影像經金管會資安規範加密處理，僅用於本次數位帳戶開戶之身分比對。
        </p>
      </div>
    </div>
  );
};
