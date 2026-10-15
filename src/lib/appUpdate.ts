import { registerSW } from 'virtual:pwa-register'

let ready = false
export const isAppUpdateReady = () => ready
export const applyAppUpdate = registerSW({
  onNeedRefresh() {
    ready = true
    window.dispatchEvent(new Event('app-update-ready'))
  },
  onRegisteredSW(_url, registration) {
    window.addEventListener('focus', () => { void registration?.update().catch(() => {}) })
  },
})
