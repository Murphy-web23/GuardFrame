import {
  DashboardStats,
  DailyTrendItem,
  RiskDistributionItem,
  VerificationRecord,
  SystemService,
  RiskAlert
} from '../types';

export const mockDashboardStats: DashboardStats = {
  totalToday: 1284,
  totalChangePercent: 12,
  passedCount: 1167,
  passRatePercent: 90.9,
  pendingCount: 32,
  pendingNote: '需要人工確認',
  highRiskCount: 8,
  highRiskNote: '需要優先處理',
  failedCount: 77,
  failedPercent: 6.0,
};

export const mockVerificationTrend: DailyTrendItem[] = [
  { date: '08/12', passed: 980, pending: 28, failed: 52, total: 1060 },
  { date: '08/13', passed: 1040, pending: 35, failed: 65, total: 1140 },
  { date: '08/14', passed: 1120, pending: 30, failed: 58, total: 1208 },
  { date: '08/15', passed: 1085, pending: 25, failed: 60, total: 1170 },
  { date: '08/16', passed: 1210, pending: 40, failed: 70, total: 1320 },
  { date: '08/17', passed: 1145, pending: 38, failed: 68, total: 1251 },
  { date: '08/18 (今日)', passed: 1167, pending: 32, failed: 77, total: 1284 },
];

export const mockRiskDistribution: RiskDistributionItem[] = [
  { name: '低風險 (Low Risk)', level: 'low', count: 1130, percent: 88.0, color: '#10B981' }, // Mint Green / Emerald
  { name: '中風險 (Medium Risk)', level: 'medium', count: 115, percent: 9.0, color: '#0EA5E9' }, // Sky Blue
  { name: '高風險 (High Risk)', level: 'high', count: 39, percent: 3.0, color: '#F43F5E' }, // Soft Rose Red
];

export const mockRecentVerifications: VerificationRecord[] = [
  {
    id: 'VF-20260818-001',
    applicantName: '林*宇',
    idNumberMasked: 'A123***789',
    timestamp: '10:42',
    verificationStatus: 'passed',
    riskLevel: 'low',
    method: '身分證 + 人臉活體',
    handlingStatus: 'completed',
    durationSec: 23,
    notes: '所有身分特徵比對皆正常通過'
  },
  {
    id: 'VF-20260818-002',
    applicantName: '陳*華',
    idNumberMasked: 'F228***312',
    timestamp: '10:38',
    verificationStatus: 'pending',
    riskLevel: 'medium',
    method: '身分證 + 人臉活體',
    handlingStatus: 'manual_review',
    durationSec: 35,
    notes: '身分證邊緣反光輕微，建議專人二次抽檢'
  },
  {
    id: 'VF-20260818-003',
    applicantName: '王*明',
    idNumberMasked: 'B120***456',
    timestamp: '10:31',
    verificationStatus: 'high_risk',
    riskLevel: 'high',
    method: '身分證 + 人臉活體',
    handlingStatus: 'action_required',
    durationSec: 18,
    notes: '動態環境偵測光影異常，已標記高風險'
  },
  {
    id: 'VF-20260818-004',
    applicantName: '張*涵',
    idNumberMasked: 'H221***890',
    timestamp: '10:25',
    verificationStatus: 'passed',
    riskLevel: 'low',
    method: '身分證 + 人臉活體',
    handlingStatus: 'completed',
    durationSec: 22,
    notes: '核驗通過，資料辨識度高'
  },
  {
    id: 'VF-20260818-005',
    applicantName: '李*豪',
    idNumberMasked: 'E124***678',
    timestamp: '10:19',
    verificationStatus: 'failed',
    riskLevel: 'medium',
    method: '身分證 + 人臉活體',
    handlingStatus: 'completed',
    durationSec: 45,
    notes: '簡訊驗證碼多次輸入錯誤'
  },
  {
    id: 'VF-20260818-006',
    applicantName: '趙*婷',
    idNumberMasked: 'D225***901',
    timestamp: '10:12',
    verificationStatus: 'passed',
    riskLevel: 'low',
    method: '身分證 + 人臉活體',
    handlingStatus: 'completed',
    durationSec: 21,
    notes: '核驗通過'
  },
  {
    id: 'VF-20260818-007',
    applicantName: '許*宏',
    idNumberMasked: 'A129***234',
    timestamp: '10:05',
    verificationStatus: 'pending',
    riskLevel: 'medium',
    method: '身分證 + 人臉活體',
    handlingStatus: 'manual_review',
    durationSec: 29,
    notes: '身分證反面條碼磨損，待專員人工比對'
  },
  {
    id: 'VF-20260818-008',
    applicantName: '楊*君',
    idNumberMasked: 'K223***567',
    timestamp: '09:58',
    verificationStatus: 'high_risk',
    riskLevel: 'high',
    method: '身分證 + 人臉活體',
    handlingStatus: 'action_required',
    durationSec: 15,
    notes: '連續 3 次人臉驗證未對準框線，進入人工覆核佇列'
  },
  {
    id: 'VF-20260818-009',
    applicantName: '黃*偉',
    idNumberMasked: 'P122***119',
    timestamp: '09:44',
    verificationStatus: 'passed',
    riskLevel: 'low',
    method: '身分證 + 人臉活體',
    handlingStatus: 'completed',
    durationSec: 24,
    notes: '核驗通過'
  },
  {
    id: 'VF-20260818-010',
    applicantName: '吳*儒',
    idNumberMasked: 'T127***882',
    timestamp: '09:30',
    verificationStatus: 'passed',
    riskLevel: 'low',
    method: '身分證 + 人臉活體',
    handlingStatus: 'completed',
    durationSec: 20,
    notes: '核驗通過'
  },
];

export const mockRiskAlerts: RiskAlert[] = [
  {
    id: 'alert-1',
    type: 'high_risk',
    title: '高風險案件',
    count: 8,
    description: '件案件偵測到異常動態環境特徵，需要優先處理',
    actionText: '查看風險案件',
    targetNav: 'risk_cases'
  },
  {
    id: 'alert-2',
    type: 'pending_review',
    title: '待人工審核',
    count: 32,
    description: '件驗證因影像模糊或條碼磨損，需要人工確認',
    actionText: '前往審核清單',
    targetNav: 'records'
  }
];

export const mockSystemServices: SystemService[] = [
  {
    id: 'svc-1',
    name: 'Face Verification (人臉驗證服務)',
    status: 'operational',
    statusLabel: 'Operational (運作正常)',
    latencyMs: 120,
    uptime: '99.98%'
  },
  {
    id: 'svc-2',
    name: 'Liveness Detection (活體偵測引擎)',
    status: 'operational',
    statusLabel: 'Operational (運作正常)',
    latencyMs: 185,
    uptime: '99.95%'
  },
  {
    id: 'svc-3',
    name: 'Document Verification (證件資料辨識)',
    status: 'operational',
    statusLabel: 'Operational (運作正常)',
    latencyMs: 210,
    uptime: '99.92%'
  },
  {
    id: 'svc-4',
    name: 'AI Analysis Engine (AI 智能風控分析)',
    status: 'operational',
    statusLabel: 'Operational (運作正常)',
    latencyMs: 140,
    uptime: '99.99%'
  },
  {
    id: 'svc-5',
    name: 'Database & Audit (稽核資料庫)',
    status: 'operational',
    statusLabel: 'Operational (運作正常)',
    latencyMs: 45,
    uptime: '100.0%'
  },
];
