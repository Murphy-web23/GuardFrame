import React, { useState } from 'react';
import { FormData } from '../../types';
import { defaultMockOcrData } from '../../data/mockOcrData';
import { DemoUserPicker } from '../common/DemoUserPicker';
import { DemoUser } from '../../data/demoUsers';
import { 
  ArrowRight, 
  User, 
  CreditCard, 
  Calendar, 
  Phone, 
  Mail, 
  MapPin, 
  Sparkles,
  CheckCircle2,
  Edit3
} from 'lucide-react';
import { 
  validateFullName, 
  validateTaiwanId, 
  validateBirthday, 
  validateTaiwanPhone,
  validateAddress
} from '../../utils/validators';

interface BasicInfoScreenProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

export const BasicInfoScreen: React.FC<BasicInfoScreenProps> = ({
  formData,
  updateFormData,
  onNext,
}) => {
  const [fullName, setFullName] = useState<string>(formData.fullName || defaultMockOcrData.fullName);
  const [idNumber, setIdNumber] = useState<string>(formData.idNumber || defaultMockOcrData.idNumber);
  const [birthday, setBirthday] = useState<string>(formData.birthday || defaultMockOcrData.birthday);
  const [phone, setPhone] = useState<string>(formData.phone || defaultMockOcrData.phone);
  const [email, setEmail] = useState<string>(formData.email || 'user@example.com');
  const [address, setAddress] = useState<string>(formData.address || defaultMockOcrData.address);

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSelectDemoUser = (user: DemoUser) => {
    setFullName(user.fullName);
    setIdNumber(user.idNumber);
    setBirthday(user.birthday);
    setPhone(user.phone);
    setEmail(user.email);
    setAddress(user.address);
    setErrors({});
  };

  const handleConfirm = () => {
    const newErrors: Record<string, string> = {};

    if (!fullName.trim() || !validateFullName(fullName)) {
      newErrors.fullName = '請輸入完整中文姓名';
    }
    if (!idNumber.trim() || !validateTaiwanId(idNumber)) {
      newErrors.idNumber = '請輸入正確的身分證字號';
    }
    if (!birthday.trim() || !validateBirthday(birthday)) {
      newErrors.birthday = '請確認出生年月日（須滿 18 歲）';
    }
    if (!phone.trim() || !validateTaiwanPhone(phone)) {
      newErrors.phone = '請確認手機號碼';
    }
    if (!address.trim() || !validateAddress(address)) {
      newErrors.address = '請輸入完整的戶籍地址';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    updateFormData({
      fullName,
      idNumber,
      birthday,
      phone,
      email,
      address,
    });

    onNext();
  };

  return (
    <div className="flex flex-col flex-1 px-5 pt-3 pb-8 bg-white select-none">
      {/* Step Header */}
      <div className="mb-4">
        <span className="text-[11px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-100">
          Step 3 / 6
        </span>
        <h1 className="text-xl font-black text-slate-900 tracking-tight mt-1.5">
          確認個人資料
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          系統已自動帶入證件資料，請確認或修改。
        </p>
      </div>

      {/* Auto-fill Badge */}
      <div className="mb-4 p-2.5 rounded-2xl bg-emerald-50/80 border border-emerald-200/70 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-emerald-800 font-bold">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>身分證資料已自動辨識填入</span>
        </div>
        <span className="text-[11px] text-emerald-600 font-medium">可點擊欄位修改</span>
      </div>

      {/* Form Fields Container */}
      <div className="space-y-3.5 flex-1">
        {/* Full Name */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700">中文姓名</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <User className="h-4 w-4" />
            </div>
            <input
              id="field-fullname"
              type="text"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                setErrors((prev) => ({ ...prev, fullName: '' }));
              }}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-900 focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
            />
          </div>
          {errors.fullName && <p className="text-[11px] text-rose-500 pl-1">{errors.fullName}</p>}
        </div>

        {/* ID Number */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700">身分證字號</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <CreditCard className="h-4 w-4" />
            </div>
            <input
              id="field-idnumber"
              type="text"
              maxLength={10}
              value={idNumber}
              onChange={(e) => {
                setIdNumber(e.target.value.toUpperCase());
                setErrors((prev) => ({ ...prev, idNumber: '' }));
              }}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-900 focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none uppercase"
            />
          </div>
          {errors.idNumber && <p className="text-[11px] text-rose-500 pl-1">{errors.idNumber}</p>}
        </div>

        {/* Birthday & Phone (2 cols) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">出生年月日</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Calendar className="h-4 w-4" />
              </div>
              <input
                id="field-birthday"
                type="date"
                value={birthday}
                onChange={(e) => {
                  setBirthday(e.target.value);
                  setErrors((prev) => ({ ...prev, birthday: '' }));
                }}
                className="w-full pl-9 pr-2 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-900 focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
              />
            </div>
            {errors.birthday && <p className="text-[11px] text-rose-500 pl-1">{errors.birthday}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">手機號碼</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Phone className="h-4 w-4" />
              </div>
              <input
                id="field-phone"
                type="tel"
                maxLength={10}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value.replace(/\D/g, ''));
                  setErrors((prev) => ({ ...prev, phone: '' }));
                }}
                className="w-full pl-9 pr-2 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-900 focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
              />
            </div>
            {errors.phone && <p className="text-[11px] text-rose-500 pl-1">{errors.phone}</p>}
          </div>
        </div>

        {/* Address */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700">戶籍地址</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <MapPin className="h-4 w-4" />
            </div>
            <input
              id="field-address"
              type="text"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setErrors((prev) => ({ ...prev, address: '' }));
              }}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-900 focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
            />
          </div>
          {errors.address && <p className="text-[11px] text-rose-500 pl-1">{errors.address}</p>}
        </div>

        {/* Demo User Picker (Secondary) */}
        <div className="pt-2">
          <DemoUserPicker onSelectUser={handleSelectDemoUser} />
        </div>
      </div>

      {/* Primary CTA: 確認資料 */}
      <div className="pt-4">
        <button
          id="confirm-basic-info-btn"
          type="button"
          onClick={handleConfirm}
          className="w-full py-3.5 px-6 rounded-2xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-bold text-sm shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <span>確認資料</span>
          <ArrowRight className="h-4 w-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
