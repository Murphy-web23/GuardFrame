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
      {/* 2026-08-30：真人測試用瀏覽器實際量測＋動態模擬驗證過，不是靠猜
          的（之前 08-30 稍早加的 min-h-0 那次修法沒有解決問題，理由
          見下面）。這裡原本還有 `flex flex-col`——這個才是真正的問題：
          這個容器一旦是 display:flex，它的子元素（也就是每個步驟畫面
          最外層那個 motion.div）預設 flex-shrink:1，容器高度被限制在
          可視高度後，子元素會被壓縮「塞進」可視範圍，而不是保留原本
          的內容高度讓外層 overflow-y-auto 偵測到溢出——實測過：塞一段
          2000px 高的測試內容進來，含 flex flex-col 時量到的高度只有
          164px（被壓扁了），拿掉之後量到完整的 2000px，scrollHeight
          才會真的大於 clientHeight，捲動才會出現。這個容器本來就只有
          一個子元素（children），不需要 flex 排版，拿掉不影響任何
          排版效果。
          另外還要搭配 App.tsx 那層手機專屬包裝 div 的修法（原本的
          flex-1 因為父層不是 flex container 完全沒作用，高度沒被真的
          鎖住)，兩個地方要一起修才會生效,單獨改這裡不夠。 */}
      <div
        id="mobile-scrollable-content"
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-white"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {children}
      </div>
    </div>
  );
};
