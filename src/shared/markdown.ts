// AI 답변을 보여 주기 위한 작은 마크다운 해석기. HTML을 만들지 않고 구조만 돌려준다
// (화면은 React 요소로 그리므로 답변 안의 HTML·스크립트가 실행되지 않는다).

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; c: Inline[]; href: string }

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: Inline[] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' }

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = (): void => {
    if (text) out.push({ t: 'text', v: text })
    text = ''
  }
  let i = 0
  while (i < s.length) {
    const rest = s.slice(i)
    let m: RegExpExecArray | null
    if ((m = /^`([^`]+)`/.exec(rest))) {
      flush(); out.push({ t: 'code', v: m[1] }); i += m[0].length
    } else if ((m = /^\*\*(.+?)\*\*/.exec(rest)) || (m = /^__(.+?)__/.exec(rest))) {
      flush(); out.push({ t: 'b', c: parseInline(m[1]) }); i += m[0].length
    } else if ((m = /^\*(?!\s)([^*]+?)\*/.exec(rest))) {
      flush(); out.push({ t: 'i', c: parseInline(m[1]) }); i += m[0].length
    } else if ((m = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(rest))) {
      flush(); out.push({ t: 'link', c: parseInline(m[1]), href: m[2] }); i += m[0].length
    } else {
      text += s[i]; i++
    }
  }
  flush()
  return out
}

const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flushPara = (): void => {
    if (para.length) out.push({ t: 'p', c: parseInline(para.join('\n')) })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let m: RegExpExecArray | null
    if ((m = /^\s*```\s*([\w+#.-]*)\s*$/.exec(line))) {
      flushPara()
      const code: string[] = []
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) code.push(lines[i])
      out.push({ t: 'code', lang: m[1], v: code.join('\n') })
    } else if (!line.trim()) {
      flushPara()
    } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flushPara(); out.push({ t: 'h', level: m[1].length, c: parseInline(m[2].replace(/\s+#+\s*$/, '')) })
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara(); out.push({ t: 'hr' })
    } else if ((m = /^\s*>\s?(.*)$/.exec(line))) {
      flushPara()
      const q = [m[1]]
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) q.push(lines[++i].replace(/^\s*>\s?/, ''))
      out.push({ t: 'quote', c: parseInline(q.join('\n')) })
    } else if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flushPara()
      const head = cells(line).map(parseInline)
      const rows: Inline[][][] = []
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]).map(parseInline))
      i--
      out.push({ t: 'table', head, rows })
    } else if ((m = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line))) {
      flushPara()
      const ordered = !m[1]
      const items: string[] = [m[3]]
      const start = ordered ? Number(m[2]) : 1
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/
      while (i + 1 < lines.length) {
        const next = lines[i + 1]
        const n = re.exec(next)
        if (n) { items.push(n[1]); i++ }
        else if (/^\s{2,}\S/.test(next) && !/^\s*```/.test(next)) { items[items.length - 1] += `\n${next.trim()}`; i++ }
        else break
      }
      out.push({ t: 'list', ordered, start, items: items.map(parseInline) })
    } else {
      para.push(line)
    }
  }
  flushPara()
  return out
}
