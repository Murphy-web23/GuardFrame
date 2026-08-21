import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { OnboardingStep, FormData } from './types';
import { DeviceSimulator, ViewMode } from './components/DeviceSimulator';
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
  const [viewMode, setViewMode] = useState<ViewMode>('auto');

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
      <AnimatePresence mode="wait">
        <motion.div
          key={`mobile-${currentStep}`}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="flex-1 flex flex-col min-h-0"
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
    <div className="w-full min-h-screen bg-slate-900 flex flex-col font-sans">
      {/* Primary Simulator & Layout Switcher */}
      {appMode === 'user_onboarding' ? (
        <DeviceSimulator
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          currentStep={currentStep}
          formData={formData}
          appMode={appMode}
          onSwitchToAdmin={() => {
            window.location.hash = '#admin';
            setAppMode('admin');
          }}
        >
          {viewMode === 'mobile' ? (
            renderMobileContent()
          ) : viewMode === 'desktop' ? (
            renderDesktopContent()
          ) : (
            <>
              {/* Responsive Auto Layout: Mobile on small screens, Desktop on md+ */}
              <div className="block md:hidden w-full flex-1 flex flex-col">
                {renderMobileContent()}
              </div>
              <div className="hidden md:flex w-full flex-1 flex-col">
                {renderDesktopContent()}
              </div>
            </>
          )}
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
