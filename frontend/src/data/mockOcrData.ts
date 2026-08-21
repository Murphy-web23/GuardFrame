export interface MockOcrData {
  fullName: string;
  idNumber: string;
  birthday: string;
  phone: string;
  address: string;
}

export const defaultMockOcrData: MockOcrData = {
  fullName: '王小明',
  idNumber: 'A123456789',
  birthday: '1999-05-20',
  phone: '0912345678',
  address: '台北市信義區信義路五段 100 號',
};
