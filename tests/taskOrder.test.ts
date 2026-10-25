import { describe, expect, it } from 'vitest'
import { compareTasks, taskDropPosition } from '../src/lib/utils'
import type { Task } from '../src/lib/types'

const task = (id: string, priority: Task['priority'], position: number, status: Task['status'] = 'todo') => ({ id, priority, position, status }) as Task
describe('기본 태스크 우선순위 정렬', () => {
  it('긴급·중요·해당없음 순서이며 같은 우선순위는 저장된 순서와 ID를 따른다', () => {
    const tasks = [task('normal', 'normal', 1), task('high-b', 'high', 3), task('urgent', 'urgent', 999), task('high-a', 'high', 3), task('high-first', 'high', 2)]
    expect(tasks.sort(compareTasks).map(t => t.id)).toEqual(['urgent', 'high-first', 'high-a', 'high-b', 'normal'])
  })
  it('같은 우선순위에서 위아래로 드래그한 순서를 저장한다', () => {
    const [a, b, c] = [task('a', 'high', 100), task('b', 'high', 200), task('c', 'high', 300)]
    expect(taskDropPosition([a, b, c], a, 'todo', b)).toBe(250)
    expect(taskDropPosition([a, b, c], c, 'todo', b)).toBe(150)
  })
  it('다른 우선순위 위에 놓아도 자신의 그룹에 배치하며 위치값을 섞지 않는다', () => {
    const moving = task('moving', 'high', 20, 'ongoing')
    const high = task('high', 'high', 100)
    const urgent = task('urgent', 'urgent', 9999)
    const normal = task('normal', 'normal', -9999)
    const tasks = [moving, high, urgent, normal]
    expect(taskDropPosition(tasks, moving, 'todo', urgent)).toBe(-924)
    expect(taskDropPosition(tasks, moving, 'todo', normal)).toBe(1124)
    expect(taskDropPosition(tasks, moving, 'todo', high)).toBe(-924)
  })
  it('빈 열과 열 하단으로 이동할 수 있다', () => {
    const a = task('a', 'urgent', 100)
    const b = task('b', 'urgent', 200)
    expect(taskDropPosition([a, b], a, 'done')).toBe(1024)
    expect(taskDropPosition([a, b], a, 'todo')).toBe(1224)
  })
})
