import { withSystemFooter } from './email.ts'

export type TaskEmailBatch = { id: string; to: string; name: string; tasks: { title: string; project: string }[] }
export function taskDigest(batch: TaskEmailBatch) {
  const lines = batch.tasks.slice(0, 30).map((t, i) => `${i + 1}. [${t.project}] ${t.title}`)
  if (batch.tasks.length > 30) lines.push(`외 ${batch.tasks.length - 30}개 태스크`)
  return {
    to: batch.to,
    subject: `[Lab Project Board] 새로운 태스크 ${batch.tasks.length}개가 등록되었습니다`,
    text: withSystemFooter(`${batch.name} 님, 안녕하세요.\n\n새로운 태스크 ${batch.tasks.length}개가 할당되었습니다.\n\n${lines.join('\n')}\n\nLab Project Board에 접속하여 확인해 주세요.\n감사합니다.`),
  }
}
