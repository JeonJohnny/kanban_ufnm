import { expect, it } from 'vitest'
import { taskSeenThrough, unreadTaskIds } from '../src/lib/taskUnread'
import type { Task, TaskComment, TaskRead } from '../src/lib/types'

const task = { id: 'task', created_by: 'me', created_at: '2026-01-01T00:00:00Z', archived_at: null, deleted_at: null } as Task
const comment = { id: 'comment', task_id: task.id, author_member_id: 'other', created_at: '2026-01-01T01:00:00Z', deleted_at: null } as TaskComment
const read = { task_id: task.id, member_id: 'me', read_at: comment.created_at } as TaskRead

it('생성자는 새 태스크 알림에서 제외하고 다른 연구원은 확인할 때까지 표시한다', () => {
  expect(unreadTaskIds([task], [], [], 'me').size).toBe(0)
  expect(unreadTaskIds([task], [], [], 'other').has(task.id)).toBe(true)
  expect(unreadTaskIds([task], [{ ...read, member_id: 'other' }], [], 'other').size).toBe(0)
  expect(unreadTaskIds([task], [read], [], 'other').has(task.id)).toBe(true)
})

it('다른 사람 댓글은 생성자에게도 표시하고 본인·삭제된 댓글은 제외한다', () => {
  expect(unreadTaskIds([task], [], [comment], 'me').has(task.id)).toBe(true)
  expect(unreadTaskIds([task], [], [{ ...comment, author_member_id: 'me' }], 'me').size).toBe(0)
  expect(unreadTaskIds([task], [], [{ ...comment, deleted_at: comment.created_at }], 'me').size).toBe(0)
})

it('확인 후 새 댓글만 다시 표시하고 여러 댓글도 태스크 한 건으로 센다', () => {
  const next = { ...comment, id: 'next', created_at: '2026-01-01T02:00:00Z' }
  expect(unreadTaskIds([task], [read], [comment], 'me').size).toBe(0)
  expect(unreadTaskIds([task], [read], [comment, next], 'me').size).toBe(1)
  const snapshot = taskSeenThrough(task, [comment])
  expect(snapshot).toBe(comment.created_at)
  expect(unreadTaskIds([task], [{ ...read, read_at: snapshot }], [comment, next], 'me').size).toBe(1)
  expect(unreadTaskIds([task], [{ ...read, read_at: taskSeenThrough(task, [comment, next]) }], [comment, next], 'me').size).toBe(0)
  expect(taskSeenThrough(task, [])).toBe(task.created_at)
})

it('삭제·보관된 태스크는 새 댓글이 있어도 보드 알림에서 제외한다', () => {
  expect(unreadTaskIds([{ ...task, archived_at: comment.created_at }], [], [comment], 'me').size).toBe(0)
  expect(unreadTaskIds([{ ...task, deleted_at: comment.created_at }], [], [comment], 'me').size).toBe(0)
})
