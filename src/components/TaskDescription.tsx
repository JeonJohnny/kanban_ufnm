import { useRef, useState, type KeyboardEvent } from 'react'
import Markdown from 'react-markdown'
import { editMarkdownList } from '../lib/markdownEditing'

export function TaskDescription({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className={`task-markdown ${compact ? 'max-h-10 overflow-hidden text-xs leading-5 text-muted-foreground' : 'text-sm leading-6'}`}>
    <Markdown skipHtml disallowedElements={compact ? ['a'] : []} unwrapDisallowed components={{
      img: ({ alt }) => <span>{alt}</span>,
      a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    }}>{text}</Markdown>
  </div>
}

export function TaskDescriptionEditor({ initialValue = '' }: { initialValue?: string }) {
  const [text, setText] = useState(initialValue)
  const escapeTab = useRef(false)
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'Escape') { escapeTab.current = true; event.stopPropagation(); return }
    if (escapeTab.current) { escapeTab.current = false; if (event.key === 'Tab') return }
    const input = event.currentTarget
    const edit = editMarkdownList(input.value, input.selectionStart, input.selectionEnd, event.key, event.shiftKey)
    if (!edit) return
    event.preventDefault()
    if (input.value.length - (edit.to - edit.from) + edit.text.length > input.maxLength) return
    input.setRangeText(edit.text, edit.from, edit.to, 'preserve')
    input.setSelectionRange(edit.start, edit.end)
    setText(input.value)
  }
  return <div>
    <label htmlFor="task-description">설명</label><textarea id="task-description" className="mt-1.5" data-markdown-editor name="description" maxLength={20000} defaultValue={initialValue} onChange={e => setText(e.target.value)} onKeyDown={keyDown} aria-describedby="task-description-help" placeholder={'- 첫 번째 작업\n- 두 번째 작업\n\n1. 준비\n2. 실행'} />
    <p id="task-description-help" className="caption mt-2">마크다운 지원 · 목록에서 Enter: 다음 항목 · Tab / Shift+Tab: 들여쓰기 / 내어쓰기 · Shift+Enter: 줄바꿈 · Esc 후 Tab: 다음 입력칸</p>
    {text && <section aria-label="설명 미리보기" className="mt-3 rounded-lg border bg-muted/30 p-3"><p className="caption mb-2">미리보기</p><TaskDescription text={text} /></section>}
  </div>
}
