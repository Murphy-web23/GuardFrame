import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // 2026-08-27：QR code 手機測試用 npm run dev（不是 preview），
      // dev server 一樣會擋掉不認識的 Host header，理由跟下面 preview
      // 區塊一樣，這裡補一份同樣的設定。
      allowedHosts: ['.trycloudflare.com'],
    },
    preview: {
      // 2026-08-24：QR code 展示用 Cloudflare Tunnel（trycloudflare.com）
      // 走的網域每次重開 tunnel 都會換一個隨機子網域，Vite 預覽伺服器
      // 預設會擋掉不認識的 Host header（防 DNS rebinding），用萬用字元
      // 放行整個 trycloudflare.com，不用每次重開都回來改設定。
      allowedHosts: ['.trycloudflare.com'],
    },
  };
});
