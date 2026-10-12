import type { Task, TaskComment, TaskRead } from './types'

export function unreadTaskIds(tasks: Task[], reads: TaskRead[], comments: TaskComment[], memberId: string) {
  const seen = new Map(reads.filter(r => r.member_id === memberId).map(r => [r.task_id, r.read_at]))
  const unread = new Set(comments.filter(c => !c.deleted_at && c.author_member_id !== memberId && (!seen.has(c.task_id) || Date.parse(c.created_at) > Date.parse(seen.get(c.task_id)!))).map(c => c.task_id))
  return new Set(tasks.filter(t => !t.archived_at && !t.deleted_at && (unread.has(t.id) || (t.created_by !== memberId && !seen.has(t.id)))).map(t => t.id))
}

// Only acknowledge the snapshot displayed on opening, including comments from other devices.
export function taskSeenThrough(task: Task, comments: TaskComment[]) {
  return comments.filter(c => c.task_id === task.id && !c.deleted_at).reduce((latest, c) => Date.parse(c.created_at) > Date.parse(latest) ? c.created_at : latest, task.created_at)
}
