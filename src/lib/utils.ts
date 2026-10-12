import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
export const statusNames = { todo: 'To do', ongoing: 'Ongoing', done: 'Done' } as const
export const priorityNames = { normal: '해당없음', high: '중요', urgent: '긴급' } as const
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
