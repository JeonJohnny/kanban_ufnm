import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Task } from './types'
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
export const statusNames = { todo: 'To do', ongoing: 'Ongoing', done: 'Done' } as const
export const priorityNames = { normal: '해당없음', high: '중요', urgent: '긴급' } as const
const priorityOrder = { urgent: 0, high: 1, normal: 2 } as const
export function compareTasks(a: Pick<Task, 'priority' | 'position' | 'id'>, b: Pick<Task, 'priority' | 'position' | 'id'>) {
  return priorityOrder[a.priority] - priorityOrder[b.priority] || a.position - b.position || a.id.localeCompare(b.id)
}
export function taskDropPosition(tasks: Task[], task: Task, status: Task['status'], target?: Task) {
  // Priority groups stay fixed; dragging only changes the order within the task's group.
  const group = tasks.filter(t => t.status === status && t.priority === task.priority).sort(compareTasks)
  const oldIndex = group.findIndex(t => t.id === task.id)
  const others = group.filter(t => t.id !== task.id)
  let index = others.length
  if (target?.priority === task.priority) {
    index = others.findIndex(t => t.id === target.id)
    if (index < 0) index = others.length
    else if (oldIndex >= 0 && oldIndex <= index) index++
  } else if (target && priorityOrder[target.priority] < priorityOrder[task.priority]) index = 0
  return insertionPosition(others.map(t => t.position), index)
}
export function dateLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(new Date(value.length === 10 ? `${value}T00:00:00` : value)) : '마감일 없음'
}
export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function insertionPosition(positions: number[], index: number) {
  const before = positions[index - 1]
  const after = positions[index]
  if (before === undefined) return after === undefined ? 1024 : after - 1024
  return after === undefined ? before + 1024 : (before + after) / 2
}
