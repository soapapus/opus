// 메모 문자열 다루기: 미리보기, 제목, 시각, id

import { pad2 } from './calendar'

/** 마크다운 기호를 떼고 한 줄 미리보기를 만든다 */
export function makePreview(body: string, max = 80): string {
  const lines = body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s+|#{1,6}\s+)/, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~]+/g, '')
        .trim()
    )
    .filter(Boolean)
  const text = lines.join(' ')
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text
}

/** 본문의 첫 줄로 제목을 만든다 */
export function deriveTitle(body: string, max = 40): string {
  const firstLine = body.split('\n').find((line) => makePreview(line, 500) !== '') ?? ''
  return makePreview(firstLine, max).replace(/…$/, '').trim()
}

/** 로컬 시각을 오프셋이 붙은 ISO 문자열로 (예: 2026-11-05T17:52:00+09:00) */
export function toLocalIso(date: Date): string {
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  )
}

/** ISO 문자열에서 "HH:mm" 부분만 (기록된 그대로의 현지 시각) */
export function timeOf(iso: string): string {
  return /T(\d{2}:\d{2})/.exec(iso)?.[1] ?? ''
}

/** ISO 문자열에서 "YYYY-MM-DD" 부분만 */
export function dateOf(iso: string): string {
  return /^(\d{4}-\d{2}-\d{2})/.exec(iso)?.[1] ?? ''
}

/** 20261105-175200-a3f9 형태의 id */
export function newId(now: Date = new Date(), random: () => number = Math.random): string {
  const stamp =
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  const rand = Math.floor(random() * 0x10000)
    .toString(16)
    .padStart(4, '0')
  return `${stamp}-${rand}`
}

/** 태그 정리: 앞의 #과 공백 제거, 중복·빈 값 제거 */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#+\s*/, '').replace(/\s+/g, ' ').slice(0, 30)
    if (tag && !seen.has(tag)) {
      seen.add(tag)
      result.push(tag)
    }
    if (result.length >= 20) break
  }
  return result
}
