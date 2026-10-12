import { admin, body, isPin, isUuid, json, preflight, sessionId } from '../_shared/http.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { validateEmail } from '../_shared/email.ts'

Deno.serve(async req => {
  const early = preflight(req)
  if (early) return early
  let createdUser: string | undefined
  const db = admin()
  try {
    const authorization = req.headers.get('authorization') ?? ''
    const jwt = authorization.replace(/^Bearer /i, '')
    const { data: auth, error: authError } = await db.auth.getUser(jwt)
    if (authError || !auth.user) return json({ error: '로그인이 필요합니다.' }, 401)
    const userDb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
    })
    const { data: actor, error: actorError } = await userDb.rpc('current_member')
    if (actorError || !['admin', 'deputy'].includes(actor?.role)) return json({ error: '관리자만 사용할 수 있습니다.' }, 403)
    const input = await body(req)
    if (!isPin(input.pin) || (input.member_id && !isUuid(input.member_id))) return json({ error: '올바른 PIN과 연구원을 입력하세요.' }, 400)
    let email: string | null = null
    if (!input.member_id) {
      if (input.email != null && typeof input.email !== 'string') return json({ error: '이메일 주소를 확인하세요.' }, 400)
      email = input.email?.trim() || null
      if (email) {
        try { validateEmail({ to: email, subject: 'validation', text: 'validation' }) }
        catch { return json({ error: '이메일 주소를 확인하세요.' }, 400) }
      }
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 50) return json({ error: '이름은 1~50자입니다.' }, 400)
      const { data, error } = await db.auth.admin.createUser({
        email: `${crypto.randomUUID()}@lab-board.invalid`, email_confirm: true,
        password: crypto.randomUUID() + crypto.randomUUID(),
      })
      if (error) throw error
      createdUser = data.user.id
    }
    const { data, error } = await db.rpc('admin_save_member', {
      p_actor: auth.user.id, p_session: sessionId(jwt), p_user: createdUser ?? null,
      p_name: input.name ?? '', p_pin: input.pin, p_member: input.member_id ?? null, p_email: email,
    })
    if (error) throw error
    return json({ id: data })
  } catch {
    if (createdUser) await db.auth.admin.deleteUser(createdUser)
    return json({ error: '연구원 저장에 실패했습니다. 관리자 세션과 입력값을 확인하세요.' }, 400)
  }
})
