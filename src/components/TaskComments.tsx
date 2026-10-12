import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { canManage, type BoardData, type Member, type Task } from '@/lib/types'
import { Button } from './ui/button'
import type { Run } from './Forms'

export function TaskComments({ task, data, me, busy, run }: { task: Task; data: BoardData; me: Member; busy: boolean; run: Run }) {
  const [content, setContent] = useState('')
  const comments = data.comments.filter(c => c.task_id === task.id && !c.deleted_at).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const archived = !!task.archived_at || data.projects.find(p => p.id === task.project_id)?.status === 'archived'
  return <section aria-label="태스크 댓글" className="mt-5 border-t pt-4">
    <h3 className="mb-3 text-sm font-semibold">댓글 {comments.length}개</h3>
    <div className="space-y-3">{comments.map(comment => <article key={comment.id} className="rounded-xl bg-muted/50 p-3">
      <div className="flex items-center gap-2"><span className="text-sm font-medium">{data.members.find(m => m.id === comment.author_member_id)?.display_name ?? '연구원'}</span><time className="caption" dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
        {(comment.author_member_id === me.id || canManage(me.role)) && <Button type="button" className="ml-auto shrink-0" size="icon" variant="ghost" aria-label="댓글 삭제" disabled={busy} onClick={() => { void run('delete_task_comment', { p_comment: comment.id }) }}><Trash2 size={15} /></Button>}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{comment.content}</p>
    </article>)}</div>
    {!comments.length && <p className="caption">아직 댓글이 없습니다.</p>}
    <form className="mt-3 space-y-2" onSubmit={async event => {
      event.preventDefault()
      if (busy || archived || !content.trim()) return
      if (await run('add_task_comment', { p_task: task.id, p_content: content.trim() })) setContent('')
    }}><label className="text-sm font-medium">댓글<textarea value={content} onChange={event => setContent(event.target.value)} maxLength={5000} disabled={busy || archived} placeholder="진행 내용이나 의견을 남겨 주세요." required /></label>
      {archived && <p className="caption">보관된 업무는 복원한 뒤 댓글을 작성할 수 있습니다.</p>}
      <div className="flex justify-end"><Button disabled={busy || archived || !content.trim()}>댓글 등록</Button></div>
    </form>
  </section>
}
