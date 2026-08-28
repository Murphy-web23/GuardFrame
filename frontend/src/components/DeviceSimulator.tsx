import React from 'react';

// 2026-08-23：這個檔案原本是「裝置模擬器」──開發時用的檢視工具，上面
// 有手動切換手機/桌面模式的按鈕、假的手機外殼（狀態列/電量/瀏海）、
// 「登入後台」按鈕、AI Guardian 表情檢核台。這些都只是開發階段方便
// 預覽用的介面，不是正式上線會有的東西：
//   - 真的使用者用自己的手機打開網站，本來就會看到自己手機真正的
//     狀態列，不需要在網頁裡再畫一個假的手機外殼套在裡面
//   - 後台入口不應該出現在使用者看得到的畫面裡，只能透過網址
//     （#admin）直接進入，見 App.tsx
//   - 手機版/桌面版的切換，App.tsx 已經用真正的 CSS 響應式做法
//     （`block md:hidden` / `hidden md:flex`）分流，不需要 JS 手動
//     切換
// 這裡簡化成只保留最外層的版面容器，其餘開發用的介面全部拿掉。

interface DeviceSimulatorProps {
  children: React.ReactNode;
}

export const DeviceSimulator: React.FC<DeviceSimulatorProps> = ({ children }) => {
  // 跟 App.tsx 同一個理由：min-h-screen（100vh）在 Android 網址列
  // 展開/收合時會跟實際可視區域對不上，換成 min-h-dvh。
  return <div className="min-h-dvh bg-slate-100 text-slate-800 antialiased">{children}</div>;
};
