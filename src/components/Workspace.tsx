import { canWorkOnTask, canManage, roleNames } from '@/lib/types'
import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Archive, ArrowUpRight, Bell, Check, ChevronRight, Columns3, FolderKanban, LogOut, Megaphone, MessageSquare, Plus, RefreshCw, Settings2, Users, WifiOff, X, Pin, Mail, RotateCcw } from 'lucide-react'
import { Button } from './ui/button'
import { Board } from './Board'
import { Settings } from './Settings'
import { ActivityReport } from './ActivityReport'
import { AppVersion } from './AppVersion'
import { ProjectList } from './ProjectList'
import { Forms, type Editor } from './Forms'
import { action, edge, loadBoard, supabase } from '@/lib/api'
import type { BoardData, Member, Notice, Task } from '@/lib/types'
import { cn, dateLabel } from '@/lib/utils'
import { Brand } from '@/App'
import { taskSeenThrough, unreadTaskIds } from '@/lib/taskUnread'

type Page = 'board' | 'notices' | 'progress' | 'archive' | 'members' | 'notifications' | 'settings' | 'reports'
const pages = [{ id: 'board', label: '프로젝트 보드', icon: Columns3 }, { id: 'notices', label: '전달사항', icon: Megaphone }, { id: 'progress', label: '진행상황 요청', icon: MessageSquare }, { id: 'archive', label: '완료 보관함', icon: Archive }, { id: 'members', label: '연구원', icon: Users }, { id: 'reports', label: '수행 내역', icon: Archive }, { id: 'settings', label: '설정', icon: Settings2 }] as const
const empty: BoardData = { members: [], projects: [], tasks: [], notices: [], receipts: [], progress: [], notifications: [], taskReads: [], comments: [] }
export default function Workspace({ me, theme, onLeave }: { me: Member; theme: ReactNode; onLeave: () => Promise<void> }) {
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const requestedPage = (params.get('page') ?? 'board') as Page
  const page = ['settings', 'reports'].includes(requestedPage) && !canManage(me.role) ? 'board' : requestedPage
  const query = useQuery({ queryKey: ['board', me.id, me.role], queryFn: loadBoard, refetchInterval: 30_000 })
  const data = query.data ?? empty
  const project = data.projects.find(p => p.id === params.get('project')) ?? data.projects.find(p => p.status === 'active')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [live, setLive] = useState(false)
  const [update, setUpdate] = useState(false)
  const [archiveSearch, setArchiveSearch] = useState('')
  const [selectedNotice, setSelectedNotice] = useState<string | null>(null)
  const [noticeBox, setNoticeBox] = useState<'received' | 'sent'>('received')
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 3000)
    return () => window.clearTimeout(timer)
  }, [message])
  useEffect(() => {
    if (query.data && editor?.kind === 'task' && editor.task && !query.data.tasks.some(t => t.id === editor.task!.id)) setEditor(null)
    if (query.data && editor?.kind === 'progress' && !query.data.progress.some(r => r.id === editor.request.id)) setEditor(null)
  }, [query.data, editor])
  useEffect(() => {
    const network = () => { setOnline(navigator.onLine); if (navigator.onLine) client.invalidateQueries() }
    const ready = () => setUpdate(true)
    window.addEventListener('online', network); window.addEventListener('offline', network); window.addEventListener('app-update-ready', ready)
    const channel = supabase!.channel(`board-${me.id}`).on('postgres_changes', { event: '*', schema: 'public' }, () => { client.invalidateQueries({ queryKey: ['board', me.id] }); client.invalidateQueries({ queryKey: ['member'] }) }).subscribe(status => setLive(status === 'SUBSCRIBED'))
    return () => { window.removeEventListener('online', network); window.removeEventListener('offline', network); window.removeEventListener('app-update-ready', ready); void supabase!.removeChannel(channel) }
  }, [client, me.id])
  async function run(name: string, payload: object = {}) {
    if (busy) return false
    if (!online) { setError('오프라인에서는 변경할 수 없습니다.'); return false }
    setBusy(true); setError(''); setMessage('')
    try {
      if (name === 'manage_member') await edge('manage-member', payload)
      else await action(name, payload)
      if (name === 'change_pin') { await onLeave(); return true }
      await client.invalidateQueries({ queryKey: ['board', me.id] })
      if (name === 'create_notice') { setNoticeBox('sent'); setSelectedNotice(null) }
      if (name === 'manage_member') await client.invalidateQueries({ queryKey: ['member'] })
      if (name !== 'read_notice' && name !== 'read_notification') setMessage(name === 'request_progress' ? '담당자에게 공유 요청을 보냈습니다.' : '저장했습니다.')
      return true
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했습니다. 다시 시도하세요.'); await client.invalidateQueries({ queryKey: ['board', me.id] }); return false }
    finally { setBusy(false) }
  }
  async function markSeen(payload: { p_task: string; p_seen_at: string }) {
    if (!online) return
    try { await action('mark_seen', payload); await client.invalidateQueries({ queryKey: ['board', me.id] }) }
    catch { setError('확인 상태를 저장하지 못했습니다. 연결 후 항목을 다시 열어 주세요.') }
  }
  function navigate(next: Page, projectId?: string) {
    setParams({ page: next, ...(projectId ? { project: projectId } : params.get('project') ? { project: params.get('project')! } : {}) }); setSelectedNotice(null)
  }
  function openTask(task: Task) { setEditor({ kind: 'task', task }); if (unreadTasks.has(task.id)) void markSeen({ p_task: task.id, p_seen_at: taskSeenThrough(task, data.comments) }) }
  const name = (id: string | null) => data.members.find(m => m.id === id)?.display_name ?? '미지정'
  const recipients = (notice: Notice) => notice.is_broadcast ? '전체 연구원' : data.receipts.filter(r => r.notice_id === notice.id).map(r => name(r.recipient_member_id)).join(', ') || '수신자 없음'
  const unread = data.notifications.filter(n => !n.read_at).length
  const unreadTasks = unreadTaskIds(data.tasks, data.taskReads, data.comments, me.id)
  const receivedNotices = data.notices.filter(n => n.author_member_id !== me.id && (n.is_broadcast || data.receipts.some(r => r.notice_id === n.id && r.recipient_member_id === me.id)))
  const sentNotices = data.notices.filter(n => n.author_member_id === me.id)
  const visibleNotices = noticeBox === 'received' ? receivedNotices : sentNotices
  const emptyNoticeMessage = noticeBox === 'received' ? '받은 전달사항이 없습니다.' : '보낸 전달사항이 없습니다.'
  const unreadNotices = receivedNotices.filter(n => !data.receipts.some(r => r.notice_id === n.id && r.recipient_member_id === me.id && r.read_at)).length
  const projectUnreadCounts = Object.fromEntries(data.projects.map(p => [p.id, data.tasks.filter(t => t.project_id === p.id && unreadTasks.has(t.id)).length]))
  const boardUnread = unreadTasks.size
  const tasks = data.tasks.filter(t => t.project_id === project?.id && !t.archived_at && !t.deleted_at)
  async function openNotice(notice: Notice) { setNoticeBox(notice.author_member_id === me.id ? 'sent' : 'received'); setSelectedNotice(notice.id); const receipt = data.receipts.find(r => r.notice_id === notice.id && r.recipient_member_id === me.id); if (notice.author_member_id !== me.id && !receipt?.read_at && online && (notice.is_broadcast || receipt)) await run('read_notice', { id: notice.id }) }
  const activeNotice = visibleNotices.find(n => n.id === selectedNotice)
  return <div className="min-h-dvh lg:flex"><aside className="z-20 flex shrink-0 flex-col border-b bg-card lg:fixed lg:inset-y-0 lg:w-64 lg:border-b-0 lg:border-r"><div className="p-5 lg:py-8"><Brand /></div><nav aria-label="주 메뉴" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col">{pages.filter(p => !['settings', 'reports'].includes(p.id) || canManage(me.role)).map(p => <button key={p.id} aria-label={p.label} onClick={() => navigate(p.id)} className={cn('flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors lg:min-h-9', page === p.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted')}><p.icon size={18} />{p.label}{((p.id === 'board' && boardUnread > 0) || (p.id === 'notices' && unreadNotices > 0)) && <span aria-hidden="true" title={p.id === 'board' ? `미확인 태스크 ${unreadTasks.size}개` : `미확인 전달사항 ${unreadNotices}개`} className="ml-auto rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{p.id === 'board' ? boardUnread : unreadNotices}</span>}{p.id === 'progress' && data.progress.some(r => r.assignee_member_id === me.id && !r.responded_at) && <span className="size-1.5 rounded-full bg-primary" />}</button>)}</nav><div className="hidden flex-1 overflow-y-auto px-4 pt-4 lg:block"><div className="mb-1 flex items-center justify-between"><p className="text-[11px] font-semibold tracking-widest text-muted-foreground">PROJECTS</p><Button size="icon" variant="ghost" aria-label="프로젝트 추가" onClick={() => setEditor({ kind: 'project' })}><Plus /></Button></div><ProjectList projects={data.projects} unreadCounts={projectUnreadCounts} selected={page === 'board' ? project?.id : undefined} canReorder={canManage(me.role)} disabled={busy || !online} onSelect={id => navigate('board', id)} onReorder={(ids, previous) => { void run('reorder_projects', { p_ids: ids, p_previous: previous }) }} /></div><div className="hidden items-center gap-3 border-t p-5 lg:flex"><span className="grid size-9 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{me.display_name.slice(-2)}</span><div className="flex-1"><p className="text-sm font-medium">{me.display_name}</p><p className="caption">{roleNames[me.role]}</p></div><Button variant="ghost" size="icon" aria-label="로그아웃" onClick={async () => { try { await action('logout') } finally { await onLeave() } }}><LogOut /></Button></div></aside>
    <div className="min-w-0 flex-1 lg:ml-64"><header className="flex h-15 items-center gap-3 border-b bg-card/80 px-5 md:px-9"><span className="hidden text-sm text-muted-foreground sm:block">Workspace</span><ChevronRight size={14} className="hidden text-muted-foreground sm:block" /><span className="text-sm font-medium">{pages.find(p => p.id === page)?.label ?? '알림'}</span><div className="ml-auto flex items-center gap-1"><span className="mr-3 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex"><span className={cn('size-1.5 rounded-full', online && live ? 'bg-emerald-500' : 'bg-amber-500')} />{!online ? '오프라인' : live ? '실시간 연결됨' : '연결 확인 중'}</span>{theme}<Button variant="ghost" disabled={!online || busy} onClick={() => { setError(''); setEditor({ kind: 'pin' }) }}>내 PIN 변경</Button><Button variant="ghost" size="icon" className="relative" aria-label={`알림 ${unread}개`} onClick={() => navigate('notifications')}><Bell />{unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] text-primary-foreground">{unread}</span>}</Button><Button className="lg:hidden" variant="ghost" size="icon" aria-label="로그아웃" onClick={async () => { try { await action('logout') } finally { await onLeave() } }}><LogOut /></Button></div></header>
    <main className="mx-auto max-w-[1680px] px-5 pt-4 pb-[max(2rem,env(safe-area-inset-bottom))] md:px-9">
      {!online && <div role="status" className="mb-5 flex gap-2 rounded-xl bg-amber-100 p-3 text-sm text-amber-900"><WifiOff size={18} />오프라인입니다. 마지막으로 불러온 내용을 표시하며, 수정은 연결 후 가능합니다.</div>}
      {online && !live && <p className="mb-4 text-xs text-muted-foreground">실시간 연결을 다시 시도하고 있습니다. 30초마다 데이터를 갱신합니다.</p>}
      {(error || query.isError) && <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"><span>{error || '데이터를 불러오지 못했습니다. 서버 연결을 확인하세요.'}</span><Button variant="ghost" size="icon" aria-label="다시 불러오기" onClick={() => { setError(''); query.refetch() }}><RefreshCw /></Button></div>}
      {update && <div className="panel mb-5 flex items-center justify-between p-4 text-sm">새 버전이 있습니다. 입력 중인 내용을 저장하고 앱을 다시 열어 주세요.<Button variant="ghost" onClick={() => setUpdate(false)}>확인</Button></div>}
      {query.isPending ? <p className="empty">연구실 데이터를 불러오는 중…</p> : <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><p className="mb-1 text-[11px] font-semibold tracking-[.16em] text-muted-foreground">LAB WORKSPACE</p><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{page === 'board' ? project?.name ?? '프로젝트 보드' : page === 'notifications' ? '알림' : pages.find(p => p.id === page)?.label}</h1><p className="mt-1 text-sm text-muted-foreground">{page === 'board' ? project?.description || '연구의 다음 단계를 함께 정리해 보세요.' : page === 'notices' ? '놓치지 않아야 할 소식과 동료에게 전할 이야기.' : page === 'progress' ? '지금까지의 진행과 다음 계획을 공유합니다.' : page === 'archive' ? '완료 후 30일이 지난 업무를 안전하게 보관합니다.' : page === 'reports' ? '연구원별 주간·월간 완료 업무와 활동을 모아 봅니다.' : page === 'settings' ? '연구실 알림과 메일 발송 시간을 관리합니다.' : page === 'members' ? '함께 연구하는 동료들입니다.' : '나에게 도착한 새로운 소식을 확인하세요.'}</p></div><div className="flex gap-2">{page === 'board' && project && (canManage(me.role) || project.owner_member_id === me.id) && <Button variant="outline" size="icon" aria-label="프로젝트 설정" onClick={() => setEditor({ kind: 'project', project })}><Settings2 /></Button>}{page === 'board' && project?.status === 'active' && <Button disabled={!online || busy} onClick={() => setEditor({ kind: 'task' })}><Plus />새 태스크</Button>}{page === 'board' && <Button variant="outline" onClick={() => setEditor({ kind: 'project' })}><Plus />프로젝트</Button>}{page === 'notices' && <Button disabled={!online || busy} onClick={() => setEditor({ kind: 'notice' })}><Plus />전달사항 작성</Button>}{page === 'members' && canManage(me.role) && <Button disabled={!online || busy} onClick={() => setEditor({ kind: 'member' })}><Plus />연구원 추가</Button>}</div></div>
      {page === 'settings' && canManage(me.role) && <Settings />}
      {page === 'reports' && canManage(me.role) && <ActivityReport me={me} members={data.members} />}
      {page === 'board' && <><select aria-label="프로젝트 선택" className="mb-3 lg:hidden" value={project?.id ?? ''} onChange={e => navigate('board', e.target.value)}><option value="" disabled>프로젝트 선택</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.status === 'archived' ? ' (보관)' : ''}</option>)}</select>{project ? <>{project.status === 'archived' && <p className="panel mb-5 p-4 text-sm">보관된 프로젝트입니다. 소유자 또는 관리자·부관리자가 프로젝트 설정에서 복원할 수 있습니다.</p>}<Board me={me} tasks={tasks} unreadIds={unreadTasks} members={data.members} disabled={!online || busy || project.status === 'archived'} onOpen={openTask} onAdd={status => setEditor({ kind: 'task', status })} onMove={(task, status, position) => { void run('move_task', { id: task.id, revision: task.revision, status, position }) }} /></> : <div className="panel empty"><FolderKanban className="mx-auto mb-4 text-primary" size={32} /><p>첫 프로젝트를 만들어 연구를 시작하세요.</p>{!canManage(me.role) && <p className="mt-2">개인 프로젝트를 만들면 본인과 관리자·부관리자만 볼 수 있습니다.</p>}</div>}</>}
      {page === 'archive' && <><input className="mb-5 max-w-md" aria-label="보관된 태스크 검색" placeholder="보관된 태스크 검색…" value={archiveSearch} onChange={e => setArchiveSearch(e.target.value)} /><div className="space-y-3">{data.tasks.filter(t => (t.archived_at || t.deleted_at) && t.title.toLowerCase().includes(archiveSearch.toLowerCase())).map(t => <div className="panel flex flex-wrap items-center gap-4 p-5" key={t.id}><Archive size={19} className="text-muted-foreground" /><div className="min-w-0 flex-1"><p className="break-words font-medium">{t.title}</p><p className="caption mt-1">{data.projects.find(p => p.id === t.project_id)?.name} · {t.deleted_at ? '삭제된 태스크' : '완료 보관'} · {dateLabel(t.archived_at ?? t.deleted_at)}</p></div><Button disabled={busy || !online || !canWorkOnTask(t, me)} variant="outline" onClick={() => run('restore_task', { id: t.id, revision: t.revision })}><RotateCcw />복원</Button></div>)}{!data.tasks.some(t => (t.archived_at || t.deleted_at) && t.title.toLowerCase().includes(archiveSearch.toLowerCase())) && <div className="panel empty">보관된 태스크가 없습니다.</div>}</div></>}
      {page === 'notices' && <>
        <div role="group" aria-label="전달사항 분류" className="mb-5 flex flex-wrap gap-2">
          {([{ id: 'received', label: '받은 전달사항' }, { id: 'sent', label: '보낸 전달사항' }] as const).map(box => <Button key={box.id} aria-label={box.label} aria-pressed={noticeBox === box.id} variant={noticeBox === box.id ? 'default' : 'outline'} onClick={() => { setNoticeBox(box.id); setSelectedNotice(null) }}>{box.label}{box.id === 'received' && unreadNotices > 0 && <span aria-hidden="true" title={`미확인 ${unreadNotices}개`} className="rounded-full bg-background/20 px-1.5 text-xs">{unreadNotices}</span>}</Button>)}
        </div>
<div className="grid items-start gap-5 xl:grid-cols-[minmax(240px,1fr)_minmax(350px,1.4fr)]"><div className="space-y-2">{[...visibleNotices].sort((a, b) => Number(b.is_important) - Number(a.is_important) || b.created_at.localeCompare(a.created_at)).map(n => <button key={n.id} onClick={() => openNotice(n)} className={cn('panel w-full p-3 text-left', selectedNotice === n.id && 'border-primary')}><div className="mb-1 flex gap-2">{n.is_important && <span className="chip bg-primary/10 text-primary"><Pin size={11} />중요</span>}<span className="chip">{n.is_broadcast ? '전체 공지' : '개인 전달'}</span></div><h2 className="font-semibold">{n.title}</h2><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{n.content}</p><div className="caption mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"><span className="min-w-0 break-words">수신: {recipients(n)}</span><span>{name(n.author_member_id)} · {dateLabel(n.created_at)}</span></div></button>)}{visibleNotices.length === 0 && <div className="panel empty">{emptyNoticeMessage}</div>}</div>{activeNotice ? <section className="panel p-6"><h2 className="text-xl font-semibold">{activeNotice.title}</h2><p className="caption mt-2">{name(activeNotice.author_member_id)} · {dateLabel(activeNotice.created_at)}</p><p className="caption mt-2 break-words">수신: {recipients(activeNotice)}</p><p className="my-6 whitespace-pre-wrap break-words text-sm leading-7">{activeNotice.content}</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setEditor({ kind: 'mail', notice: activeNotice })}><Mail />메일 초안 작성</Button><Button variant="outline" disabled={!online || !data.projects.some(p => p.status === 'active')} onClick={() => setEditor({ kind: 'task', notice: activeNotice })}><ArrowUpRight />태스크 전환</Button>{(activeNotice.author_member_id !== me.id) && (activeNotice.is_broadcast || data.receipts.some(r => r.notice_id === activeNotice.id && r.recipient_member_id === me.id)) && <Button disabled={busy || !online || !!data.receipts.find(r => r.notice_id === activeNotice.id && r.recipient_member_id === me.id)?.confirmed_at} onClick={() => run('confirm_notice', { id: activeNotice.id })}><Check />확인 완료</Button>}</div><div className="mt-6 border-t pt-4"><p className="mb-3 text-xs font-semibold">수신 확인</p>{data.receipts.filter(r => r.notice_id === activeNotice.id).map(r => <p key={r.recipient_member_id} className="caption flex justify-between py-1.5"><span>{name(r.recipient_member_id)}</span><span>{r.confirmed_at ? '확인 완료' : r.read_at ? '읽음' : '아직 읽지 않음'}</span></p>)}</div></section> : <div className="panel empty hidden xl:block">전달사항을 선택해 내용을 확인하세요.</div>}</div></>}
      {page === 'progress' && <div className="space-y-4">{[...data.progress].sort((a, b) => b.requested_at.localeCompare(a.requested_at)).map(r => <article key={r.id} className="panel p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><span className={cn('chip mb-3', r.responded_at ? 'text-emerald-700 dark:text-emerald-300' : 'text-primary')}>{r.responded_at ? '응답 완료' : '응답 대기'}</span><h2 className="font-semibold">{data.tasks.find(t => t.id === r.task_id)?.title ?? '프로젝트 진행상황'}</h2><p className="caption mt-2">{data.projects.find(p => p.id === r.project_id)?.name} · {name(r.requester_member_id)} → {name(r.assignee_member_id)} · {dateLabel(r.requested_at)}</p></div>{!r.responded_at && r.assignee_member_id === me.id && <Button disabled={!online || busy} onClick={() => setEditor({ kind: 'progress', request: r })}>진행상황 작성</Button>}</div>{r.responded_at && <dl className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-2">{[['현재 진행 내용', r.current_work], ['문제점·지연 사유', r.blockers], ['다음 작업 계획', r.next_steps], ['예상 완료일', dateLabel(r.estimated_completion_date)]].map(([label, value]) => <div key={label}><dt className="caption mb-1">{label}</dt><dd className="whitespace-pre-wrap break-words text-sm leading-6">{value}</dd></div>)}</dl>}</article>)}{data.progress.length === 0 && <div className="panel empty">태스크 상세에서 담당자에게 진행상황 공유를 요청할 수 있습니다.</div>}</div>}
      {page === 'members' && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.members.map(m => <article key={m.id} className="panel p-6"><div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{m.display_name.slice(-2)}</span><div><h2 className="font-semibold">{m.display_name}</h2><p className="caption">{roleNames[m.role]}</p></div></div><p className="mt-5 text-sm text-muted-foreground">진행 중인 업무 {data.tasks.filter(t => t.assignee_member_ids.includes(m.id) && t.status !== 'done' && !t.deleted_at).length}개</p><p className="mt-3 break-all text-sm text-muted-foreground">{m.email || '이메일 미등록'}</p>{(canManage(me.role) || m.id === me.id) && <div className="mt-4 flex flex-wrap gap-2">{(canManage(me.role) || m.id === me.id) && <Button variant="outline" disabled={!online || busy} onClick={() => { setError(''); setEditor({ kind: 'email', member: m }) }}>이메일 수정</Button>}{canManage(me.role) && (me.role === 'admin' || m.role !== 'admin') && <Button variant="outline" disabled={!online || busy} onClick={() => setEditor({ kind: 'member', member: m })}>PIN 초기화</Button>}
        {me.role === 'admin' && m.role !== 'admin' && m.is_active && <Button variant="outline" disabled={!online || busy} onClick={() => { void run('set_member_role', { p_member: m.id, p_role: m.role === 'deputy' ? 'member' : 'deputy', p_expected_role: m.role }) }}>{m.role === 'deputy' ? '연구원으로 변경' : '부관리자로 승격'}</Button>}
</div>}</article>)}</div>}
      {page === 'notifications' && <div className="space-y-3">{[...data.notifications].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(n => <button key={n.id} className="panel flex w-full items-center gap-4 p-5 text-left" onClick={async () => { if (online) await run('read_notification', { id: n.id }); if (n.event_type === 'notice') { navigate('notices'); const notice = data.notices.find(x => x.id === n.related_id); if (notice) await openNotice(notice) } else navigate('progress') }}><span className={cn('size-2 rounded-full', n.read_at ? 'bg-muted' : 'bg-primary')} /><div className="flex-1"><p className="text-sm font-medium">{n.event_type === 'notice' ? '새 전달사항이 도착했습니다.' : n.event_type === 'progress_request' ? '진행상황 공유를 요청받았습니다.' : '요청한 진행상황 응답이 도착했습니다.'}</p><p className="caption mt-1">{dateLabel(n.created_at)}</p></div><ChevronRight size={16} /></button>)}{data.notifications.length === 0 && <div className="panel empty">새로운 알림이 없습니다.</div>}</div>}
      </>}
    </main><footer className="px-5 pb-4"><AppVersion /></footer></div>
    {message && <div role="status" className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex items-center gap-2 rounded-xl border bg-card py-1 pl-4 pr-1 text-sm text-primary shadow-lg sm:left-auto sm:max-w-sm"><Check size={16} className="shrink-0" />{message}<button className="ml-auto grid size-11 shrink-0 place-items-center" aria-label="메시지 닫기" onClick={() => setMessage('')}><X size={15} /></button></div>}
    {editor && <Forms editor={editor} project={project} data={data} me={me} busy={busy || !online} error={error} run={run} onClose={() => !busy && setEditor(null)} />}
  </div>
}
