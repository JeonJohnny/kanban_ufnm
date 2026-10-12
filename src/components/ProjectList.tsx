import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Archive, GripVertical } from 'lucide-react'
import type { Project } from '@/lib/types'
import { cn } from '@/lib/utils'

export function ProjectList({ projects, unreadCounts, selected, canReorder, disabled, onSelect, onReorder }: {
  projects: Project[]; unreadCounts: Record<string, number>; selected?: string; canReorder: boolean; disabled: boolean;
  onSelect: (id: string) => void; onReorder: (ids: string[], previous: string[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  function move({ active, over }: DragEndEvent) {
    if (!canReorder || disabled || !over || active.id === over.id) return
    const ids = projects.map(p => p.id)
    const from = ids.indexOf(String(active.id)), to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove(ids, from, to), ids)
  }
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={move}>
    <SortableContext items={projects.map(p => p.id)} strategy={verticalListSortingStrategy}>
      <div role="list" aria-label="프로젝트 목록" className="space-y-0.5">{projects.map(p => <ProjectRow key={p.id} project={p} unread={unreadCounts[p.id] ?? 0} selected={selected === p.id} canReorder={canReorder} disabled={disabled} onSelect={() => onSelect(p.id)} />)}</div>
    </SortableContext>
  </DndContext>
}
function ProjectRow({ project, unread, selected, canReorder, disabled, onSelect }: { project: Project; unread: number; selected: boolean; canReorder: boolean; disabled: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id, disabled: disabled || !canReorder })
  return <div role="listitem" ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('flex items-center rounded-lg', selected ? 'bg-muted' : 'text-muted-foreground hover:bg-muted/50', isDragging && 'relative z-10 bg-muted shadow-sm')}>
    <button onClick={onSelect} title={project.name} aria-current={selected ? 'page' : undefined} className="flex min-h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left text-sm font-medium"><span className="size-2 shrink-0 rounded-sm" style={{ background: project.color }} /><span className="truncate">{project.name}</span>{unread > 0 && <span aria-hidden="true" title="미확인 태스크" className="ml-auto rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">{unread}</span>}{project.status === 'archived' && <Archive size={12} className="shrink-0" />}</button>
    {canReorder && <button {...attributes} {...listeners} disabled={disabled} aria-label={`${project.name} 순서 이동`} title="드래그하거나 Space → 방향키 → Space로 순서 변경" className="mr-1 grid size-7 shrink-0 touch-none place-items-center rounded text-muted-foreground hover:bg-card disabled:opacity-40"><GripVertical size={14} /></button>}
  </div>
}
