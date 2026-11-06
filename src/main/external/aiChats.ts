// AI 대화 여러 개를 대화마다 파일 하나(personal/ai/chats/<id>.json)로 보관한다.
// 대화는 지우지 않고 계속 쌓는다. 예전 한 줄 대화(conversation.json)와 갈라진 대화(imports/)는
// 원본을 그대로 둔 채 처음 한 번 대화 목록으로 복사한다.
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AiChat, AiChatSummary, AiMessage } from '../../shared/types'

export const CHAT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
export const CHAT_PATH = /^personal\/ai\/chats\/([a-z0-9][a-z0-9-]{0,63})\.json$/

const isMessage = (m: unknown): m is AiMessage =>
  !!m && typeof m === 'object' && ((m as AiMessage).role === 'user' || (m as AiMessage).role === 'model') &&
  typeof (m as AiMessage).text === 'string' && typeof (m as AiMessage).created === 'string'

/** 파일 내용을 대화로 읽는다. 형식이 틀리면 예외 (손상 파일을 빈 대화로 덮어쓰지 않기 위해) */
export function parseChat(text: string, id: string): AiChat {
  const c = JSON.parse(text) as Partial<AiChat>
  if (!c || typeof c !== 'object' || !Array.isArray(c.messages) || !c.messages.every(isMessage) || typeof c.created !== 'string')
    throw new Error('AI 대화 형식을 확인해 주세요')
  return { id, title: typeof c.title === 'string' && c.title.trim() ? c.title.trim().slice(0, 80) : titleOf(c.messages), created: c.created, messages: c.messages }
}

/** 첫 질문 앞부분을 제목으로 */
export function titleOf(messages: AiMessage[]): string {
  const first = messages.find((m) => m.role === 'user')?.text.replace(/\s+/g, ' ').trim() ?? ''
  return first ? (first.length > 40 ? `${first.slice(0, 40)}…` : first) : '새 대화'
}

export const isPrefix = (a: AiMessage[], b: AiMessage[]): boolean =>
  a.length <= b.length && a.every((m, i) => JSON.stringify(m) === JSON.stringify(b[i]))

const hash = (s: string): string => createHash('sha256').update(s).digest('hex')

export class ChatStore {
  constructor(private aiDir: string) {}
  get dir(): string { return join(this.aiDir, 'chats') }

  pathOf(id: string): string {
    if (!CHAT_ID.test(id)) throw new Error('대화를 찾을 수 없어요')
    return join(this.dir, `${id}.json`)
  }

  private atomic(path: string, data: unknown): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 1), 'utf8')
    renameSync(`${path}.tmp`, path)
  }

  /** 예전 대화를 한 번 복사한다. 원본 파일은 건드리지 않는다. 이미 복사했으면 아무것도 안 한다. */
  private migrate(): void {
    const legacy = join(this.aiDir, 'conversation.json')
    const dest = join(this.dir, 'legacy.json')
    if (existsSync(legacy) && !existsSync(dest)) {
      try {
        const messages = JSON.parse(readFileSync(legacy, 'utf8')) as unknown
        if (Array.isArray(messages) && messages.length && messages.every(isMessage))
          this.atomic(dest, { title: titleOf(messages), created: messages[0].created, messages })
      } catch { /* 손상된 예전 파일은 그대로 둔다 */ }
    }
    const imports = join(this.aiDir, 'imports')
    if (existsSync(imports)) for (const name of readdirSync(imports)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
      const to = join(this.dir, `imp-${name.slice(0, 16)}.json`)
      if (existsSync(to)) continue
      try {
        const messages = JSON.parse(readFileSync(join(imports, name), 'utf8')) as unknown
        if (Array.isArray(messages) && messages.length && messages.every(isMessage))
          this.atomic(to, { title: `${titleOf(messages)} (다른 PC)`, created: messages[0].created, messages })
      } catch { /* 무시 */ }
    }
  }

  list(): AiChatSummary[] {
    this.migrate()
    if (!existsSync(this.dir)) return []
    const out: AiChatSummary[] = []
    for (const name of readdirSync(this.dir)) {
      const id = name.endsWith('.json') ? name.slice(0, -5) : ''
      if (!CHAT_ID.test(id)) continue
      try {
        const c = parseChat(readFileSync(join(this.dir, name), 'utf8'), id)
        out.push({ id, title: c.title, updated: c.messages.at(-1)?.created ?? c.created, count: c.messages.length })
      } catch { /* 읽지 못한 파일은 목록에서만 빠진다 (지우지 않음) */ }
    }
    return out.sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id))
  }

  get(id: string): AiChat {
    const path = this.pathOf(id)
    if (!existsSync(path)) throw new Error('대화를 찾을 수 없어요')
    return parseChat(readFileSync(path, 'utf8'), id)
  }

  create(firstText: string): AiChat {
    const now = new Date().toISOString()
    return { id: randomUUID(), title: titleOf([{ role: 'user', text: firstText, created: now }]), created: now, messages: [] }
  }

  save(c: AiChat): void {
    this.atomic(this.pathOf(c.id), { title: c.title, created: c.created, messages: c.messages })
  }

  rename(id: string, title: string): AiChat {
    const c = this.get(id)
    const t = title.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!t) throw new Error('대화 이름을 입력해 주세요')
    c.title = t
    this.save(c)
    return c
  }

  /** 응답을 기다리는 사이 다른 곳에서 대화가 바뀌었으면, 내 답변은 갈라진 새 대화로 보존한다 */
  fork(c: AiChat): AiChat {
    const copy: AiChat = { ...c, id: `${c.id.slice(0, 40)}-${hash(JSON.stringify(c.messages)).slice(0, 8)}`, title: `${c.title} (갈라진 대화)` }
    this.save(copy)
    return copy
  }
}
