import { expect, it } from 'vitest'
import { parseMarkdown } from '../src/shared/markdown'

it('제목·목록·코드·표·인용을 구조로 나누고 HTML은 글자로 둔다', () => {
  const b = parseMarkdown(['### 정리', '1. **요청**: 보내요', '2. 응답', '', '```python', 'print("<b>")', '```', '', '| 이름 | 값 |', '|---|---|', '| a | `1` |', '', '> 인용', '', '<script>x</script> 글'].join('\n'))
  expect(b.map(x => x.t)).toEqual(['h', 'list', 'code', 'table', 'quote', 'p'])
  expect(b[1]).toMatchObject({ t: 'list', ordered: true, start: 1, items: [[{ t: 'b' }, { t: 'text', v: ': 보내요' }], [{ t: 'text', v: '응답' }]] })
  expect(b[2]).toEqual({ t: 'code', lang: 'python', v: 'print("<b>")' })
  expect(b[5]).toEqual({ t: 'p', c: [{ t: 'text', v: '<script>x</script> 글' }] })
})

it('닫히지 않은 코드 블록과 http가 아닌 링크도 안전하게 다룬다', () => {
  expect(parseMarkdown('```\n끝 없음')).toEqual([{ t: 'code', lang: '', v: '끝 없음' }])
  expect(parseMarkdown('[누르기](javascript:alert(1))')[0]).toEqual({ t: 'p', c: [{ t: 'text', v: '[누르기](javascript:alert(1))' }] })
})
