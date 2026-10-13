import { describe, expect, it } from 'vitest'
import { makeDraft, mailto } from './mail'
import { insertionPosition } from './utils'

describe('메일 템플릿', () => {
  it('사용자 원문을 보존하고 정중한 한국어와 시스템 안내를 적용한다', () => {
    const korean = makeDraft('실험 & 일정', '금요일 10시\n장비 확인', '김연구')
    expect(korean.subject).toBe('실험 & 일정')
    expect(korean.body).toContain('금요일 10시\n장비 확인')
    expect(korean.body).toContain('감사합니다.')
    expect(korean.body).toContain('안녕하세요.')
    expect(korean.body).toContain('https://jeonjohnny.github.io/kanban_ufnm/')
    expect(korean.body).toMatch(/시스템에서 발송된 메일입니다\.$/)
  })
  it('메일 헤더에 특수문자가 새 매개변수를 삽입하지 못하게 한다', () => {
    expect(mailto('a&bcc=evil@example.com', '첫 줄\n두 번째')).toBe('mailto:?subject=a%26bcc%3Devil%40example.com&body=%EC%B2%AB%20%EC%A4%84%0A%EB%91%90%20%EB%B2%88%EC%A7%B8')
  })
  it('메일 앱에도 선택한 수신 주소를 전달하며 URI 삽입을 차단한다', () => {
    expect(mailto('제목','본문','lab+test@example.com')).toMatch(/^mailto:lab%2Btest%40example.com\?subject=/)
    expect(mailto('title','body','x@example.com?bcc=other@example.com')).toBe('mailto:x%40example.com%3Fbcc%3Dother%40example.com?subject=title&body=body')
  })
})
it('카드의 처음, 중간, 마지막 이동 위치를 계산한다', () => {
  expect(insertionPosition([], 0)).toBe(1024)
  expect(insertionPosition([1024, 2048], 0)).toBeLessThan(1024)
  expect(insertionPosition([1024, 2048], 1)).toBe(1536)
  expect(insertionPosition([1024, 2048], 2)).toBeGreaterThan(2048)
})
