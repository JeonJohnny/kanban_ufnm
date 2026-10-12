import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { execSync } from 'node:child_process'

// Keep the scheduler credential out of source, command arguments, and console output.
const secretPath = '.env.task-worker'
if (!existsSync(secretPath)) writeFileSync(secretPath, `TASK_EMAIL_WORKER_TOKEN=${randomBytes(32).toString('hex')}\n`, { flag: 'wx' })
const token = parseEnv(readFileSync(secretPath, 'utf8')).TASK_EMAIL_WORKER_TOKEN
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!/^[a-f0-9]{64}$/.test(token ?? '') || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url ?? '') || !key) throw new Error('서버 설정을 확인하세요. --env-file=.env.server가 필요합니다.')
try {
  execSync('npx.cmd supabase secrets set --env-file .env.task-worker', { stdio: 'pipe', windowsHide: true })
  const response = await fetch(`${url}/rest/v1/rpc/configure_task_email_worker`, {
    method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_url: `${url}/functions/v1/task-email-worker`, p_token: token }),
  })
  if (!response.ok) throw new Error(`스케줄러 설정 실패: HTTP ${response.status}`)
  const result = await response.json()
  console.log({ configured: result.configured, schedule: result.schedule, active: result.active })
  const health = await fetch(`${url}/functions/v1/task-email-worker?health=1`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' })
  const state = await health.json()
  console.log({ workerHttp: health.status, mailConnectionMissing: state.status === 'not_configured', processed: state.processed })
  if (!health.ok) process.exitCode = 1
} catch {
  console.error('자동 메일 설정을 완료하지 못했습니다. CLI 로그인·프로젝트 연결·마이그레이션·함수 배포 상태를 확인하세요.')
  process.exitCode = 1
}
