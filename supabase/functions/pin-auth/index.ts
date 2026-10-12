import { admin, body, isPin, isUuid, json, preflight, sessionId } from '../_shared/http.ts'

Deno.serve(async req => {
  const early = preflight(req)
  if (early) return early
  try {
    const input = await body(req)
    const db = admin()
    if (input.action === 'roster') {
      const { data, error } = await db.rpc('login_roster')
      if (error) throw error
      return json({ members: data })
    }
    if (!isUuid(input.member_id) || !isPin(input.pin)) return json({ error: '이름을 선택하고 숫자 4자리를 입력하세요.' }, 400)
    // The per-member limit remains authoritative even when a proxy address is unavailable.
    const origin = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',').at(-1)!.trim()
    const { data: checked, error } = await db.rpc('pin_check', { p_member: input.member_id, p_pin: input.pin, p_origin: origin })
    if (error) throw error
    if (checked.error) return json({ error: checked.error }, 429)
    const { data: user, error: userError } = await db.auth.admin.getUserById(checked.auth_user_id)
    if (userError || !user.user?.email) throw userError ?? new Error('계정 정보가 없습니다.')
    const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: 'magiclink', email: user.user.email })
    if (linkError) throw linkError
    const { data, error: verifyError } = await db.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
    if (verifyError || !data.session) throw verifyError ?? new Error('세션 발급 실패')
    // verifyOtp changes the client's auth context; register using a fresh server client.
    const { error: registrationError } = await admin().rpc('pin_register_session', {
      p_member: input.member_id, p_session: sessionId(data.session.access_token), p_version: checked.version,
    })
    if (registrationError) throw registrationError
    return json({ session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } })
  } catch {
    return json({ error: '로그인 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.' }, 500)
  }
})
