import { useState } from 'react'
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable, closestCorners, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarDays, GripVertical, Plus, Search } from 'lucide-react'
import { Button } from './ui/button'
import { TaskComments } from './TaskComments'
import type { Run } from './Forms'
import { TaskDescription } from './TaskDescription'
import { canWorkOnTask, type BoardData, type Member, type Task } from '@/lib/types'
import { cn, dateLabel, insertionPosition, priorityNames, statusNames, today } from '@/lib/utils'

export function Board({ me, tasks, unreadIds, data, run, onRead, disabled, onOpen, onAdd, onMove }: { me: Member; tasks: Task[]; unreadIds: Set<string>; data: BoardData; run: Run; onRead: (t: Task) => void; disabled: boolean; onOpen: (t: Task) => void; onAdd: (status: Task['status']) => void; onMove: (t: Task, status: Task['status'], position: number) => void }) {
  const members = data.members
  const [search, setSearch] = useState('')
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState('')
  const [overdue, setOverdue] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const filtered = tasks.filter(t => t.title.toLowerCase().includes(search.toLowerCase()) && (!assignee || t.assignee_member_ids.includes(assignee)) && (!priority || t.priority === priority) && (!overdue || (t.due_date && t.due_date < today() && t.status !== 'done'))).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  function dragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || disabled) return
    const task = tasks.find(t => t.id === active.id)!
    const target = tasks.find(t => t.id === over.id)
    const status = target?.status ?? over.id as Task['status']
    const column = tasks.filter(t => t.status === status && t.id !== task.id).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    const targetIndex = target ? column.findIndex(t => t.id === target.id) : column.length
    const oldIndex = tasks.filter(t => t.status === task.status).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).findIndex(t => t.id === task.id)
    const index = task.status === status && oldIndex <= targetIndex && target ? targetIndex + 1 : targetIndex
    onMove(task, status, insertionPosition(column.map(t => t.position), index))
  }
  return <><div className="mb-4 flex flex-wrap items-center gap-3"><div className="relative min-w-48 flex-1 sm:max-w-xs"><Search className="absolute left-3 top-3.5 text-muted-foreground" size={17} /><input aria-label="태스크 검색" placeholder="태스크 검색…" value={search} onChange={e => setSearch(e.target.value)} className="!pl-10" /></div><select aria-label="담당자 필터" className="!w-auto" value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">모든 담당자</option>{members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select><select aria-label="우선순위 필터" className="!w-auto" value={priority} onChange={e => setPriority(e.target.value)}><option value="">모든 우선순위</option>{Object.entries(priorityNames).map(([v, name]) => <option key={v} value={v}>{name}</option>)}</select><label className="flex min-h-11 items-center gap-2 !font-normal"><input type="checkbox" checked={overdue} onChange={e => setOverdue(e.target.checked)} />마감 경과</label></div>
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={dragEnd}><div className="grid items-start gap-5 md:grid-cols-3">{(Object.keys(statusNames) as Task['status'][]).map(status => <Column me={me} key={status} status={status} unreadIds={unreadIds} tasks={filtered.filter(t => t.status === status)} data={data} run={run} onRead={onRead} disabled={disabled} onOpen={onOpen} onAdd={onAdd} />)}</div></DndContext>
  </>
}
function Column({ me, status, tasks, unreadIds, data, run, onRead, disabled, onOpen, onAdd }: { me: Member; status: Task['status']; tasks: Task[]; unreadIds: Set<string>; data: BoardData; run: Run; onRead: (t: Task) => void; disabled: boolean; onOpen: (t: Task) => void; onAdd: (status: Task['status']) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled })
  return <section ref={setNodeRef} className={cn('min-h-64 rounded-2xl bg-muted/55 p-3', isOver && 'ring-2 ring-primary/30')} aria-label={statusNames[status]}><div className="mb-1 flex items-center gap-2 px-1"><span className={cn('size-2 rounded-full', status === 'todo' ? 'bg-slate-400' : status === 'ongoing' ? 'bg-indigo-500' : 'bg-emerald-500')} /><h2 className="text-sm font-semibold">{statusNames[status]}</h2><span className="ml-1 rounded bg-card px-1.5 text-xs text-muted-foreground">{tasks.length}</span><Button className="ml-auto" variant="ghost" size="icon" aria-label={`${statusNames[status]} 태스크 추가`} onClick={() => onAdd(status)} disabled={disabled}><Plus /></Button></div><SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}><div className="space-y-2.5">{tasks.map(t => <Card key={t.id} task={t} unread={unreadIds.has(t.id)} data={data} me={me} run={run} onRead={onRead} disabled={disabled} otherAssignee={t.assignee_member_ids.length > 0 && !t.assignee_member_ids.includes(me.id)} onOpen={() => onOpen(t)} />)}</div></SortableContext>{tasks.length === 0 && <div className="my-4 rounded-xl border border-dashed p-8 text-center text-xs leading-6 text-muted-foreground">아직 태스크가 없습니다.<br />새 작업을 추가하거나 카드를 이동하세요.</div>}</section>
}
function Card({ task, otherAssignee, unread, data, me, run, onRead, disabled, onOpen }: { task: Task; otherAssignee: boolean; unread: boolean; data: BoardData; me: Member; run: Run; onRead: (t: Task) => void; disabled: boolean; onOpen: () => void }) {
  const members = data.members.filter(m => task.assignee_member_ids.includes(m.id))
  const dragDisabled = disabled || !canWorkOnTask(task, me)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: dragDisabled })
  const late = task.due_date && task.due_date < today() && task.status !== 'done'
  return <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('panel group p-3.5 shadow-[0_2px_4px_#10204004]', unread && 'border-primary ring-1 ring-primary/25', isDragging && 'z-10 opacity-40')}>
    <div className="flex items-start gap-1">
      <button onClick={onOpen} className="min-h-11 min-w-0 flex-1 text-left md:min-h-8">
        {unread && <span className="sr-only">미확인: </span>}<h3 className={cn('break-words text-base font-semibold leading-6', otherAssignee && 'text-muted-foreground')}>{task.priority !== 'normal' && <span className={cn('chip mr-2 align-middle', task.priority === 'urgent' ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300')}>{priorityNames[task.priority]}</span>}{task.title}</h3>
        {task.description && <div className="mt-1"><TaskDescription text={task.description} compact /></div>}
      </button>
      <button {...attributes} {...listeners} disabled={dragDisabled} aria-label={`${task.title} 이동`} className="-mr-2 -mt-2 grid size-11 shrink-0 touch-none place-items-center text-muted-foreground"><GripVertical size={16} /></button>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2"><span className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', late && 'text-red-600 dark:text-red-400')}><CalendarDays size={13} />{dateLabel(task.due_date)}</span><div aria-label="담당자" className="flex min-w-0 flex-wrap gap-2 text-xs">{members.length ? members.map(member => <span key={member.id} className="flex min-w-0 items-center gap-1.5"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">{member.display_name.slice(-2)}</span><span className="break-all">{member.display_name}</span></span>) : <span>{task.assignee_member_ids.length ? '등록된 담당자' : '전체 멤버'}</span>}</div></div>
    <TaskComments task={task} data={data} me={me} busy={disabled} run={run} collapsible onExpand={() => onRead(task)} />
  </article>
}
