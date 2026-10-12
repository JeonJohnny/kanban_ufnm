import { withSystemFooter } from '../../supabase/functions/_shared/email'

export function makeDraft(title: string, content: string, author: string) {
  return { subject: title, body: withSystemFooter(['안녕하세요.', '아래 내용을 전달드립니다.', content, '확인 부탁드립니다. 감사합니다.', author].filter(Boolean).join('\n\n')) }
}
export function mailto(subject: string, body: string, to = '') {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
