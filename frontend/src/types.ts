export type OnboardingStep = 
  | 'welcome'
  | 'sms_verify'
  | 'id_upload'
  | 'basic_info'
  | 'face_verify'
  | 'feature_select'
  | 'terms_submit'
  | 'completed';

export type GuardianMood = 
  | 'idle' 
  | 'welcoming' 
  | 'thinking' 
  | 'scanning' 
  | 'success' 
  | 'guiding' 
  | 'warning';

export type VerificationResultState = 
  | 'processing'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'system_error';

export interface FormData {
  // Step 1: SMS Verify & Phone
  phone: string;
  smsCode: string;
  smsVerifiedAt?: number;
  
  // Step 2: ID Upload & OCR (Front & Back)
  idFrontCaptured: boolean;
  idFrontImage?: string;
  idBackCaptured: boolean;
  idBackImage?: string;
  ocrCompleted?: boolean;
  
  // Step 3: Basic Info (Confirmed / Edited from OCR)
  fullName: string;
  idNumber: string;
  birthday: string;
  email?: string;
  address: string;
  
  // Step 4: Face verify
  faceVerified: boolean;
  faceConfidence: number;
  photometricPassed?: boolean;
  photometricScore?: number;
  
  // Step 5: Feature Selection, Terms & Submission
  cardStyle: 'style_a' | 'style_b';
  applyOnlineBanking: boolean;
  notificationMethod: 'sms' | 'email' | 'both';
  agreeTerms: boolean;
  agreePrivacy: boolean;
  agreeElectronic: boolean;
  
  // Account setup legacy/compat fields
  password?: string;
  accountPin?: string;
  enableBiometricLogin?: boolean;
  enableEStatement?: boolean;
}

export type DocumentUploadState = 
  | 'empty'
  | 'selecting'
  | 'uploading'
  | 'processing'
  | 'success'
  | 'error';


export interface StepMetadata {
  id: OnboardingStep;
  stepNumber: number; // 0 for welcome/completed, 1..5 for steps
  title: string;
  subtitle: string;
  estimatedTime: string;
}

// Admin / Risk Dashboard Types
export type AdminNavSection = 
  | 'dashboard' 
  | 'records' 
  | 'risk_cases' 
  | 'system_status' 
  | 'settings';

export type VerificationStatus = 
  | 'passed' 
  | 'pending' 
  | 'high_risk' 
  | 'failed'
  | 'flagged';

export type RiskLevel = 
  | 'low' 
  | 'medium' 
  | 'high';

export type HandlingStatus = 
  | 'completed' 
  | 'manual_review' 
  | 'action_required';

export interface VerificationRecord {
  id: string;
  applicantName: string;
  idNumberMasked: string;
  timestamp: string;
  verificationStatus: VerificationStatus;
  riskLevel: RiskLevel;
  method: string;
  handlingStatus: HandlingStatus;
  durationSec: number;
  notes?: string;
}

export interface DashboardStats {
  totalToday: number;
  totalChangePercent: number;
  passedCount: number;
  passRatePercent: number;
  pendingCount: number;
  pendingNote: string;
  highRiskCount: number;
  highRiskNote: string;
  failedCount: number;
  failedPercent: number;
}

export interface DailyTrendItem {
  date: string;
  passed: number;
  pending: number;
  failed: number;
  total: number;
}

export interface RiskDistributionItem {
  name: string;
  level: RiskLevel;
  count: number;
  percent: number;
  color: string;
}

export interface SystemService {
  id: string;
  name: string;
  status: 'operational' | 'degraded' | 'maintenance';
  statusLabel: string;
  latencyMs: number;
  uptime: string;
}

export interface RiskAlert {
  id: string;
  type: 'high_risk' | 'pending_review' | 'system_notice';
  title: string;
  count: number;
  description: string;
  actionText: string;
  targetNav: AdminNavSection;
}

