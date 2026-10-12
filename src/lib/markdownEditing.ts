const listItem = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/

export function editMarkdownList(value: string, start: number, end: number, key: string, shift: boolean) {
  const lineStart = value.slice(0, start).lastIndexOf('\n') + 1
  const lineEnd = value.indexOf('\n', start)
  const line = value.slice(lineStart, lineEnd < 0 ? value.length : lineEnd)
  const match = listItem.exec(line)
  if (key === 'Enter' && !shift && start === end && match) {
    const [, indent, marker, space, content] = match
    if (start < lineStart + indent.length + marker.length + space.length) return null
    if (!content.trim()) return { from: lineStart, to: lineStart + line.length, text: '', start: lineStart, end: lineStart }
    const next = /^\d/.test(marker) ? `${Number(marker.slice(0, -1)) + 1}${marker.slice(-1)}` : marker
    const text = `\n${indent}${next} `
    return { from: start, to: end, text, start: start + text.length, end: start + text.length }
  }
  if (key !== 'Tab') return null
  // A selection ending at the next line's start must not indent that next line.
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end
  const nextBreak = value.indexOf('\n', last)
  const to = nextBreak < 0 ? value.length : nextBreak
  const lines = value.slice(lineStart, to).split('\n')
  if (!lines.some(line => listItem.test(line))) return null
  let firstDelta = 0, totalDelta = 0
  const text = lines.map((line, i) => {
    const result = shift ? line.replace(/^(?:\t| {1,4})/, '') : `    ${line}`
    const delta = result.length - line.length
    if (i === 0) firstDelta = delta
    totalDelta += delta
    return result
  }).join('\n')
  return { from: lineStart, to, text, start: Math.max(lineStart, start + firstDelta), end: Math.max(lineStart, end + totalDelta) }
}
