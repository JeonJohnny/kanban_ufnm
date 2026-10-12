export function withSystemFooter(text: string) {
  const footer = '시스템에서 발송된 메일입니다.'
  return text.includes(footer) ? text : `${text.trimEnd()}\n\n${footer}`
}

export function validateEmail(input: { to?: unknown; subject?: unknown; text?: unknown }) {
  if (typeof input.to !== 'string' || input.to.length > 254 || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(input.to)) throw new Error('수신 이메일 주소를 확인하세요.')
  if (typeof input.subject !== 'string' || !input.subject.trim() || input.subject.length > 200 || /[\r\n]/.test(input.subject)) throw new Error('제목은 줄바꿈 없이 1~200자로 입력하세요.')
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 20000) throw new Error('본문은 1~20,000자로 입력하세요.')
  const text = withSystemFooter(input.text)
  if (text.length > 20000) throw new Error('시스템 안내 문구를 포함해 본문을 20,000자 이내로 줄여 주세요.')
  return { to: input.to, subject: input.subject, text }
}

export async function deliverSmtpEmail(send: () => Promise<{ accepted: unknown[]; messageId: string }>, to: string) {
  try {
    const result = await send()
    return result.accepted.includes(to) ? { status: 'sent' as const, id: result.messageId } : { status: 'failed' as const, id: null }
  } catch (error) {
    const code = (error as { responseCode?: number }).responseCode
    // A lost SMTP response can mean delivery succeeded; never retry it automatically.
    return { status: code && code >= 400 && code < 600 ? 'failed' as const : 'unknown' as const, id: null }
  }
}

export async function deliverEmail(apiKey: string, from: string, requestId: string, email: { to: string; subject: string; text: string }, transport: typeof fetch = fetch) {
  try {
    const response = await transport('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `lab-notice/${requestId}` },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text }), signal: AbortSignal.timeout(15000),
    })
    const result = await response.json().catch(() => null)
    if (response.ok && typeof result?.id === 'string') return { status: 'sent' as const, id: result.id }
    // An ambiguous response must never trigger a second external send.
    if (response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status)) return { status: 'failed' as const, id: null }
    return { status: 'unknown' as const, id: null }
  } catch { return { status: 'unknown' as const, id: null } }
}
