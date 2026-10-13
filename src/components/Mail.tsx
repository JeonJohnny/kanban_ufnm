import { useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, Send } from 'lucide-react'
import { Button } from './ui/button'
import { Modal } from './ui/dialog'
import { edge } from '@/lib/api'
import { makeDraft, mailto } from '@/lib/mail'
import type { Member, Notice } from '@/lib/types'
import { validateEmail, withSystemFooter } from '../../supabase/functions/_shared/email'

export function Mail({ notice, author, recipients, onClose }: { notice: Notice; author: string; recipients: Member[]; onClose: () => void }) {
  const [draft, setDraft] = useState(() => makeDraft(notice.title, notice.content, author))
  const [to, setTo] = useState(() => recipients.length === 1 ? recipients[0].email ?? '' : '')
  const [config, setConfig] = useState<{ configured: boolean; from: string | null } | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [phase, setPhase] = useState<'idle' | 'sending' | 'unknown' | 'sent'>('idle')
  const requestId = useRef(crypto.randomUUID())
  const sending = useRef(false)
  useEffect(() => {
    let active = true
    edge('send-email', { action: 'config' }).then(value => { if (active) setConfig(value) }).catch(() => {
      if (active) { setConfig({ configured: false, from: null }); setError('메일 발송 서버에 연결하지 못했습니다. 관리자에게 연결 설정을 요청하세요.') }
    })
    return () => { active = false }
  }, [])
  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (sending.current || phase === 'sent') return
    setError(''); setMessage('')
    if (!navigator.onLine) { setError('인터넷 연결 후 다시 시도하세요.'); return }
    let email
    try { email = validateEmail({ to: to.trim(), subject: draft.subject, text: draft.body }) }
    catch (e) { setError((e as Error).message); return }
    setDraft(current => ({ ...current, body: email.text }));
    sending.current = true; setPhase('sending')
    try {
      const result = await edge('send-email', { ...email, action: phase === 'unknown' ? 'status' : 'send', request_id: requestId.current, notice_id: notice.id })
      if (result.status === 'sent') { setPhase('sent'); setMessage('메일 발송을 접수했습니다. 수신함 도착 여부는 받는 메일 서버의 처리에 따라 달라질 수 있습니다.') }
      else if (result.status === 'not_found') { setPhase('idle'); requestId.current = crypto.randomUUID(); setError('서버에 발송 요청이 등록되지 않았습니다. 보내기를 눌러 다시 요청하세요.') }
      else if (result.status === 'failed') { setPhase('idle'); requestId.current = crypto.randomUUID(); setError('발송되지 않았습니다. 수신 주소와 관리자의 발송 연결 설정을 확인한 후 다시 시도하세요.') }
      else { setPhase('unknown'); setError('발송 결과를 확인 중입니다. 중복 발송을 막기 위해 다시 보내지 않습니다. 결과 확인을 누르거나 관리자에게 발송 기록 확인을 요청하세요.') }
    } catch (e) {
      const failure = e as Error & { status?: number }
      if (failure.status && failure.status >= 400 && failure.status < 500) { setPhase('idle'); requestId.current = crypto.randomUUID() }
      else setPhase('unknown')
      setError(failure.message)
    } finally { sending.current = false }
  }
  const locked = phase !== 'idle'
  return <Modal title="메일 초안 작성" description="수신 주소와 초안을 확인하고 편집한 뒤 보내기를 누르세요." error={error} wide onClose={() => { if (!sending.current) onClose() }}>
    <form className="form-stack" onSubmit={send}>
      <div className="rounded-xl bg-muted p-3 text-sm">{config === null ? '발송 연결 확인 중…' : config.configured ? <>보내는 주소: <strong>{config.from}</strong></> : '메일 발송 연결이 아직 설정되지 않았습니다. 초안 편집과 복사는 가능합니다.'}</div>
      <fieldset disabled={locked} className="form-stack">
        {recipients.some(m => m.email) && <label>전달사항 수신자에서 선택<select value={recipients.find(m => m.email === to)?.id ?? ''} onChange={e => setTo(recipients.find(m => m.id === e.target.value)?.email ?? '')}><option value="">주소 직접 입력 또는 수신자 선택</option>{recipients.filter(m => m.email).map(m => <option key={m.id} value={m.id}>{m.display_name} · {m.email}</option>)}</select></label>}
        <label>받는 사람 이메일<input type="email" value={to} onChange={e => setTo(e.target.value)} required maxLength={254} placeholder="researcher@example.com" autoComplete="email" /></label>
        <p className="caption">한 번에 한 명에게 발송합니다.{recipients.some(m => !m.email) && ' 이메일 미등록 수신자가 있습니다. 연구원 메뉴에서 등록하거나 주소를 직접 입력하세요.'}</p>
        <Button type="button" variant="outline" onClick={() => { setDraft(makeDraft(notice.title, notice.content, author)); setMessage('초안을 다시 생성했습니다.') }}>초안 다시 작성</Button>
        <label>제목<input value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} required maxLength={200} /></label>
        <label>본문<textarea className="!min-h-64" value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} required maxLength={20000} /></label>
        <p className="caption">사이트 바로가기 링크와 “시스템에서 발송된 메일입니다.” 안내가 자동으로 포함됩니다.</p>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(`${draft.subject}\n\n${withSystemFooter(draft.body)}`); setMessage('복사했습니다.') } catch { setError('복사하지 못했습니다. 텍스트를 직접 선택해 복사하세요.') } }}><Copy />복사</Button>
        {phase === 'idle' && <Button variant="outline" asChild><a href={mailto(draft.subject, withSystemFooter(draft.body), to.trim())}><ExternalLink />메일 앱에서 열기</a></Button>}
        <Button type="submit" disabled={!config?.configured || phase === 'sending' || phase === 'sent'}><Send />{phase === 'sending' ? '처리 중…' : phase === 'sent' ? '발송 접수 완료' : phase === 'unknown' ? '결과 확인' : '보내기'}</Button>
      </div>
      <p role="status" className="caption">{message || '보내기를 누르면 표시된 발신 주소에서 입력한 수신 주소로 바로 발송합니다.'}</p>
    </form>
  </Modal>
}
