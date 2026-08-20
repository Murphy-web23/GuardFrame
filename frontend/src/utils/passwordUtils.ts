export interface PasswordValidationResult {
  hasMinLength: boolean;
  hasUpperCase: boolean;
  hasLowerCase: boolean;
  hasNumber: boolean;
  isValid: boolean;
  strength: 'weak' | 'fair' | 'good' | 'strong';
  strengthLabel: string;
  strengthPercent: number;
}

export function validatePassword(pwd: string): PasswordValidationResult {
  const hasMinLength = pwd.length >= 8;
  const hasUpperCase = /[A-Z]/.test(pwd);
  const hasLowerCase = /[a-z]/.test(pwd);
  const hasNumber = /[0-9]/.test(pwd);
  const hasSpecial = /[^a-zA-Z0-9]/.test(pwd);

  const isValid = hasMinLength && hasUpperCase && hasLowerCase && hasNumber;

  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (pwd.length >= 12) score += 1;
  if (hasUpperCase && hasLowerCase) score += 1;
  if (hasNumber) score += 1;
  if (hasSpecial) score += 1;

  let strength: 'weak' | 'fair' | 'good' | 'strong' = 'weak';
  let strengthLabel = '弱';
  let strengthPercent = 25;

  if (pwd.length === 0) {
    strength = 'weak';
    strengthLabel = '請輸入密碼';
    strengthPercent = 0;
  } else if (!isValid || score <= 2) {
    strength = 'weak';
    strengthLabel = '弱';
    strengthPercent = 30;
  } else if (score === 3) {
    strength = 'fair';
    strengthLabel = '普通';
    strengthPercent = 60;
  } else if (score === 4) {
    strength = 'good';
    strengthLabel = '良好';
    strengthPercent = 85;
  } else {
    strength = 'strong';
    strengthLabel = '安全';
    strengthPercent = 100;
  }

  return {
    hasMinLength,
    hasUpperCase,
    hasLowerCase,
    hasNumber,
    isValid,
    strength,
    strengthLabel,
    strengthPercent,
  };
}
