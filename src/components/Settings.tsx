import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { edge, supabase } from '@/lib/api'
import { Button } from './ui/button'

type EmailSettings = { enabled: boolean; start_hour: number; end_hour: number; stats: { pending: number; missing_email: number; failed: number; unknown: number } }
export function Settings() {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const settings = useQuery({ queryKey: ['task-email-settings'], queryFn: async () => {
    const { data, error } = await supabase!.rpc('task_email_settings')
    if (error) throw error
    return data as EmailSettings
  }, refetchInterval: 30_000 })
  const connection = useQuery({ queryKey: ['mail-connection'], queryFn: () => edge('send-email', { action: 'config' }) })
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const start = Number(form.get('start')), end = Number(form.get('end'))
    if (start > end) { setError('종료 시각은 시작 시각보다 빠를 수 없습니다.'); return }
    if (!navigator.onLine) { setError('인터넷 연결 후 다시 시도하세요.'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase!.rpc('task_email_settings', { p_enabled: form.has('enabled'), p_start_hour: start, p_end_hour: end })
      if (error) throw error
      client.setQueryData(['task-email-settings'], data)
      setMessage('메일 발송 시간 설정을 저장했습니다.')
    } catch { setError('메일 설정을 저장하지 못했습니다. 연결과 관리자 권한을 확인하세요.') }
    finally { setBusy(false) }
  }
  if (settings.isPending) return <p className="empty">설정을 불러오는 중…</p>
  if (settings.isError) return <div role="alert" className="panel p-5">관리자 설정을 불러오지 못했습니다.<Button variant="outline" onClick={() => settings.refetch()}>다시 불러오기</Button></div>
  const config = settings.data
  return <section className="panel max-w-2xl p-6">
    <h2 className="text-lg font-semibold">태스크 할당 메일</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">새로 지정된 담당자에게 매일 1시간마다 태스크를 모아서 보냅니다. 발송 시간 밖에 할당된 태스크는 다음 시작 시각에 전달됩니다.</p>
    <div className="my-5 rounded-lg bg-muted p-3 text-sm">{connection.isPending ? '발신 계정 확인 중…' : connection.isError ? '발송 서버 연결을 확인하지 못했습니다.' : connection.data?.configured ? `발신 주소: ${connection.data.from}` : '발신 계정 연결이 필요합니다. 연결 전에는 메일을 보내지 않고 대기열에 보관합니다.'}<Button className="ml-2" size="sm" variant="ghost" onClick={() => connection.refetch()}>연결 다시 확인</Button></div>
    <form onSubmit={save}><fieldset disabled={busy} className="form-stack">
      <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={config.enabled} />태스크 할당 메일 자동 발송</label>
      <div className="grid grid-cols-2 gap-4">{[['start', '첫 발송 시각', config.start_hour], ['end', '마지막 발송 시각', config.end_hour]].map(([name, label, value]) => <label key={name}>{label}<select name={String(name)} defaultValue={value}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>)}</div>
      <p className="caption">한국시간(Asia/Seoul) 기준 · 첫 시각과 마지막 시각을 포함해 매 정각 발송 · 주말 포함<br />자동 발송을 끄면 대기 중인 알림은 보관되며, 다시 켠 뒤 발송 시간에 전달됩니다.</p>
      <Button type="submit">{busy ? '저장 중…' : '메일 설정 저장'}</Button>
    </fieldset></form>
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-primary">{message}</p>}
    <div className="mt-6 border-t pt-4 text-sm leading-7"><p>대기 중인 태스크 알림: {config.stats.pending}건</p>{config.stats.missing_email > 0 && <p>이 중 수신 이메일 미등록: {config.stats.missing_email}건 — 연구원 메뉴에서 이메일을 등록해 주세요.</p>}{config.stats.failed > 0 && <p>발송 실패: {config.stats.failed}건 — 발신 계정과 수신 주소를 확인해 주세요.</p>}{config.stats.unknown > 0 && <p>처리 중 또는 결과 확인 필요: {config.stats.unknown}건 — 중복 발송을 막기 위해 자동 재전송하지 않습니다.</p>}</div>
  </section>
}
