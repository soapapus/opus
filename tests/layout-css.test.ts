import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 펼친 메모 카드가 글 길이만큼 늘어나야 한다 (안쪽 스크롤이면 글이 카드 밖으로 넘치고 저장 줄이 글 위에 겹침)
const css = readFileSync(join(__dirname, '../src/renderer/src/opus.css'), 'utf8')

function rule(selector: string): string {
  const i = css.lastIndexOf(`${selector} {`)
  expect(i, `${selector} 규칙이 있어야 함`).toBeGreaterThanOrEqual(0)
  return css.slice(i, css.indexOf('}', i))
}

describe('펼친 메모 카드 레이아웃', () => {
  it('편집기와 본문은 안쪽 스크롤 없이 늘어난다', () => {
    expect(rule('.agenda-open .card.editor')).toMatch(/overflow:\s*visible/)
    expect(rule('.agenda-open .ed-body')).toMatch(/overflow:\s*visible/)
    expect(rule('.agenda-open .ed-body')).toMatch(/flex:\s*1 0 auto/)
  })
  it('저장 줄은 글 아래에 놓인다 (sticky 아님)', () => {
    expect(rule('.agenda-open .ed-foot')).toMatch(/position:\s*static/)
  })
})
