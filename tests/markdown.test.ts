import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TaskDescription } from '../src/components/TaskDescription'
import { editMarkdownList } from '../src/lib/markdownEditing'

function apply(value: string, key: string, shift = false, start = value.length, end = start) {
  const edit = editMarkdownList(value, start, end, key, shift)
  return edit ? value.slice(0, edit.from) + edit.text + value.slice(edit.to) : value
}
it('목록 Enter는 들여쓰기와 불릿·번호를 이어 쓰고 빈 항목은 종료한다', () => {
  expect(apply('- 첫 작업','Enter')).toBe('- 첫 작업\n- ')
  expect(apply('    9. 작업','Enter')).toBe('    9. 작업\n    10. ')
  expect(apply('1) 작업','Enter')).toBe('1) 작업\n2) ')
  expect(apply('- 앞뒤','Enter',false,3)).toBe('- 앞\n- 뒤')
  expect(apply('- 작업\n    - ','Enter')).toBe('- 작업\n')
  expect(editMarkdownList('일반 문장',5,5,'Enter',false)).toBeNull()
  expect(editMarkdownList('- 작업',4,4,'Enter',true)).toBeNull()
  expect(editMarkdownList('- 작업',0,0,'Enter',false)).toBeNull()
})
it('Tab과 Shift+Tab은 선택한 목록을 들여쓰기·내어쓰기하고 선택 영역을 보존한다', () => {
  const value='- 첫째\n- 둘째\n- 셋째'
  const edit=editMarkdownList(value,0,10,'Tab',false)!
  expect(apply(value,'Tab',false,0,10)).toBe('    - 첫째\n    - 둘째\n- 셋째')
  expect(edit.start).toBe(4)
  expect(edit.end).toBe(18)
  expect(apply('    - 첫째\n    - 둘째','Tab',true,0,17)).toBe('- 첫째\n- 둘째')
  expect(apply('\t- 작업','Tab',true)).toBe('- 작업')
  expect(editMarkdownList('일반 문장',5,5,'Tab',false)).toBeNull()
})
it('마크다운 목록·강조는 렌더링하고 HTML·실행 링크·외부 이미지는 실행하지 않는다', () => {
  const html=renderToStaticMarkup(createElement(TaskDescription,{text:'- **실험**\n    - 하위 항목\n\n1. 준비\n2. 실행\n\n<script>alert(1)</script>\n\n[위험](javascript:alert)\n\n![이미지](https://example.com/track)'}))
  expect(html).toContain('<ul>')
  expect(html).toContain('<ol>')
  expect(html).toContain('<strong>실험</strong>')
  expect(html).not.toMatch(/<script|<img|javascript:/)
  const compact=renderToStaticMarkup(createElement(TaskDescription,{text:'[참조](https://example.com)',compact:true}))
  expect(compact).toContain('참조')
  expect(compact).not.toContain('<a ')
})
