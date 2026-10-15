import { useId, useState } from 'react'
import { ChevronDown, ChevronUp, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { canManage, type BoardData, type Member, type Task } from '@/lib/types'
import { Button } from './ui/button'
import type { Run } from './Forms'

export function TaskComments({ task, data, me, busy, run, collapsible = false, onExpand, composeOnDemand = false }: { task: Task; data: BoardData; me: Member; busy: boolean; run: Run; collapsible?: boolean; onExpand?: () => void; composeOnDemand?: boolean }) {
  const [content, setContent] = useState('')
  const [composing, setComposing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  const comments = data.comments.filter(c => c.task_id === task.id && !c.deleted_at).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const latest = comments.at(-1)
  const archived = !!task.archived_at || data.projects.find(p => p.id === task.project_id)?.status === 'archived'
  return <section aria-label="태스크 댓글" className={collapsible ? 'mt-3 border-t pt-2' : 'mt-5 border-t pt-4'}>
    {collapsible ? <button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => { setExpanded(!expanded); if (!expanded) onExpand?.() }} className="flex min-h-9 w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"><MessageSquare size={14} />댓글 {comments.length}개<span className="ml-auto">{expanded ? '접기' : '펼치기'}</span>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button> : <h3 className="mb-3 text-sm font-semibold">댓글 {comments.length}개</h3>}
    {collapsible && !expanded && latest && <div className="rounded-lg bg-muted/50 px-2.5 py-2">
      <p className="caption flex flex-wrap items-center gap-x-2"><span className="font-medium">{data.members.find(m => m.id === latest.author_member_id)?.display_name ?? '연구원'}</span><time dateTime={latest.created_at}>{new Date(latest.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></p>
      <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-5">{latest.content}</p>
    </div>}
    <div id={contentId} hidden={collapsible && !expanded}>
    {(!collapsible || expanded) && <>
    <div className={collapsible ? 'max-h-64 space-y-2 overflow-y-auto' : 'space-y-3'}>{comments.map(comment => <article key={comment.id} className="rounded-xl bg-muted/50 p-3">
      <div className="flex items-center gap-2"><span className="text-sm font-medium">{data.members.find(m => m.id === comment.author_member_id)?.display_name ?? '연구원'}</span><time className="caption" dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
        {(comment.author_member_id === me.id || canManage(me.role)) && <Button type="button" className="ml-auto shrink-0" size="icon" variant="ghost" aria-label="댓글 삭제" disabled={busy} onClick={() => { void run('delete_task_comment', { p_comment: comment.id }) }}><Trash2 size={15} /></Button>}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{comment.content}</p>
    </article>)}</div>
    {!comments.length && <p className="caption">아직 댓글이 없습니다.</p>}
    {composeOnDemand && !composing ? <Button className="mt-3" variant="outline" disabled={busy || archived} onClick={() => setComposing(true)}><Plus size={15} />댓글 작성</Button> : <form className="mt-3 space-y-2" onSubmit={async event => {
      event.preventDefault()
      if (busy || archived || !content.trim()) return
      if (await run('add_task_comment', { p_task: task.id, p_content: content.trim() })) { setContent(''); setComposing(false) }
    }}><label className="text-sm font-medium">댓글<textarea value={content} autoFocus={composeOnDemand} onChange={event => setContent(event.target.value)} maxLength={5000} disabled={busy || archived} placeholder="진행 내용이나 의견을 남겨 주세요." required /></label>
      {archived && <p className="caption">보관된 업무는 복원한 뒤 댓글을 작성할 수 있습니다.</p>}
      <div className="flex justify-end gap-2">{composeOnDemand && <Button type="button" variant="ghost" disabled={busy} onClick={() => setComposing(false)}>취소</Button>}<Button disabled={busy || archived || !content.trim()}>댓글 등록</Button></div>
    </form>}
    </>}
    </div>
  </section>
}
