import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 펼친 메모 카드: 높이는 고정, 본문만 안에서 스크롤 (글이 길어져도 카드가 늘어나거나 글이 밖으로 넘치면 안 됨)
const css = readFileSync(join(__dirname, '../src/renderer/src/opus.css'), 'utf8')

function rule(selector: string): string {
  const i = css.lastIndexOf(`\n${selector} {`)
  expect(i, `${selector} 규칙이 있어야 함`).toBeGreaterThanOrEqual(0)
  return css.slice(i, css.indexOf('}', i))
}

describe('펼친 메모 카드 레이아웃', () => {
  it('카드 높이는 고정된다', () => {
    expect(rule('.agenda-open')).toMatch(/\n\s*height:\s*clamp\(/)
  })
  it('편집기는 카드 높이를 넘지 않고, 본문만 스크롤된다', () => {
    expect(rule('.agenda-open .card.editor')).toMatch(/overflow:\s*hidden/)
    expect(rule('.agenda-open .ed-body')).toMatch(/overflow-y:\s*auto/)
    expect(rule('.agenda-open .ed-body')).toMatch(/min-height:\s*0/)
  })
  it('저장 줄은 sticky 가 아니라 본문 아래 제자리에 있다', () => {
    expect(rule('.agenda-open .ed-foot')).toMatch(/position:\s*static/)
  })
})
