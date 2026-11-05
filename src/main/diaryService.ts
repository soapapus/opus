// 파일 저장(NoteStore)과 색인(NoteIndex)을 묶어서 화면이 쓰는 기능으로 내놓는다.

import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isDateStr, todayStr } from '../shared/calendar'
import { deriveTitle, makePreview, normalizeTags, toLocalIso } from '../shared/text'
import { changedSince, conflictTitle } from '../shared/sync'
import type { CreateNoteInput, Note, NoteKind, NoteSummary, SavedNote, SaveNoteInput, TagCount } from '../shared/types'
import { NoteIndex } from './index/noteIndex'
import { NoteStore } from './storage/noteStore'

export const SCRATCH_ID = 'scratchpad'

export class DiaryService {
  readonly store: NoteStore
  private index: NoteIndex

  constructor(
    readonly root: string,
    workspace = 'personal',
    /** 검색 색인 파일. 동기화 폴더(Google Drive)에 두면 두 PC가 서로 덮어쓰므로 PC 안에 둔다 */
    indexFile = join(root, 'index.sqlite')
  ) {
    mkdirSync(root, { recursive: true })
    this.store = new NoteStore(root, workspace)
    this.store.ensureDirs()
    mkdirSync(dirname(indexFile), { recursive: true })
    this.index = new NoteIndex(indexFile, workspace)
    this.refreshIndex()
  }

  close(): void {
    this.index.close()
  }

  /** 디스크 파일과 색인을 맞춘다 */
  refreshIndex() {
    return this.index.sync(this.store.listFiles(), (p) => this.store.read(p))
  }

  /** 색인을 지우고 파일에서 다시 만든다 */
  rebuildIndex() {
    this.index.clear()
    return this.refreshIndex()
  }

  create(input: CreateNoteInput, now: Date = new Date()): Note {
    const note = this.store.build(input, now)
    if (!note.title && note.body) note.title = deriveTitle(note.body)
    const path = this.store.write(note)
    this.index.upsert(note, path, statSync(path).mtimeMs)
    return note
  }

  /** 색인에 적힌 파일 위치. 다른 PC에서 옮겨졌으면 색인을 맞추고 다시 찾는다 */
  private locate(id: string): string | null {
    const path = this.index.pathOf(id)
    if (path && existsSync(path)) return path
    this.refreshIndex()
    return this.index.pathOf(id)
  }

  save(input: SaveNoteInput, now: Date = new Date()): SavedNote {
    const path = this.locate(input.id)
    if (!path) throw new Error(`메모를 찾을 수 없습니다: ${input.id}`)
    const current = this.store.read(path)
    // 편집기가 읽은 뒤 다른 PC에서 파일이 바뀌었으면, 그 내용을 사본으로 남기고 나서 덮어쓴다
    let conflictCopy: NoteSummary | undefined
    if (changedSince(input.baseUpdated, current.updated)) {
      const copy = this.create(
        { kind: current.kind, date: current.date, time: current.time, title: conflictTitle(current.title, now), body: current.body, tags: current.tags, links: current.links },
        now
      )
      const { body: _b, source: _s, ...summary } = copy
      conflictCopy = summary
    }
    const body = input.body
    const title = input.title.trim() || deriveTitle(body)
    let time = current.time
    if (current.kind === 'event' && input.time !== undefined) {
      time = input.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ? input.time : null
    }
    const next: Note = {
      ...current,
      time,
      title,
      body,
      tags: normalizeTags(input.tags),
      preview: makePreview(body),
      updated: toLocalIso(now)
    }
    const newPath = this.store.write(next)
    if (newPath !== path) this.store.removeFile(path)
    this.index.upsert(next, newPath, statSync(newPath).mtimeMs)
    return conflictCopy ? { ...next, conflictCopy } : next
  }

  get(id: string): Note | null {
    const path = this.index.pathOf(id)
    if (!path) return null
    try {
      return this.store.read(path)
    } catch {
      this.index.remove(id)
      return null
    }
  }

  /** 삭제: 휴지통 폴더로 옮긴다 */
  remove(id: string): void {
    const path = this.index.pathOf(id)
    if (!path) return
    this.store.trash(path)
    this.index.remove(id)
  }

  /** 제목도 본문도 비어 있으면 파일을 지운다 (새 메모를 만들었다가 그냥 둔 경우) */
  discardIfEmpty(id: string): boolean {
    const note = this.get(id)
    if (!note || note.title.trim() || note.body.trim() || note.tags.length) return false
    const path = this.index.pathOf(id)
    if (path) this.store.removeFile(path)
    this.index.remove(id)
    return true
  }

  /**
   * 기록의 종류를 사용자가 직접 정한다. 문서로 옮기면 날짜 연결이 사라지고,
   * 달력 기록으로 옮기면 (날짜가 없으면) 만든 날로 둔다. 연결·태그·본문은 그대로다.
   */
  setKind(id: string, kind: NoteKind, now: Date = new Date()): Note {
    const path = this.index.pathOf(id)
    if (!path) throw new Error(`기록을 찾을 수 없습니다: ${id}`)
    const current = this.store.read(path)
    const date =
      kind === 'document' ? '' : isDateStr(current.date) && current.date ? current.date : current.created.slice(0, 10) || todayStr(now)
    const next: Note = {
      ...current,
      kind,
      classified: true,
      date,
      time: kind === 'event' ? current.time : null
    }
    const newPath = this.store.write(next)
    if (newPath !== path) this.store.removeFile(path)
    this.index.upsert(next, newPath, statSync(newPath).mtimeMs)
    return next
  }

  /** 두 기록을 연결한다. 원본 내용은 바꾸지 않고 연결 정보만 from 쪽 파일에 적는다. */
  link(fromId: string, toId: string): void {
    if (fromId === toId) return
    const from = this.get(fromId)
    const to = this.get(toId)
    if (!from || !to) throw new Error('연결할 기록을 찾을 수 없습니다')
    if (from.links.includes(toId) || this.index.linkedIds(fromId).includes(toId)) return
    this.rewriteLinks(from, [...from.links, toId])
  }

  unlink(a: string, b: string): void {
    for (const [x, y] of [
      [a, b],
      [b, a]
    ]) {
      const note = this.get(x)
      if (note && note.links.includes(y)) this.rewriteLinks(note, note.links.filter((l) => l !== y))
    }
  }

  private rewriteLinks(note: Note, links: string[]): void {
    const path = this.index.pathOf(note.id)
    if (!path) return
    const next: Note = { ...note, links }
    const newPath = this.store.write(next)
    this.index.upsert(next, newPath, statSync(newPath).mtimeMs)
  }

  linksOf(id: string): NoteSummary[] {
    return this.index.summaries(this.index.linkedIds(id))
  }

  /** 메모장(문서)만 */
  documents(tag?: string): NoteSummary[] {
    return this.index.documents(tag)
  }

  /** 글로벌 단축키로 여는 빠른 메모. 항상 같은 문서 하나를 쓴다. */
  scratch(): Note {
    const existing = this.get(SCRATCH_ID)
    if (existing) return existing
    return this.create({ id: SCRATCH_ID, kind: 'document', date: '', title: '빠른 메모' })
  }

  scratchSave(body: string): void {
    const note = this.scratch()
    this.save({ id: note.id, title: note.title || '빠른 메모', body, tags: note.tags })
  }

  /** 빠른 메모 내용을 새 문서로 옮기고, 빠른 메모는 비운다 */
  scratchToDocument(now: Date = new Date()): Note | null {
    const note = this.scratch()
    if (!note.body.trim()) return null
    const doc = this.create({ kind: 'document', date: '', body: note.body }, now)
    this.scratchSave('')
    return doc
  }

  byDate(date: string): NoteSummary[] {
    return isDateStr(date) ? this.index.byDate(date) : []
  }

  byMonth(month: string): NoteSummary[] {
    return /^\d{4}-\d{2}$/.test(month) ? this.index.byMonth(month) : []
  }

  all(tag?: string): NoteSummary[] {
    return this.index.all(tag)
  }

  search(query: string): NoteSummary[] {
    return this.index.search(query)
  }

  tags(kind?: NoteKind): TagCount[] {
    return this.index.tagCounts(kind)
  }

  total(kind?: NoteKind): number {
    return this.index.count(kind)
  }
}
