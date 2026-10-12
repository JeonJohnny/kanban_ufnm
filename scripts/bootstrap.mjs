import { createClient } from '@supabase/supabase-js'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) throw new Error('.env.server에 SUPABASE_URL, SUPABASE_SECRET_KEY를 입력하세요. VITE_ 접두사를 사용하지 마세요.')
const rl = createInterface({ input: stdin, output: stdout })
const name = (await rl.question('첫 관리자 이름: ')).trim()
const workspace = (await rl.question('연구실 이름: ')).trim()
rl.close()
if (!name || !workspace) throw new Error('이름과 연구실 이름이 필요합니다.')
if (!stdin.isTTY) throw new Error('PIN은 대화형 터미널에서 입력하세요.')
stdout.write('관리자 PIN (숫자 4자리, 화면에 표시되지 않음): ')
stdin.setRawMode(true)
stdin.resume()
const pin = await new Promise((resolve, reject) => {
  let value = ''
  const read = chunk => {
    for (const char of chunk.toString()) {
      if (char === '\u0003') { cleanup(); reject(new Error('취소했습니다.')); return }
      if (char === '\r' || char === '\n') { cleanup(); resolve(value); return }
      if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
      else value += char
    }
  }
  const cleanup = () => { stdin.off('data', read); stdin.setRawMode(false); stdin.pause(); stdout.write('\n') }
  stdin.on('data', read)
})
if (!/^\d{4}$/.test(pin)) throw new Error('PIN은 숫자 4자리여야 합니다.')
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const { data, error } = await db.auth.admin.createUser({ email: `${crypto.randomUUID()}@lab-board.invalid`, password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: true })
if (error) throw new Error('Auth 계정 생성 실패: 서버 키와 프로젝트 URL을 확인하세요.')
const { error: saveError } = await db.rpc('admin_save_member', { p_actor: null, p_session: null, p_user: data.user.id, p_name: name, p_pin: pin, p_workspace_name: workspace })
if (saveError) {
  await db.auth.admin.deleteUser(data.user.id)
  throw new Error(`관리자 생성 실패: ${saveError.message}`)
}
stdout.write('초기 관리자 생성 완료. 앱에서 이름과 PIN으로 로그인하세요.\n')
