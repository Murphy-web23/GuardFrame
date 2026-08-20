// Mock validation helpers for GuardFrame

export function validateTaiwanId(id: string): boolean {
  if (!id || id.trim().length !== 10) return false;
  const regex = /^[A-Z][12]\d{8}$/;
  return regex.test(id.trim().toUpperCase());
}

export function validateTaiwanPhone(phone: string): boolean {
  if (!phone) return false;
  const clean = phone.replace(/\D/g, '');
  return /^09\d{8}$/.test(clean);
}

export function validateBirthday(birthday: string): boolean {
  if (!birthday) return false;
  const date = new Date(birthday);
  if (isNaN(date.getTime())) return false;
  
  // Check age >= 18 (e.g. year <= 2008)
  const today = new Date();
  const age = today.getFullYear() - date.getFullYear();
  return age >= 18 && age <= 100;
}

export function validateFullName(name: string): boolean {
  return !!name && name.trim().length >= 2 && name.trim().length <= 20;
}

export function validateEmail(email: string): boolean {
  if (!email) return false;
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email.trim());
}

export function validateAddress(address: string): boolean {
  return !!address && address.trim().length >= 5;
}
