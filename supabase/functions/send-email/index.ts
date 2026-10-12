import { createClient } from 'npm:@supabase/supabase-js@2'
import { admin, isUuid, json } from '../_shared/http.ts'
import { validateEmail } from '../_shared/email.ts'

import { mailConfig, sendMail } from '../_shared/mailTransport.ts'

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return json({})
  if (req.method !== 'POST') return json({ error: 'POST 요청만 허용합니다.' }, 405)
  try {
    const authorization = req.headers.get('authorization') ?? ''
    const db = admin()
    const { data: auth, error: authError } = await db.auth.getUser(authorization.replace(/^Bearer /i, ''))
    if (authError || !auth.user) return json({ error: '로그인이 필요합니다.' }, 401)
    const userDb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: actor, error: actorError } = await userDb.rpc('current_member')
    if (actorError || !actor?.id) return json({ error: '로그인 권한이 만료되었습니다.' }, 403)
    if (Number(req.headers.get('content-length') ?? 0) > 100000) return json({ error: '요청이 너무 큽니다.' }, 413)
    const raw = await req.text()
    if (raw.length > 30000) return json({ error: '요청이 너무 큽니다.' }, 413)
    let input
    try { input = JSON.parse(raw) } catch { return json({ error: '잘못된 요청입니다.' }, 400) }
    const { configured, from } = mailConfig()
    if (input?.action === 'config') return json({ configured, from: configured ? from : null })
    if (!isUuid(input?.request_id) || !isUuid(input?.notice_id)) return json({ error: '올바른 전달사항과 요청 ID가 필요합니다.' }, 400)
    if (input.action === 'status') {
      const { data, error } = await userDb.rpc('notice_email_status', { p_request: input.request_id, p_notice: input.notice_id })
      return error ? json({ error: '발송 상태를 조회하지 못했습니다.' }, 403) : json(data)
    }
    if (input.action !== 'send') return json({ error: '지원하지 않는 요청입니다.' }, 400)
    if (!configured) return json({ error: '메일 발송 연결이 필요합니다. 관리자에게 문의하세요.' }, 503)
    let email
    try { email = validateEmail(input) } catch (error) { return json({ error: (error as Error).message }, 400) }
    const { data: reservation, error: reserveError } = await userDb.rpc('reserve_notice_email', {
      p_request: input.request_id, p_notice: input.notice_id, p_to: email.to, p_subject: email.subject, p_body: email.text,
    })
    if (reserveError) return json({ error: reserveError.message }, 400)
    if (!reservation.fresh) return json({ status: reservation.status })
    const delivered = await sendMail(input.request_id, email)
    const { error: finishError } = await db.rpc('finish_notice_email', { p_request: input.request_id, p_status: delivered.status, p_provider_id: delivered.id })
    if (finishError) return json({ status: 'unknown' })
    return json({ status: delivered.status })
  } catch { return json({ error: '발송 상태를 확인할 수 없습니다. 같은 창에서 다시 확인하세요.' }, 500) }
})
