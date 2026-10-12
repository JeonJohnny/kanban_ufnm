import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const key = loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_PUBLISHABLE_KEY
  if (key && !key.startsWith('sb_publishable_')) throw new Error('프론트엔드에는 sb_publishable_ 키만 사용할 수 있습니다. 서버 secret/service_role 키를 제거하세요.')
  return {
  base: '/kanban_ufnm/',
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
    manifest: {
      name: 'Lab Project Board', short_name: 'Lab Board', lang: 'ko',
      description: '연구실 프로젝트 보드', theme_color: '#4f46e5', background_color: '#f8fafc',
      display: 'standalone', start_url: './', scope: './',
      icons: [192, 512].map(size => ({ src: `icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
    },
    workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], navigateFallbackDenylist: [/^\/auth/, /^\/functions/], cleanupOutdatedCaches: true },
  })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  }
})
