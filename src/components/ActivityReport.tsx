import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, RefreshCw, Printer, FileText } from 'lucide-react'
import { supabase } from '@/lib/api'
import { roleNames, type Member } from '@/lib/types'
import { Button } from './ui/button'
import { TaskDescription } from './TaskDescription'

type Entry = { kind: 'completed' | 'comment' | 'response'; id: string; member_id: string | null; task_id: string | null; task_title: string; project_name: string; occurred_at: string; content: string; blockers?: string; next_steps?: string; estimated_completion_date?: string }
type Report = { start_date: string; end_date: string; members: Pick<Member, 'id' | 'display_name' | 'role' | 'is_active'>[]; entries: Entry[] }
const labels = { completed: '완료 업무', comment: '댓글', response: '진행상황 응답' }
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export function ActivityReport({ me, members }: { me: Member; members: Member[] }) {
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const [anchor, setAnchor] = useState(today)
  const [member, setMember] = useState('')
  const [detail, setDetail] = useState<Report | null>(null)
  const report = useQuery({ queryKey: ['activity-report', me.id, me.role, period, anchor, member], enabled: !!anchor, queryFn: async () => {
    const { data, error } = await supabase!.rpc('member_activity_report', { p_period: period, p_anchor: anchor, p_member: member || null })
    if (error) throw error
    return data as Report
  }, refetchInterval: detail ? false : 30_000 })
  function shift(direction: number) {
    const date = new Date(`${anchor}T00:00:00Z`)
    if (period === 'week') date.setUTCDate(date.getUTCDate() + direction * 7)
    else { date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + direction) }
    setAnchor(date.toISOString().slice(0, 10))
  }
  const result = report.isError ? undefined : report.data
  const groups = result ? [...result.members.map(m => ({ id: m.id as string | null, name: m.display_name, caption: `${roleNames[m.role]}${m.is_active ? '' : ' · 비활성'}` })), ...(!member && result.entries.some(e => e.member_id === null) ? [{ id: null, name: '담당자 미지정', caption: '개인 실적에 포함하지 않은 완료 업무' }] : [])] : []
  if (detail && !report.isError) return <section aria-label="수행 내역 상세 레포트" className="space-y-4">
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setDetail(null)}><ChevronLeft />목록으로</Button><Button onClick={() => window.print()}><Printer />인쇄 / PDF 저장</Button></div>
    <ReportDocument report={detail} period={period} />
  </section>
  return <section aria-label="연구원별 수행 내역" className="space-y-4">
    <div className="panel flex flex-wrap items-end gap-3 p-3">
      <label className="text-sm">집계 기간<select value={period} onChange={e => setPeriod(e.target.value as 'week' | 'month')}><option value="week">주간</option><option value="month">월간</option></select></label>
      <label className="text-sm">기준 날짜<input type="date" value={anchor} onChange={e => setAnchor(e.target.value)} /></label>
      <label className="min-w-40 text-sm">연구원 선택<select value={member} onChange={e => setMember(e.target.value)}><option value="">전체 연구원</option>{members.map(m => <option key={m.id} value={m.id}>{m.display_name} · {roleNames[m.role]}{m.is_active ? '' : ' (비활성)'}</option>)}</select></label>
      <div className="flex gap-1"><Button variant="outline" size="icon" aria-label="이전 기간" disabled={!anchor} onClick={() => shift(-1)}><ChevronLeft /></Button><Button variant="outline" onClick={() => setAnchor(today())}>오늘</Button><Button variant="outline" size="icon" aria-label="다음 기간" disabled={!anchor} onClick={() => shift(1)}><ChevronRight /></Button><Button variant="ghost" size="icon" aria-label="수행 내역 새로고침" disabled={!anchor || report.isFetching} onClick={() => report.refetch()}><RefreshCw /></Button></div>
    </div>
    <p className="caption">한국시간 기준 · 주간 월~일 / 월간 1일~말일. 완료 업무는 현재 Done 상태와 현재 담당자 기준이며, 공동 업무는 각 담당자에게 표시합니다. 보관된 업무는 포함하고 삭제된 업무·댓글은 제외합니다. 재진행하거나 담당자를 바꾸면 과거 집계도 달라집니다.</p>
    {!anchor ? <p className="empty">기준 날짜를 선택하세요.</p> : report.isPending ? <p role="status" className="empty">수행 내역을 불러오는 중…</p> : report.isError ? <p role="alert" className="panel p-4">수행 내역을 불러오지 못했습니다. 연결과 관리자 권한을 확인하고 새로고침해 주세요.</p> : result && <>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{result.start_date} ~ {result.end_date}</h2><Button variant="outline" onClick={() => setDetail(result)}><FileText />상세 레포트</Button></div>
      {!result.entries.length && <p className="panel p-4 text-sm text-muted-foreground">선택한 기간에 수행 내역이 없습니다.</p>}
      <div className="grid items-start gap-4 xl:grid-cols-2">{groups.map(group => {
        const entries = result.entries.filter(e => e.member_id === group.id)
        return <article key={group.id ?? 'unassigned'} className="panel min-w-0 p-4">
          <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{group.name}</h3><Button size="sm" variant="ghost" onClick={() => setDetail({ ...result, members: result.members.filter(m => m.id === group.id), entries })}>상세 보기</Button></div><p className="caption mt-1">{group.caption}</p>
          <div className="my-3 flex flex-wrap gap-2">{(Object.keys(labels) as Entry['kind'][]).map(kind => <span key={kind} className="rounded-lg bg-muted px-2 py-1 text-xs">{labels[kind]} {entries.filter(e => e.kind === kind).length}건</span>)}</div>
          {!entries.length ? <p className="caption">이 기간의 수행 내역이 없습니다.</p> : <ul className="divide-y">{entries.map(entry => <li key={`${entry.kind}-${entry.id}`} className="py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span className="font-medium text-primary">{labels[entry.kind]}</span><time dateTime={entry.occurred_at}>{new Date(entry.occurred_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time><span className="break-all">{entry.project_name}</span></div>
            <p className="mt-1 break-words text-sm font-medium">{entry.task_title}</p>
            <details className="mt-2 text-sm"><summary className="cursor-pointer text-muted-foreground">내용 보기</summary><EntryContent entry={entry} /></details>
          </li>)}</ul>}
        </article>
      })}</div>
    </>}
  </section>
}

function EntryContent({ entry }: { entry: Entry }) {
  return <div className="mt-2 space-y-2 text-sm leading-6">
    {entry.kind === 'completed' ? <TaskDescription text={entry.content || '설명이 없습니다.'} /> : <p className="whitespace-pre-wrap break-words">{entry.content || '내용이 없습니다.'}</p>}
    {entry.kind === 'response' && <><p className="whitespace-pre-wrap break-words"><strong>문제점·지연 사유:</strong> {entry.blockers || '미기재'}</p><p className="whitespace-pre-wrap break-words"><strong>다음 계획:</strong> {entry.next_steps || '미기재'}</p><p><strong>예상 완료일:</strong> {entry.estimated_completion_date || '미정'}</p></>}
  </div>
}

function ReportDocument({ report, period }: { report: Report; period: 'week' | 'month' }) {
  const groups = [...report.members.map(m => ({ id: m.id as string | null, name: m.display_name, role: roleNames[m.role] })), ...(report.entries.some(e => e.member_id === null) ? [{ id: null, name: '담당자 미지정', role: '개인 실적에서 제외' }] : [])]
  const completedCount = new Set(report.entries.filter(e => e.kind === 'completed').map(e => e.id)).size
  return <article id="activity-report-document" className="mx-auto max-w-4xl rounded-xl border bg-card p-5 sm:p-9">
    <header className="border-b pb-5"><p className="caption mb-2">LAB PROJECT BOARD · 연구 수행 보고서</p><h2 className="text-2xl font-semibold">{period === 'week' ? '주간' : '월간'} 수행 내역 레포트</h2><p className="mt-3 text-sm">보고 기간: {report.start_date} ~ {report.end_date} (한국시간)</p><p className="mt-1 break-words text-sm">대상: {groups.map(g => g.name).join(', ') || '해당 연구원 없음'}</p></header>
    <section className="border-b py-5"><h3 className="font-semibold">1. 수행 요약</h3><p className="mt-2 text-sm leading-7">완료 업무 {completedCount}건 · 댓글 {report.entries.filter(e => e.kind === 'comment').length}건 · 진행상황 응답 {report.entries.filter(e => e.kind === 'response').length}건</p><p className="caption">전체 완료 업무 건수는 공동 담당 업무를 중복 없이 계산합니다. 아래 연구원별 내역에는 각 담당자에게 함께 표시합니다.</p></section>
    <section className="py-5"><h3 className="mb-4 font-semibold">2. 연구원별 업무 상세</h3>{groups.map(group => {
      const entries = report.entries.filter(e => e.member_id === group.id)
      const tasks = [...new Set(entries.map(e => e.task_id ?? `response-${e.id}`))]
      return <section key={group.id ?? 'unassigned'} className="mb-7 border-t pt-4" aria-label={`${group.name} 업무 상세`}>
        <h4 className="text-lg font-semibold">{group.name} <span className="text-sm font-normal text-muted-foreground">{group.role}</span></h4>
        <p className="caption mt-1">완료 업무 {entries.filter(e => e.kind === 'completed').length}건 · 댓글 {entries.filter(e => e.kind === 'comment').length}건 · 진행상황 응답 {entries.filter(e => e.kind === 'response').length}건</p>
        {!tasks.length && <p className="mt-3 text-sm text-muted-foreground">이 기간에 기록된 수행 내역이 없습니다.</p>}
        {tasks.map((taskId, index) => {
          const records = entries.filter(e => (e.task_id ?? `response-${e.id}`) === taskId)
          const task = records.find(e => e.kind === 'completed') ?? records[0]
          return <section key={taskId} className="report-task mt-5 border-l-2 pl-4">
            <h5 className="break-words font-semibold">{index + 1}. {task.task_title}</h5><p className="caption mt-1">프로젝트: {task.project_name}{!records.some(e => e.kind === 'completed') ? ' · 기간 내 활동 기록 (완료 집계 아님)' : ''}</p>
            {records.map(entry => <section key={`${entry.kind}-${entry.id}`} className="mt-4">
              <h6 className="text-sm font-semibold">{labels[entry.kind]} <time className="font-normal text-muted-foreground" dateTime={entry.occurred_at}>{new Date(entry.occurred_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></h6>
              <EntryContent entry={entry} />
            </section>)}
          </section>
        })}
      </section>
    })}</section>
    <footer className="border-t pt-4 text-xs leading-6 text-muted-foreground">기록된 업무·댓글·응답을 정리한 레포트입니다. 실제 투입 시간이나 미기록 업무는 포함하지 않습니다. 완료 업무는 현재 Done 상태·현재 담당자·완료일 기준이며, 담당자 변경·재진행·삭제 시 과거 집계가 달라질 수 있습니다. 보관된 업무는 포함하고 삭제된 업무·댓글은 제외합니다.</footer>
  </article>
}
