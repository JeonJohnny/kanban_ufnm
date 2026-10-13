import { describe, expect, it, vi } from 'vitest'
import { deliverEmail, deliverSmtpEmail, validateEmail, withSystemFooter } from '../supabase/functions/_shared/email'
import { taskDigest } from '../supabase/functions/_shared/taskDigest'

const email = { to: 'colleague@example.com', subject: '편집된 제목', text: '사용자가 편집한 본문\n다음 줄' }
describe('서버 메일 발송', () => {
  it('자동 메일은 수신자의 새 태스크를 묶고 긴 목록도 본문 제한 안에 유지한다', () => {
    const draft=taskDigest({id:'batch',to:email.to,name:'연구원',tasks:Array.from({length:50},()=>({title:'가'.repeat(200),project:'나'.repeat(100)}))})
    expect(draft.subject).toContain('50개')
    expect(draft.text).toContain('외 20개 태스크')
    expect(draft.text).toContain('https://jeonjohnny.github.io/kanban_ufnm/')
    expect(validateEmail(draft).text).toMatch(/시스템에서 발송된 메일입니다\.$/)
  })
  it('잘못된 주소와 헤더 삽입 및 빈 본문을 거부한다', () => {
    expect(() => validateEmail({ ...email, to: 'a@example.com\r\nBcc:b@example.com' })).toThrow()
    expect(() => validateEmail({ ...email, subject: 'title\nBcc:evil' })).toThrow()
    expect(() => validateEmail({ ...email, text: ' ' })).toThrow()
    expect(validateEmail(email)).toEqual({ ...email, text: withSystemFooter(email.text) })
    expect(withSystemFooter(withSystemFooter(email.text))).toBe(withSystemFooter(email.text))
  })
  it('편집한 내용을 그대로 보내고 요청별 중복 방지 키를 사용한다', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'provider-id' }))
    expect(await deliverEmail('test-key', 'lab@example.com', 'request-1', email, transport)).toEqual({ status: 'sent', id: 'provider-id' })
    expect(transport).toHaveBeenCalledTimes(1)
    const [, options] = transport.mock.calls[0]
    expect(JSON.parse(options!.body as string)).toEqual({ from: 'lab@example.com', to: [email.to], subject: email.subject, text: email.text })
    expect(new Headers(options!.headers).get('Idempotency-Key')).toBe('lab-notice/request-1')
  })
  it('직접 발송과 기존 안내가 있는 본문에도 사이트 링크를 한 번만 포함한다', () => {
    const url = 'https://jeonjohnny.github.io/kanban_ufnm/'
    for (const text of [email.text, `${email.text}\n\n시스템에서 발송된 메일입니다.`, `${email.text}\n${url}`]) {
      const result = validateEmail({ ...email, text }).text
      expect(result.split(url)).toHaveLength(2)
      expect(withSystemFooter(result)).toBe(result)
      expect(result).toContain(email.text)
    }
    expect(() => validateEmail({ ...email, text: '가'.repeat(19990) })).toThrow(/20,000자/)
  })
  it('통신 결과가 불명확하면 성공으로 표시하거나 자동 재발송하지 않는다', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout'))
    expect((await deliverEmail('test', 'lab@example.com', 'request-1', email, transport)).status).toBe('unknown')
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('명확한 거절과 서버 오류를 구분한다', async () => {
    const rejected = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'invalid' }, { status: 422 }))
    const uncertain = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 500 }))
    expect((await deliverEmail('test', 'lab@example.com', 'request-1', email, rejected)).status).toBe('failed')
    expect((await deliverEmail('test', 'lab@example.com', 'request-1', email, uncertain)).status).toBe('unknown')
  })
  it('Gmail SMTP 접수·거절·응답 유실을 구분하고 자동 재전송하지 않는다', async () => {
    const success=vi.fn().mockResolvedValue({accepted:[email.to],messageId:'smtp-id'})
    expect(await deliverSmtpEmail(success,email.to)).toEqual({status:'sent',id:'smtp-id'})
    const rejected=vi.fn().mockRejectedValue({responseCode:535})
    expect((await deliverSmtpEmail(rejected,email.to)).status).toBe('failed')
    const timeout=vi.fn().mockRejectedValue(new Error('timeout'))
    expect((await deliverSmtpEmail(timeout,email.to)).status).toBe('unknown')
    expect(timeout).toHaveBeenCalledTimes(1)
  })
})
