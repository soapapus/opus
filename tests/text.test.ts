import { describe, expect, it } from 'vitest'
import { dateOf, deriveTitle, makePreview, newId, normalizeTags, timeOf, toLocalIso } from '../src/shared/text'
import { parseNote, serializeNote } from '../src/main/storage/frontmatter'

describe('미리보기와 제목', () => {
  it('마크다운 기호를 떼고 한 줄로 만든다', () => {
    const body = '**굵게** 시작\n\n- 항목 하나\n- [x] 끝낸 일\n- [ ] 할 일\n[링크](https://example.com) 있음'
    expect(makePreview(body)).toBe('굵게 시작 항목 하나 끝낸 일 할 일 링크 있음')
  })

  it('길면 잘라서 말줄임표를 붙인다', () => {
    const preview = makePreview('가'.repeat(200), 20)
    expect(preview).toBe('가'.repeat(20) + '…')
  })

  it('제목은 본문의 첫 줄에서 만든다', () => {
    expect(deriveTitle('\n\n# 첫 줄 제목\n둘째 줄')).toBe('첫 줄 제목')
    expect(deriveTitle('')).toBe('')
  })
})

describe('시각과 id', () => {
  it('오프셋이 붙은 ISO 문자열을 만들고 시각만 꺼낸다', () => {
    const iso = toLocalIso(new Date(2026, 10, 5, 17, 52, 3))
    expect(iso).toMatch(/^2026-11-05T17:52:03[+-]\d{2}:\d{2}$/)
    expect(timeOf(iso)).toBe('17:52')
    expect(dateOf(iso)).toBe('2026-11-05')
  })

  it('id는 날짜·시각·무작위 네 글자이다', () => {
    expect(newId(new Date(2026, 10, 5, 17, 52, 0), () => 0.5)).toBe('20261105-175200-8000')
  })

  it('태그는 #을 떼고 중복을 지운다', () => {
    expect(normalizeTags(['#업무', ' 업무 ', '아이디어', '', '#  개인'])).toEqual(['업무', '아이디어', '개인'])
  })
})

describe('front matter', () => {
  const meta = {
    id: '20261105-175200-a3f9',
    title: '따옴표 "와" 콜론: 이 들어간 제목',
    date: '2026-11-05',
    tags: ['아이디어', '업무'],
    source: 'local',
    created: '2026-11-05T17:52:00+09:00',
    updated: '2026-11-05T18:00:00+09:00'
  }

  it('쓰고 다시 읽으면 같다', () => {
    const text = serializeNote(meta, '본문 첫 줄\n\n- 항목\n')
    const parsed = parseNote(text)
    expect(parsed.meta).toEqual(meta)
    expect(parsed.body).toBe('본문 첫 줄\n\n- 항목')
  })

  it('손으로 고친 파일(따옴표 없는 제목, [a, b] 태그, 윈도우 줄바꿈)도 읽는다', () => {
    const text = '---\r\nid: abc\r\ntitle: 그냥 제목\r\ndate: 2026-11-05\r\ntags: [업무, 아이디어]\r\n---\r\n본문\r\n'
    const parsed = parseNote(text)
    expect(parsed.meta.title).toBe('그냥 제목')
    expect(parsed.meta.tags).toEqual(['업무', '아이디어'])
    expect(parsed.body).toBe('본문')
  })

  it('정보 칸이 없는 파일은 통째로 본문이다', () => {
    const parsed = parseNote('그냥 글\n둘째 줄\n')
    expect(parsed.meta).toEqual({})
    expect(parsed.body).toBe('그냥 글\n둘째 줄')
  })
})
