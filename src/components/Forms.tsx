import { canManage, canWorkOnTask } from '@/lib/types'
import { useState, type FormEvent } from 'react'
import { Pencil, Send, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { Modal } from './ui/dialog'
import type { BoardData, Member, Notice, Progress, Project, Task } from '@/lib/types'
import { dateLabel, priorityNames, statusNames } from '@/lib/utils'
import { Mail } from './Mail'
import { TaskDescription, TaskDescriptionEditor } from './TaskDescription'
import { TaskComments } from './TaskComments'

export type Run = (action: string, payload?: object) => Promise<boolean>
export type Editor = { kind: 'task'; task?: Task; notice?: Notice; status?: Task['status'] } | { kind: 'project'; project?: Project } | { kind: 'notice' } | { kind: 'progress'; request: Progress } | { kind: 'mail'; notice: Notice } | { kind: 'member'; member?: Member } | { kind: 'pin' } | { kind: 'email'; member: Member }
export function Forms({ editor, project, data, me, busy, error, run, onClose }: { editor: Editor; project?: Project; data: BoardData; me: Member; busy: boolean; error: string; run: Run; onClose: () => void }) {
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [taskProject, setTaskProject] = useState(editor.kind === 'task' ? editor.task?.project_id ?? project?.id ?? data.projects.find(p => p.status === 'active')?.id ?? '' : '')
  const [taskAssignees, setTaskAssignees] = useState<string[]>(editor.kind === 'task' ? editor.task?.assignee_member_ids ?? [] : [])
  const selectedProject = data.projects.find(p => p.id === taskProject)
  const assignees = data.members.filter(m => m.is_active && m.role !== 'admin' && (m.role === 'deputy' || (selectedProject?.owner_member_id ? m.id === selectedProject.owner_member_id : selectedProject?.all_members || selectedProject?.member_ids?.includes(m.id))))
  async function submit(event: FormEvent<HTMLFormElement>, action: string, extra: object = {}) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (await run(action, { ...Object.fromEntries(form), ...extra })) onClose()
  }
  if (editor.kind === 'mail') return <Mail notice={editor.notice} author={me.display_name} recipients={data.members.filter(m => m.is_active && (editor.notice.is_broadcast || data.receipts.some(r => r.notice_id === editor.notice.id && r.recipient_member_id === m.id)))} onClose={onClose} />
  if (editor.kind === 'pin') return <PinForm busy={busy} error={error} run={run} onClose={onClose} />
  if (editor.kind === 'email') return <Modal title={`${editor.member.display_name} 이메일 수정`} description="수신용 연락처입니다. 같은 연구실의 로그인한 연구원이 볼 수 있으며, 비워 두면 등록된 주소가 삭제됩니다." error={error} onClose={onClose}><form onSubmit={e => submit(e, 'save_member_email', { p_member: editor.member.id })}><fieldset className="form-stack" disabled={busy}><label>이메일 주소<input autoFocus type="email" name="p_email" maxLength={254} autoComplete="email" defaultValue={editor.member.email ?? ''} placeholder="researcher@example.com" /></label><Button>이메일 저장</Button></fieldset></form></Modal>
  if (editor.kind === 'task') {
    const task = editingTask ?? editor.task
    const canEdit = task && (task.created_by === me.id || canManage(me.role))
    if (task && (!editingTask || !canEdit)) {
      const current = data.tasks.find(t => t.id === task.id) ?? task
      const archived = !!current.archived_at || !!current.deleted_at || data.projects.find(p => p.id === current.project_id)?.status === 'archived'
      return <Modal error={error} title={current.title} onClose={onClose} wide>
        <div className="mb-4 flex flex-wrap gap-2">
          {canEdit && <Button variant="outline" disabled={busy || archived} onClick={() => { setTaskProject(current.project_id); setTaskAssignees(current.assignee_member_ids); setEditingTask(current) }}><Pencil />편집</Button>}
          {current.assignee_member_ids.length > 0 && canWorkOnTask(current, me) && <Button variant="outline" disabled={busy || archived} onClick={() => { void run('request_progress', { task_id: current.id }) }}><Send />진행상황 공유 요청</Button>}
        </div>
        <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">{[
          ['프로젝트', data.projects.find(p => p.id === current.project_id)?.name],
          ['생성자', data.members.find(m => m.id === current.created_by)?.display_name],
          ['상태', statusNames[current.status]], ['우선순위', priorityNames[current.priority]],
          ['마감일', dateLabel(current.due_date)],
          ['담당자', current.assignee_member_ids.length ? current.assignee_member_ids.map(id => data.members.find(m => m.id === id)?.display_name ?? '연구원').join(', ') : '전체 멤버'],
        ].map(([label, value]) => <div key={label}><dt className="caption mb-1">{label}</dt><dd className="break-words">{value ?? '미등록'}</dd></div>)}</dl>
        <TaskDescription text={current.description || '설명이 없습니다.'} />
        <TaskComments task={current} data={data} me={me} busy={busy} run={run} />
      </Modal>
    }
    return <Modal error={error} title={task ? '태스크 편집' : editor.notice ? '전달사항을 태스크로 전환' : '새 태스크'} onClose={onClose} wide><form onSubmit={e => submit(e, 'save_task', { id: task?.id, revision: task?.revision, source_notice_id: editor.notice?.id, assignee_member_ids: taskAssignees })}><fieldset disabled={busy} className="form-stack">
      <label>프로젝트<select name="project_id" value={taskProject} onChange={e => setTaskProject(e.target.value)} required>{data.projects.filter(p => p.status === 'active' || p.id === task?.project_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>제목<input name="title" autoFocus required maxLength={200} defaultValue={task?.title ?? editor.notice?.title} placeholder="어떤 일을 해야 하나요?" /></label><TaskDescriptionEditor initialValue={task?.description ?? editor.notice?.content} />
      <div className="grid grid-cols-2 gap-4"><label>상태<select name="status" defaultValue={task?.status ?? editor.status ?? 'todo'}>{Object.entries(statusNames).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><label>우선순위<select name="priority" defaultValue={task?.priority ?? 'normal'}>{Object.entries(priorityNames).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><label>마감일<input type="date" name="due_date" defaultValue={task?.due_date ?? ''} /></label></div>
      <fieldset><legend className="mb-2 text-sm font-medium">담당자 (여러 명 선택 가능)</legend><div className="grid gap-2 sm:grid-cols-2">{[...assignees.map(m => ({ id: m.id, label: m.display_name, role: m.role })), ...taskAssignees.filter(id => !assignees.some(m => m.id === id)).map(id => ({ id, role: undefined, label: `${data.members.find(m => m.id === id)?.display_name ?? '기존 담당자'} (프로젝트 미할당·비활성)` }))].map(m => <label key={m.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={taskAssignees.includes(m.id)} onChange={e => setTaskAssignees(current => e.target.checked ? [...current, m.id] : current.filter(id => id !== m.id))} />{m.label}{m.role === 'deputy' && <span aria-hidden="true" className="chip bg-primary/10 text-primary">부관리자</span>}</label>)}</div></fieldset>
      {task?.source_notice_id && <p className="caption">전달사항에서 생성된 태스크입니다.</p>}
      <p className="caption">프로젝트 멤버는 모든 태스크를 볼 수 있습니다. 본인이 담당자가 아닌 업무는 제목이 회색으로 표시됩니다. 담당자를 선택하지 않으면 전체 멤버 업무입니다.</p>
      {task && <p className="caption">프로젝트를 바꾸고 저장하면 태스크와 연결된 진행상황 요청·응답도 함께 이동합니다.</p>}
      <div className="mt-2 flex justify-between gap-2">{task ? <Button type="button" variant="ghost" className="text-red-600" onClick={async () => { if (await run('delete_task', { id: task.id, revision: task.revision })) onClose() }}><Trash2 />삭제</Button> : <span />}<div className="flex gap-2"><Button type="button" variant="outline" onClick={() => task ? setEditingTask(null) : onClose()}>취소</Button><Button type="submit">{busy ? '저장 중…' : '저장'}</Button></div></div>{task && <p className="caption">삭제한 태스크는 관리자가 보관함에서 복원할 수 있습니다.</p>}
    </fieldset></form>{task && <TaskComments task={task} data={data} me={me} busy={busy} run={run} />}</Modal>
  }
  if (editor.kind === 'project') return <ProjectForm project={editor.project} me={me} data={data} busy={busy} error={error} run={run} onClose={onClose} />
  if (editor.kind === 'notice') return <NoticeForm data={data} busy={busy} error={error} run={run} onClose={onClose} />
  if (editor.kind === 'progress') return <Modal error={error} title="진행상황 공유" onClose={onClose}><form onSubmit={e => submit(e, 'respond_progress', { id: editor.request.id })}><fieldset className="form-stack" disabled={busy}><label>현재 진행 내용<textarea name="current_work" required maxLength={10000} /></label><label>문제점 또는 지연 사유<textarea name="blockers" required maxLength={10000} placeholder="문제가 없으면 ‘없음’으로 적어 주세요." /></label><label>다음 작업 계획<textarea name="next_steps" required maxLength={10000} /></label><label>예상 완료일<input name="estimated_completion_date" type="date" required /></label><Button>응답 전달</Button></fieldset></form></Modal>
  return <Modal error={error} title={editor.member ? `${editor.member.display_name} PIN 초기화` : '연구원 추가'} description={editor.member ? 'PIN을 초기화하면 해당 연구원의 기존 로그인 세션은 데이터에 접근할 수 없습니다.' : '연구원에게 이름과 PIN을 직접 전달해 주세요.'} onClose={onClose}><form onSubmit={e => submit(e, 'manage_member', { member_id: editor.member?.id })}><fieldset className="form-stack" disabled={busy}>{!editor.member && <label>연구원 이름<input name="name" required maxLength={50} autoComplete="off" /></label>}{!editor.member && <label>이메일 주소 (선택)<input type="email" name="email" maxLength={254} autoComplete="email" placeholder="researcher@example.com" /><span className="caption">수신용 연락처이며 같은 연구실 멤버에게 표시됩니다.</span></label>}<label>새 PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} required autoComplete="new-password" /></label><Button>{editor.member ? 'PIN 초기화' : '연구원 추가'}</Button>{editor.member?.id === me.id && <p className="caption">본인 PIN을 초기화하면 다시 로그인해야 합니다.</p>}</fieldset></form></Modal>
}
function ProjectForm({ project, me, data, busy, error, run, onClose }: { project?: Project; me: Member; data: BoardData; busy: boolean; error: string; run: Run; onClose: () => void }) {
  const privateProject = Boolean(project?.owner_member_id || (!project && !canManage(me.role)))
  const [allMembers, setAllMembers] = useState(project?.all_members ?? false)
  const members = data.members.filter(m => m.is_active && m.role !== 'admin')
  const [memberIds, setMemberIds] = useState(() => members.filter(m => project?.member_ids?.includes(m.id)).map(m => m.id))
  return <Modal error={error} title={project ? '프로젝트 설정' : '새 프로젝트'} onClose={onClose}><form onSubmit={async e => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    if (await run('save_project', { ...Object.fromEntries(form), id: project?.id, ...(privateProject ? {} : { all_members: allMembers, member_ids: memberIds }) })) onClose()
  }}><fieldset disabled={busy} className="form-stack">
    <label>프로젝트 이름<input name="name" autoFocus required maxLength={100} defaultValue={project?.name} /></label>
    <label>설명<textarea name="description" maxLength={5000} defaultValue={project?.description} /></label>
    <label>색상<input type="color" name="color" defaultValue={project?.color ?? '#6366f1'} className="mt-2 h-11 w-full rounded-lg" /></label>
    {project && <label>상태<select name="status" defaultValue={project.status}><option value="active">활성</option><option value="archived">보관</option></select></label>}
    {privateProject ? <p className="caption">개인 프로젝트입니다. 소유자({data.members.find(m => m.id === (project?.owner_member_id ?? me.id))?.display_name ?? '본인'})와 관리자·부관리자만 접근할 수 있습니다.</p> : <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">할당 멤버</legend><p className="caption">선택한 연구원에게 프로젝트가 표시됩니다. 관리자·부관리자는 선택 여부와 관계없이 접근할 수 있습니다.</p>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={allMembers} onChange={e => setAllMembers(e.target.checked)} />All (전체 연구원)</label>
      <p className="caption">All을 선택하면 앞으로 추가되는 연구원도 자동으로 포함됩니다.</p>
      {members.map(m => <label key={m.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={allMembers} checked={allMembers || memberIds.includes(m.id)} onChange={e => setMemberIds(current => e.target.checked ? [...current, m.id] : current.filter(id => id !== m.id))} />{m.display_name}{m.role === 'deputy' && <span aria-hidden="true" className="chip bg-primary/10 text-primary">부관리자</span>}</label>)}
      <p className="caption">All을 해제하면 개별 선택한 멤버만 포함됩니다. 아무도 선택하지 않으면 관리자·부관리자만 볼 수 있습니다. 멤버를 제외해도 기존 업무는 삭제되지 않습니다.</p>
    </fieldset>}<Button>프로젝트 저장</Button>
  </fieldset></form></Modal>
}
function PinForm({ busy, error, run, onClose }: { busy: boolean; error: string; run: Run; onClose: () => void }) {
  const [validation, setValidation] = useState('')
  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    if (form.get('new_pin') !== form.get('confirm_pin')) { setValidation('새 PIN과 확인 PIN이 일치하지 않습니다.'); return }
    if (form.get('current_pin') === form.get('new_pin')) { setValidation('현재 PIN과 다른 새 PIN을 입력하세요.'); return }
    setValidation('')
    await run('change_pin', { p_current_pin: form.get('current_pin'), p_new_pin: form.get('new_pin') })
  }
  return <Modal title="내 PIN 변경" description="변경하면 이 기기를 포함한 모든 기기에서 새 PIN으로 다시 로그인해야 합니다." error={validation || error} onClose={onClose}>
    <form onSubmit={change} onChange={() => setValidation('')}><fieldset className="form-stack" disabled={busy}>
      <label>현재 PIN<input name="current_pin" autoFocus type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} required autoComplete="current-password" /></label>
      <label>새 PIN<input name="new_pin" type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} required autoComplete="new-password" /></label>
      <label>새 PIN 확인<input name="confirm_pin" type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} required autoComplete="new-password" /></label>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>취소</Button><Button type="submit">{busy ? '변경 중…' : 'PIN 변경'}</Button></div>
    </fieldset></form>
  </Modal>
}
function NoticeForm({ data, busy, error, run, onClose }: { data: BoardData; busy: boolean; error: string; run: Run; onClose: () => void }) {
  const [broadcast, setBroadcast] = useState(true)
  const [recipients, setRecipients] = useState<string[]>([])
  return <Modal error={error} title="새 전달사항" onClose={onClose}><form onSubmit={async e => {
    e.preventDefault()
    if (!broadcast && recipients.length === 0) return
    const form = new FormData(e.currentTarget)
    if (await run('create_notice', { title: form.get('title'), content: form.get('content'), is_important: form.has('important'), is_broadcast: broadcast, recipients: broadcast ? [] : recipients })) onClose()
  }}><fieldset disabled={busy} className="form-stack">
    <label>제목<input name="title" required maxLength={200} autoFocus /></label>
    <label>내용<textarea name="content" required maxLength={20000} /></label>
    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="important" />중요 전달사항으로 상단 고정</label>
    <fieldset><legend className="mb-2 text-sm font-medium">수신 대상</legend>
      <label className="mb-2 flex min-h-11 items-center gap-2"><input type="checkbox" checked={broadcast} onChange={e => setBroadcast(e.target.checked)} />All (전체 연구원)</label>
      <div className="grid grid-cols-2 gap-2">{data.members.filter(m => m.is_active).map(m => <label key={m.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={broadcast} checked={broadcast || recipients.includes(m.id)} onChange={e => setRecipients(current => e.target.checked ? [...current, m.id] : current.filter(id => id !== m.id))} />{m.display_name}</label>)}</div>
      {!broadcast && recipients.length === 0 && <p className="caption mt-2">수신할 연구원을 한 명 이상 선택하세요.</p>}
    </fieldset>
    <Button disabled={!broadcast && recipients.length === 0}>전달사항 등록</Button>
  </fieldset></form></Modal>
}
