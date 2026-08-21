export interface DemoUser {
  id: string;
  name: string;
  fullName: string;
  idNumber: string;
  birthday: string;
  phone: string;
  email: string;
  address: string;
  description?: string;
}

export const demoUsers: DemoUser[] = [
  {
    id: 'demo-01',
    name: 'Demo User 01',
    fullName: '王小明',
    idNumber: 'A123456789',
    birthday: '1999-05-20',
    phone: '0912345678',
    email: 'ming.wang@example.com',
    address: '台北市大安區忠孝東路四段 100 號 5 樓',
    description: '青年學生 / 標準證件',
  },
  {
    id: 'demo-02',
    name: 'Demo User 02',
    fullName: '陳怡君',
    idNumber: 'B234567890',
    birthday: '2000-03-12',
    phone: '0923456789',
    email: 'yijun.chen@example.com',
    address: '新北市板橋區文化路二段 188 號 12 樓',
    description: '上班族 / 即時核驗',
  },
  {
    id: 'demo-03',
    name: 'Demo User 03',
    fullName: '林冠宇',
    idNumber: 'C145678901',
    birthday: '1998-11-08',
    phone: '0934567890',
    email: 'guanyu.lin@example.com',
    address: '台中市西屯區台灣大道三段 99 號',
    description: '自由工作者 / 良好信用',
  },
  {
    id: 'demo-04',
    name: 'Demo User 04',
    fullName: '張雅婷',
    idNumber: 'D245678901',
    birthday: '2001-07-24',
    phone: '0945678901',
    email: 'yating.zhang@example.com',
    address: '高雄市前鎮區中華五路 789 號 8 樓',
    description: '數位新創 / 快速開戶',
  },
  {
    id: 'demo-05',
    name: 'Demo User 05',
    fullName: '李承翰',
    idNumber: 'E156789012',
    birthday: '1997-02-16',
    phone: '0956789012',
    email: 'chenghan.li@example.com',
    address: '新竹市東區光復路二段 101 號',
    description: '工程師 / 完整身分特徵',
  },
];
