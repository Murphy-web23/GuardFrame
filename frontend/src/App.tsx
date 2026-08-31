import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { OnboardingStep, FormData } from './types';
import { DeviceSimulator } from './components/DeviceSimulator';
import { MobileLayout } from './components/mobile/MobileLayout';
import { DesktopLayout } from './components/desktop/DesktopLayout';

// Mobile Screens (6-step flow)
import { WelcomeScreen } from './components/screens/WelcomeScreen';
import { SmsVerifyScreen } from './components/screens/SmsVerifyScreen';
import { IdUploadScreen } from './components/screens/IdUploadScreen';
import { BasicInfoScreen } from './components/screens/BasicInfoScreen';
import { FaceVerifyScreen } from './components/screens/FaceVerifyScreen';
import { FeatureSelectionScreen } from './components/screens/FeatureSelectionScreen';
import { TermsSubmitScreen } from './components/screens/TermsSubmitScreen';
import { CompletedScreen } from './components/screens/CompletedScreen';

// Desktop Screens (6-step flow)
import { DesktopWelcome } from './components/desktop/screens/DesktopWelcome';
import { DesktopSmsVerify } from './components/desktop/screens/DesktopSmsVerify';
import { DesktopIdUpload } from './components/desktop/screens/DesktopIdUpload';
import { DesktopBasicInfo } from './components/desktop/screens/DesktopBasicInfo';
import { DesktopFaceVerify } from './components/desktop/screens/DesktopFaceVerify';
import { DesktopFeatureSelection } from './components/desktop/screens/DesktopFeatureSelection';
import { DesktopTermsSubmit } from './components/desktop/screens/DesktopTermsSubmit';
import { DesktopCompleted } from './components/desktop/screens/DesktopCompleted';

// Phase 6 & Phase 7 Admin Risk Management & Authentication
import { AdminLayout } from './components/admin/AdminLayout';
import { AdminLogin } from './components/admin/AdminLogin';
import { getStoredAuth, setStoredAuth } from './data/mockAuth';

const initialFormData: FormData = {
  phone: '',
  smsCode: '',
  smsVerifiedAt: undefined,
  idFrontCaptured: false,
  idFrontImage: undefined,
  idBackCaptured: false,
  idBackImage: undefined,
  ocrCompleted: false,
  fullName: '',
  idNumber: '',
  birthday: '',
  email: '',
  address: '',
  faceVerified: false,
  faceConfidence: 99.8,
  photometricPassed: true,
  photometricScore: 99.6,
  cardStyle: 'style_a',
  applyOnlineBanking: true,
  notificationMethod: 'both',
  password: '',
  accountPin: '',
  enableBiometricLogin: true,
  enableEStatement: true,
  agreeTerms: false,
  agreePrivacy: false,
  agreeElectronic: false,
};

export default function App() {
  const [appMode, setAppMode] = useState<'user_onboarding' | 'admin'>('user_onboarding');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(() => getStoredAuth());
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [formData, setFormData] = useState<FormData>(initialFormData);

  // Listen to URL Hash changes for direct link navigation (#admin or #user)
  useEffect(() => {
    const handleUrlRoute = () => {
      const hash = window.location.hash.toLowerCase();
      const pathname = window.location.pathname.toLowerCase();
      if (hash === '#admin' || hash.startsWith('#/admin') || pathname.endsWith('/admin')) {
        setAppMode('admin');
      } else if (hash === '#user' || hash.startsWith('#/user') || hash === '') {
        setAppMode('user_onboarding');
      }
    };

    handleUrlRoute();
    window.addEventListener('hashchange', handleUrlRoute);
    return () => window.removeEventListener('hashchange', handleUrlRoute);
  }, []);

  // 2026-08-29：真人測試發現改用 h-dvh（CSS 100dvh 單位）後，Android
  // Chrome 上還是會出現「所有畫面都滑不動」的狀況（iOS Safari 完全
  // 沒這個問題）——dvh 這個單位在 Android Chrome 上的實作歷史上一直
  // 不太穩定，尤其跟這裡巢狀的 flex + overflow-y-auto 捲動容器組合
  // 在一起時。改成不依賴任何 vh/dvh CSS 單位，直接用 JS 量測
  // `window.innerHeight`（瀏覽器網址列收合、鍵盤彈出都會觸發
  // resize，這是所有行動瀏覽器都可靠支援、且行之有年的作法，dvh
  // 單位其實就是想取代這個 workaround，但取代得不夠穩），寫進一個
  // CSS 變數讓最外層容器使用。
  useEffect(() => {
    const setAppHeight = () => {
      document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    };
    setAppHeight();
    window.addEventListener('resize', setAppHeight);
    window.addEventListener('orientationchange', setAppHeight);
    return () => {
      window.removeEventListener('resize', setAppHeight);
      window.removeEventListener('orientationchange', setAppHeight);
    };
  }, []);

  const updateFormData = (data: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...data }));
  };

  const handleNextStep = () => {
    switch (currentStep) {
      case 'welcome':
        setCurrentStep('sms_verify');
        break;
      case 'sms_verify':
        if (!formData.smsVerifiedAt) {
          setFormData((prev) => ({ ...prev, smsVerifiedAt: Date.now() }));
        }
        setCurrentStep('id_upload');
        break;
      case 'id_upload':
        setCurrentStep('basic_info');
        break;
      case 'basic_info':
        setCurrentStep('face_verify');
        break;
      case 'face_verify':
        setCurrentStep('feature_select');
        break;
      case 'feature_select':
        setCurrentStep('terms_submit');
        break;
      case 'terms_submit':
        setCurrentStep('completed');
        break;
      case 'completed':
        setCurrentStep('welcome');
        break;
    }
  };

  const handleBackStep = () => {
    switch (currentStep) {
      case 'sms_verify':
        setCurrentStep('welcome');
        break;
      case 'id_upload':
        setCurrentStep('sms_verify');
        break;
      case 'basic_info':
        setCurrentStep('id_upload');
        break;
      case 'face_verify':
        setCurrentStep('basic_info');
        break;
      case 'feature_select':
        setCurrentStep('face_verify');
        break;
      case 'terms_submit':
        setCurrentStep('feature_select');
        break;
      case 'completed':
        setCurrentStep('welcome');
        break;
      default:
        break;
    }
  };

  const handleReset = () => {
    setFormData(initialFormData);
    setCurrentStep('welcome');
  };

  // Render Mobile Screen Content with full vertical scrollability
  const renderMobileContent = () => (
    <MobileLayout
      currentStep={currentStep}
      formData={formData}
      onBackStep={handleBackStep}
    >
      {/* 2026-08-30：這個 motion.div 是 MobileLayout.tsx 裡
          #mobile-scrollable-content（overflow-y-auto）的直接子元素。
          原本跟桌面版共用同一組 class（flex-1 min-h-0），但桌面版的
          DesktopLayout.tsx 根本沒有 overflow-y-auto 容器，讓整頁自然
          撐高、瀏覽器原生捲動，這組 class 對桌面版是無效的裝飾；手機版
          卻真的包在 overflow-y-auto 容器裡——flex-1 會把這個子元素撐滿
          「剛好等於父層可視高度」，min-h-0 又允許它壓縮到那個高度以下,
          兩者合起來讓內容永遠「量」不出比容器還高的實際高度,
          overflow-y-auto 自然沒有東西可以捲動（按鈕還是能點,因為畫面
          有東西、只是被壓縮成剛好塞進可視範圍,不是內容消失)。這是
          「按鈕正常、只有滑動完全沒反應」這個症狀的真正原因,不是
          之前一直在猜的 dvh 單位或 flex 子元素 min-height 預設值。
          手機版拿掉 flex-1/min-h-0,讓內容用自己的自然高度撐開,
          該有的捲動距離就會出現。桌面版（renderDesktopContent 那份,
          第 274 行附近)完全沒有動,那邊沒有這個 bug。 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`mobile-${currentStep}`}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="flex flex-col"
        >
          {currentStep === 'welcome' && (
            <WelcomeScreen onStart={() => setCurrentStep('sms_verify')} />
          )}

          {currentStep === 'sms_verify' && (
            <SmsVerifyScreen
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNextStep}
            />
          )}

          {currentStep === 'id_upload' && (
            <IdUploadScreen
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNextStep}
            />
          )}

          {currentStep === 'basic_info' && (
            <BasicInfoScreen
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNextStep}
            />
          )}

          {currentStep === 'face_verify' && (
            <FaceVerifyScreen
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNextStep}
            />
          )}

          {currentStep === 'feature_select' && (
            <FeatureSelectionScreen
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNextStep}
            />
          )}

          {currentStep === 'terms_submit' && (
            <TermsSubmitScreen
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNextStep}
            />
          )}

          {currentStep === 'completed' && (
            <CompletedScreen
              formData={formData}
              onReset={handleReset}
              onBackStep={handleBackStep}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </MobileLayout>
  );

  // Render Desktop Layout Content (Sidebar + Wide Multi-column Workspace)
  const renderDesktopContent = () => (
    <DesktopLayout
      currentStep={currentStep}
      formData={formData}
      onSelectStep={(st) => setCurrentStep(st)}
      onNextStep={handleNextStep}
      onBackStep={handleBackStep}
      onReset={handleReset}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={`desktop-${currentStep}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="flex-1 flex flex-col min-h-0"
        >
          {currentStep === 'welcome' && (
            <DesktopWelcome onStart={() => setCurrentStep('sms_verify')} />
          )}

          {currentStep === 'sms_verify' && (
            <DesktopSmsVerify
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNextStep}
            />
          )}

          {currentStep === 'id_upload' && (
            <DesktopIdUpload
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNextStep}
            />
          )}

          {currentStep === 'basic_info' && (
            <DesktopBasicInfo
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNextStep}
            />
          )}

          {currentStep === 'face_verify' && (
            <DesktopFaceVerify
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNextStep}
            />
          )}

          {currentStep === 'feature_select' && (
            <DesktopFeatureSelection
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNextStep}
            />
          )}

          {currentStep === 'terms_submit' && (
            <DesktopTermsSubmit
              formData={formData}
              updateFormData={updateFormData}
              onNext={handleNextStep}
            />
          )}

          {currentStep === 'completed' && (
            <DesktopCompleted
              formData={formData}
              onReset={handleReset}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </DesktopLayout>
  );

  return (
    // 2026-08-27：原本用 min-h-screen（CSS 100vh）——Android Chrome 網址列
    // 會動態展開/收合，100vh 是用網址列還沒收起來的高度算的，跟實際可視
    // 區域對不上，導致下面 MobileLayout.tsx 巢狀的 overflow-y-auto 滾動
    // 容器算出錯誤的可滾動高度，要等瀏覽器 resize 重新計算佈局才會修正
    // ——真人測試回報「Step 5 畫面卡了一下子才能滑動」正是這個症狀。
    // 換成 min-h-dvh（CSS 100dvh，動態視窗高度）直接反映實際可視區域，
    // 不受網址列收合影響。
    //
    // 2026-08-29：真人 Android 測試回報 Step5（設定開戶服務功能）畫面
    // 卡住完全滑不動——先改成固定 h-dvh（不是 min-h-dvh）解決「最外層
    // 自己也變成可捲動、跟裡面 MobileLayout.tsx 的捲動容器互搶觸控
    // 手勢」這個問題，但真人測試發現 Android Chrome 上**所有**畫面
    // 都滑不動（iOS Safari 完全沒事），範圍比單一畫面大，懷疑 dvh
    // 這個 CSS 單位本身在這台裝置的 Chrome 上就不穩。改成上面
    // useEffect 量出來的 --app-height（JS 讀 window.innerHeight 寫入
    // CSS 變數），不依賴瀏覽器對 dvh 單位的實作，見該處說明。
    <div
      className="w-full bg-slate-900 flex flex-col font-sans"
      style={{ height: 'var(--app-height, 100vh)' }}
    >
      {/* Primary Simulator & Layout Switcher */}
      {appMode === 'user_onboarding' ? (
        <DeviceSimulator>
          {/* 真正的響應式分流：CSS breakpoint 決定顯示哪一組畫面，
              不是 JS 手動切換。後台入口只能透過網址 #admin 進入，
              見上面的 hashchange 監聽，使用者畫面裡不會出現任何
              後台相關的按鈕或提示。 */}
          {/* 2026-08-30：真人測試用瀏覽器實際量測過（不是用猜的）——
              DeviceSimulator 的外層 div 不是 display:flex，這層的
              flex-1 完全沒有作用，實際高度只會被內容撐開（真人測試
              量到 2647px，遠超過 --app-height 該有的 812px），下面所有
              捲動容器因此永遠量不出「內容比容器高」，滑動完全沒反應
              （點擊仍正常，因為畫面上看得到的東西還在，只是整層都超出
              可視範圍、捲動這件事沒被觸發）。改用 h-full（跟 flex 無關,
              只要父層有真的 height 就會生效,DeviceSimulator 那層的
              inline style height 符合這個條件）+ overflow-hidden 真正
              把高度鎖回 --app-height。只改這個手機專屬的包裝層,不動
              DeviceSimulator 本身（會同時影響下面桌面版那個 sibling
              div,桌面版從來沒這個問題,不能為了修手機動到共用的祖先
              元素)，桌面版下面那行完全沒改。 */}
          <div className="block md:hidden w-full h-full overflow-hidden flex flex-col">
            {renderMobileContent()}
          </div>
          <div className="hidden md:flex w-full flex-1 flex-col">
            {renderDesktopContent()}
          </div>
        </DeviceSimulator>
      ) : (
        /* Admin Mode */
        isAdminAuthenticated ? (
          <AdminLayout
            onLogout={() => {
              setStoredAuth(false);
              setIsAdminAuthenticated(false);
            }}
            onSwitchToUserPortal={() => {
              window.location.hash = '#user';
              setAppMode('user_onboarding');
            }}
          />
        ) : (
          <AdminLogin
            onLoginSuccess={() => {
              setStoredAuth(true);
              setIsAdminAuthenticated(true);
            }}
            onSwitchToUserPortal={() => {
              window.location.hash = '#user';
              setAppMode('user_onboarding');
            }}
            onBackToUser={() => {
              window.location.hash = '#user';
              setAppMode('user_onboarding');
            }}
          />
        )
      )}
    </div>
  );
}
