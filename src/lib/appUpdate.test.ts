import { afterEach, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ register: vi.fn(), apply: vi.fn(async () => {}) }))
vi.mock('virtual:pwa-register', () => ({ registerSW: mocked.register }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

it('keeps an early update notification and activates only on explicit request', async () => {
  const target = new EventTarget()
  vi.stubGlobal('window', target)
  mocked.register.mockReturnValue(mocked.apply)
  const { isAppUpdateReady, applyAppUpdate } = await import('./appUpdate')
  const options = mocked.register.mock.calls[0][0]
  const notified = vi.fn()
  target.addEventListener('app-update-ready', notified)
  expect(isAppUpdateReady()).toBe(false)
  options.onNeedRefresh()
  expect(isAppUpdateReady()).toBe(true)
  expect(notified).toHaveBeenCalledOnce()
  expect(mocked.apply).not.toHaveBeenCalled()
  await applyAppUpdate(true)
  expect(mocked.apply).toHaveBeenCalledWith(true)
  const check = vi.fn(async () => {})
  options.onRegisteredSW('/sw.js', { update: check })
  target.dispatchEvent(new Event('focus'))
  expect(check).toHaveBeenCalledOnce()
})
