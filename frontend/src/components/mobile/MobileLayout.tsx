import React from 'react';
import { OnboardingStep, FormData } from '../../types';
import { FlowHeader } from '../FlowHeader';

interface MobileLayoutProps {
  currentStep: OnboardingStep;
  formData: FormData;
  onBackStep: () => void;
  children: React.ReactNode;
}

export const MobileLayout: React.FC<MobileLayoutProps> = ({
  currentStep,
  formData,
  onBackStep,
  children,
}) => {
  return (
    <div className="w-full flex-1 flex flex-col bg-white overflow-hidden min-h-0">
      {/* Sticky Flow Header for Step Tracking on Mobile */}
      <FlowHeader
        currentStep={currentStep}
        formData={formData}
        onBack={onBackStep}
      />

      {/* Main Vertically Scrollable Screen Content Container */}
      <div 
        id="mobile-scrollable-content"
        className="flex-1 overflow-y-auto overscroll-contain flex flex-col bg-white"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {children}
      </div>
    </div>
  );
};
