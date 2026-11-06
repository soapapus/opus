// 백업 원본은 수정하지 않는다. 내용 해시와 조상 버전으로만 전진·충돌을 판정한다.
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { unzipSync } from 'fflate'
import type { AiMessage, MergeReport, Note } from '../../shared/types'
import { NoteStore } from '../storage/noteStore'
import { CHAT_PATH, isPrefix, parseChat } from '../external/aiChats'
import { parseNote, serializeNote } from '../storage/frontmatter'
import { isDateStr } from '../../shared/calendar'
import { deriveTitle, makePreview, normalizeTags } from '../../shared/text'

interface Revision { hash: string; ancestors: string[] }
interface Origin { id: string; hash: string; copyHash: string }
interface Manifest { version: 1; workspace: string; records: Record<string, Revision>; origins: Record<string, Origin> }
interface Write { path: string; text: string }
export interface MergePlan { report: MergeReport; fingerprint: string; writes: Write[]; manifest: Manifest }
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
const MANIFEST = 'personal/sync/manifest.json'
const CHAT = 'personal/ai/conversation.json'
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(id)
export const revisionHash = (n: Note): string => hash(JSON.stringify({ id: n.id, title: n.title, kind: n.kind, date: n.date, time: n.time,
  tags: [...n.tags].sort(), links: [...n.links].sort(), body: n.body.replace(/\r\n/g, '\n').trimEnd() }))
const encode = (n: Note): string => serializeNote({ ...n, kind: n.classified ? n.kind : undefined }, n.body)
function decode(text: string): Note {
  const { meta, body } = parseNote(text)
  if (!validId(meta.id) || !meta.created || !isDateStr(meta.created.slice(0, 10)) || !Number.isFinite(Date.parse(meta.created)) || /[\r\n]/.test(`${meta.created}${meta.updated ?? ''}${meta.source ?? ''}`)) throw new Error('백업의 기록 정보를 확인하지 못했어요')
  const kind = meta.kind === 'document' || meta.kind === 'event' ? meta.kind : 'note'
  if (kind !== 'document' && !isDateStr(meta.date)) throw new Error('백업의 기록 날짜가 올바르지 않아요')
  return { id: meta.id, title: meta.title || deriveTitle(body), kind, classified: !!meta.kind, date: kind === 'document' ? '' : meta.date!,
    time: kind === 'event' && meta.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(meta.time) ? meta.time : null, links: [...new Set(meta.links ?? [])], tags: normalizeTags(meta.tags ?? []), created: meta.created, updated: meta.updated ?? meta.created,
    body, preview: makePreview(body), source: 'local' }
}
function readMessages(text: string): AiMessage[] {
  const messages: unknown = JSON.parse(text)
  if (!Array.isArray(messages) || !messages.every(m => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && typeof m.created === 'string'))
    throw new Error('백업의 AI 대화 형식을 확인해 주세요')
  return messages as AiMessage[]
}
export class BackupMerger {
  private store: NoteStore
  constructor(private root: string, private workspace: string) { this.store = new NoteStore(root) }
  private load(): Manifest {
    const path = join(this.root, MANIFEST)
    if (!existsSync(path)) return { version: 1, workspace: this.workspace, records: {}, origins: {} }
    const m = JSON.parse(readFileSync(path, 'utf8')) as Manifest
    if (m.version !== 1 || m.workspace !== this.workspace || !m.records || !m.origins) throw new Error('병합 이력의 워크스페이스를 확인해 주세요')
    return m
  }
  private atomic(path: string, text: string): void {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(`${path}.tmp`, text, 'utf8'); renameSync(`${path}.tmp`, path)
  }
  private locals(): Map<string, { note: Note; path: string }> {
    const out = new Map<string, { note: Note; path: string }>()
    for (const f of this.store.listFiles()) {
      const note = this.store.read(f.path)
      if (out.has(note.id)) throw new Error('같은 ID의 기록 파일이 둘 이상 있어요. 병합 전에 확인이 필요해요')
      out.set(note.id, { note, path: f.path })
    }
    return out
  }
  capture(): Manifest {
    const manifest = this.load()
    for (const [id, { note }] of this.locals()) {
      const current = revisionHash(note); const previous = manifest.records[id]
      if (previous?.hash === current) continue
      manifest.records[id] = { hash: current, ancestors: previous ? [...new Set([previous.hash, ...previous.ancestors])] : [] }
    }
    this.atomic(join(this.root, MANIFEST), JSON.stringify(manifest))
    return manifest
  }
  private fingerprint(): string {
    const files: [string, string][] = []
    for (const f of this.store.listFiles()) files.push([f.path, hash(readFileSync(f.path, 'utf8'))])
    for (const p of [CHAT, MANIFEST]) if (existsSync(join(this.root, p))) files.push([p, hash(readFileSync(join(this.root, p), 'utf8'))])
    const chats = join(this.root, 'personal/ai/chats')
    if (existsSync(chats)) for (const name of readdirSync(chats)) if (name.endsWith('.json')) files.push([`chats/${name}`, hash(readFileSync(join(chats, name), 'utf8'))])
    return hash(JSON.stringify(files.sort((a, b) => a[0].localeCompare(b[0]))))
  }
  plan(zip: Uint8Array): MergePlan {
    if (zip.byteLength > 100 * 1024 * 1024) throw new Error('100MB 이하의 기록 백업을 선택해 주세요')
    let total = 0
    const files = unzipSync(zip, { filter: f => {
      const allowed = f.name === MANIFEST || f.name === CHAT || CHAT_PATH.test(f.name) || /^personal\/ai\/imports\/[a-f0-9]{64}\.json$/.test(f.name) || /^personal\/(?:notes\/\d{4}\/\d{2}|\.trash)\/[a-zA-Z0-9._-]+\.md$/.test(f.name)
      if (allowed) { total += f.originalSize; if (total > 100 * 1024 * 1024) throw new Error('백업의 기록 크기가 병합 한도를 넘었어요') }
      return allowed
    } })
    if (!files[MANIFEST]) throw new Error('이전 형식의 백업이에요. 두 PC를 업데이트하고 새 Drive 백업을 만들어 주세요')
    const remote = JSON.parse(new TextDecoder().decode(files[MANIFEST])) as Manifest
    if (remote.version !== 1 || remote.workspace !== this.workspace || !remote.records || !remote.origins) throw new Error('같은 워크스페이스의 백업만 합칠 수 있어요')
    const manifest = this.capture(); const local = this.locals(); const writes: Write[] = []
    const report: MergeReport = { token: randomUUID(), added: 0, updated: 0, conflicts: 0, unchanged: 0, archived: 0, aiMessages: 0, aiArchives: 0 }
    const archivedIds = new Set<string>()
    if (existsSync(this.store.trashDir)) for (const name of readdirSync(this.store.trashDir)) {
      if (name.endsWith('.md')) { const { meta } = parseNote(readFileSync(join(this.store.trashDir, name), 'utf8')); if (meta.id) archivedIds.add(meta.id) }
    }
    const remember = (id: string, n: Note, parents: string[]) => { manifest.records[id] = { hash: revisionHash(n), ancestors: [...new Set(parents)] } }
    for (const [path, bytes] of Object.entries(files)) {
      if (!path.endsWith('.md')) continue
      const text = new TextDecoder().decode(bytes)
      const incoming = decode(text); const rh = revisionHash(incoming)
      if (path.startsWith('personal/.trash/') || archivedIds.has(incoming.id)) {
        const dest = join(this.store.trashDir, `${incoming.id}-${hash(text)}.md`)
        if (!existsSync(dest)) { writes.push({ path: dest, text }); report.archived++ }
        else report.unchanged++
        continue // 보관된 메모를 과거 백업 때문에 다시 활성화하지 않는다.
      }
      const rr = remote.records[incoming.id]
      if (!rr || rr.hash !== rh || !Array.isArray(rr.ancestors)) throw new Error('백업 내용과 버전 정보가 맞지 않아요. 새 백업을 만들어 주세요')
      const origin = remote.origins[incoming.id]
      if (origin && origin.copyHash === rh && local.has(origin.id) && revisionHash(local.get(origin.id)!.note) === origin.hash) { report.unchanged++; continue }
      const current = local.get(incoming.id)
      if (!current) {
        const dest = this.store.pathFor(incoming.id, incoming.date || incoming.created.slice(0, 10))
        writes.push({ path: dest, text: encode(incoming) }); report.added++
        remember(incoming.id, incoming, rr.ancestors)
        if (origin) manifest.origins[incoming.id] = origin
        local.set(incoming.id, { note: incoming, path: dest })
      } else {
        const lh = revisionHash(current.note); const lr = manifest.records[incoming.id]
        if (lh === rh) { report.unchanged++; remember(incoming.id, current.note, [...lr.ancestors, ...rr.ancestors]); continue }
        if (lr.ancestors.includes(rh)) { report.unchanged++; continue }
        if (rr.ancestors.includes(lh)) {
          writes.push({ path: current.path, text: encode(incoming) }); report.updated++
          remember(incoming.id, incoming, [...lr.ancestors, lh, ...rr.ancestors])
          local.set(incoming.id, { note: incoming, path: current.path })
        } else {
          const id = `merge-${hash(`${incoming.id}:${rh}`).slice(0, 40)}`
          const copy: Note = { ...incoming, id, kind: incoming.id === 'scratchpad' ? 'document' : incoming.kind,
            date: incoming.id === 'scratchpad' ? '' : incoming.date, classified: true, title: `${incoming.title || '빠른 메모'} (다른 PC 사본)` }
          const ch = revisionHash(copy); const known = manifest.records[id]
          if (local.has(id) && (known?.hash === ch || known?.ancestors.includes(ch))) { report.unchanged++; continue }
          if (local.has(id)) throw new Error('사본도 양쪽에서 수정됐어요. 원본 백업을 보존한 채 수동 확인이 필요해요')
          const dest = this.store.pathFor(id, copy.date || copy.created.slice(0, 10))
          writes.push({ path: dest, text: encode(copy) }); report.conflicts++
          remember(id, copy, []); manifest.origins[id] = { id: incoming.id, hash: rh, copyHash: ch }
          local.set(id, { note: copy, path: dest })
        }
      }
    }
    // 대화가 갈라지면 이어붙여 맥락을 섞지 않고 별도 대화로 보존한다.
    if (files[CHAT]) {
      const incoming = readMessages(new TextDecoder().decode(files[CHAT]))
      const current = existsSync(join(this.root, CHAT)) ? readMessages(readFileSync(join(this.root, CHAT), 'utf8')) : []
      const same = (a: AiMessage, b: AiMessage) => JSON.stringify(a) === JSON.stringify(b)
      const prefix = (a: AiMessage[], b: AiMessage[]) => a.every((m, i) => b[i] && same(m, b[i]))
      if (prefix(current, incoming)) {
        if (incoming.length > current.length) { writes.push({ path: join(this.root, CHAT), text: JSON.stringify(incoming) }); report.aiMessages = incoming.length - current.length }
      } else if (!prefix(incoming, current)) {
        const text = JSON.stringify(incoming); const dest = join(this.root, 'personal/ai/imports', `${hash(text)}.json`)
        if (!existsSync(dest)) { writes.push({ path: dest, text }); report.aiArchives++ }
      }
    }
    for (const [path, bytes] of Object.entries(files)) if (path.startsWith('personal/ai/imports/')) {
      const text = JSON.stringify(readMessages(new TextDecoder().decode(bytes)))
      const dest = join(this.root, 'personal/ai/imports', `${hash(text)}.json`)
      if (!existsSync(dest) && !writes.some(w => w.path === dest)) { writes.push({ path: dest, text }); report.aiArchives++ }
    }
    // 여러 대화: 이어지는 대화는 더 긴 쪽으로, 갈라진 대화는 '(다른 PC)' 새 대화로 보존한다. 로컬 대화는 지우지 않는다.
    for (const [path, bytes] of Object.entries(files)) {
      const m = CHAT_PATH.exec(path)
      if (!m) continue
      const text = new TextDecoder().decode(bytes)
      const incoming = parseChat(text, m[1])
      const dest = join(this.root, 'personal/ai/chats', `${m[1]}.json`)
      if (!existsSync(dest)) { writes.push({ path: dest, text }); report.aiMessages += incoming.messages.length; continue }
      const current = parseChat(readFileSync(dest, 'utf8'), m[1])
      if (isPrefix(current.messages, incoming.messages)) {
        if (incoming.messages.length > current.messages.length) {
          writes.push({ path: dest, text: JSON.stringify({ title: current.title, created: current.created, messages: incoming.messages }) })
          report.aiMessages += incoming.messages.length - current.messages.length
        }
      } else if (!isPrefix(incoming.messages, current.messages)) {
        const copy = join(this.root, 'personal/ai/chats', `${m[1].slice(0, 40)}-${hash(JSON.stringify(incoming.messages)).slice(0, 8)}.json`)
        if (!existsSync(copy)) { writes.push({ path: copy, text: JSON.stringify({ title: `${incoming.title} (다른 PC)`, created: incoming.created, messages: incoming.messages }) }); report.aiArchives++ }
      }
    }
    return { report, fingerprint: this.fingerprint(), writes, manifest }
  }
  apply(plan: MergePlan): MergeReport {
    if (this.fingerprint() !== plan.fingerprint) throw new Error('미리보기 후 기록이 바뀌었어요. 다시 미리보기를 확인해 주세요')
    for (const w of plan.writes) this.atomic(w.path, w.text)
    this.atomic(join(this.root, MANIFEST), JSON.stringify(plan.manifest))
    return plan.report
  }
}
