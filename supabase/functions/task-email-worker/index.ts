import { admin, json } from '../_shared/http.ts'
import { mailConfig, sendMail } from '../_shared/mailTransport.ts'
import { validateEmail } from '../_shared/email.ts'
import { taskDigest, type TaskEmailBatch } from '../_shared/taskDigest.ts'

Deno.serve(async req => {
  const token = Deno.env.get('TASK_EMAIL_WORKER_TOKEN')
  if (!token || req.headers.get('authorization') !== `Bearer ${token}`) return json({ error: '인증이 필요합니다.' }, 401)
  if (req.method !== 'POST') return json({ error: 'POST 요청만 허용합니다.' }, 405)
  if (!mailConfig().configured) return json({ status: 'not_configured' })
  if (new URL(req.url).searchParams.get('health') === '1') return json({ status: 'ready' })
  try {
    const db = admin()
    const { data, error } = await db.rpc('claim_task_emails')
    if (error) return json({ error: '발송 대기열을 조회하지 못했습니다.' }, 500)
    const batches = data as TaskEmailBatch[]
    // Bound concurrent SMTP connections while staying within the Edge runtime deadline.
    for (let i = 0; i < batches.length; i += 3) {
      await Promise.all(batches.slice(i, i + 3).map(async batch => {
        let result: { status: 'sent' | 'failed' | 'unknown'; id: string | null }
        try { result = await sendMail(batch.id, validateEmail(taskDigest(batch))) }
        catch { result = { status: 'unknown', id: null } }
        const { error: finishError } = await db.rpc('finish_task_email', { p_batch: batch.id, p_status: result.status, p_provider_id: result.id })
        if (finishError) throw new Error('발송 결과 저장 실패')
      }))
    }
    return json({ processed: batches.length })
  } catch { return json({ error: '발송 처리 상태를 확인하세요.' }, 500) }
})
