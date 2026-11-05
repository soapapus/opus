// 메모 파일을 읽고 쓰는 계층. 파일(마크다운)이 원본이다.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { isDateStr, todayStr } from '../../shared/calendar'
import { deriveTitle, dateOf, makePreview, newId, normalizeTags, toLocalIso } from '../../shared/text'
import type { CreateNoteInput, Note, NoteKind } from '../../shared/types'
import { parseNote, serializeNote } from './frontmatter'

const KINDS: NoteKind[] = ['note', 'event', 'document']
const isKind = (v: unknown): v is NoteKind => typeof v === 'string' && (KINDS as string[]).includes(v)
const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)

export interface NoteFile {
  path: string
  mtimeMs: number
}

export class NoteStore {
  constructor(
    readonly root: string,
    readonly workspace = 'personal'
  ) {}

  get notesDir(): string {
    return join(this.root, this.workspace, 'notes')
  }

  get trashDir(): string {
    return join(this.root, this.workspace, '.trash')
  }

  ensureDirs(): void {
    mkdirSync(this.notesDir, { recursive: true })
  }

  pathFor(id: string, date: string): string {
    const [year, month] = date.split('-')
    return join(this.notesDir, year, month, `${id}.md`)
  }

  /** 새 메모 객체를 만든다 (아직 저장하지 않음) */
  build(input: CreateNoteInput, now: Date = new Date()): Note {
    const kind: NoteKind = isKind(input.kind) ? input.kind : 'note'
    // 문서는 날짜와 연결하지 않는다. 달력 기록·일정은 날짜가 꼭 있어야 한다.
    const date = kind === 'document' ? '' : isDateStr(input.date) ? input.date : todayStr(now)
    const body = input.body ?? ''
    const iso = toLocalIso(now)
    return {
      id: input.id || newId(now),
      title: (input.title ?? '').trim(),
      kind,
      classified: true,
      time: kind === 'event' && isTime(input.time) ? input.time : null,
      links: [...new Set((input.links ?? []).filter(Boolean))],
      date,
      tags: normalizeTags(input.tags ?? []),
      preview: makePreview(body),
      created: iso,
      updated: iso,
      body,
      source: 'local'
    }
  }

  /** 안전하게 쓴다: 임시 파일에 먼저 쓰고 이름을 바꿔 덮어쓴다 */
  write(note: Note): string {
    // 문서는 날짜가 없으므로 만든 달 폴더에 둔다 (폴더 위치는 의미가 없다)
    const path = this.pathFor(note.id, note.date || note.created.slice(0, 10))
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(
      tmp,
      serializeNote(
        {
          id: note.id,
          title: note.title,
          // 종류를 확인하지 않은 예전 기록은 종류를 적지 않고 그대로 둔다
          kind: note.classified ? note.kind : undefined,
          date: note.date,
          time: note.time,
          links: note.links,
          tags: note.tags,
          source: note.source,
          created: note.created,
          updated: note.updated
        },
        note.body
      ),
      'utf8'
    )
    renameSync(tmp, path)
    return path
  }

  /** 파일에서 읽는다. 손으로 고친 파일처럼 정보가 빠져 있어도 최대한 채워서 연다. */
  read(path: string): Note {
    const text = readFileSync(path, 'utf8')
    const { meta, body } = parseNote(text)
    const mtime = statSync(path).mtime
    const stem = basename(path).replace(/\.md$/i, '')
    const iso = toLocalIso(mtime)
    const classified = isKind(meta.kind)
    // 종류가 적혀 있지 않은 예전 파일은 달력 기록으로 "보여 주되" 파일은 건드리지 않는다
    const kind: NoteKind = classified ? (meta.kind as NoteKind) : 'note'
    const date = kind === 'document' ? '' : isDateStr(meta.date) ? meta.date : dateOf(iso)
    const title = meta.title ?? ''
    return {
      id: meta.id || stem,
      title: title || deriveTitle(body),
      kind,
      classified,
      time: kind === 'event' && isTime(meta.time) ? meta.time : null,
      links: [...new Set(meta.links ?? [])],
      date,
      tags: normalizeTags(meta.tags ?? []),
      preview: makePreview(body),
      created: meta.created || iso,
      updated: meta.updated || iso,
      body,
      source: meta.source || 'local'
    }
  }

  /** 삭제: 영구 삭제하지 않고 .trash 폴더로 옮긴다 */
  trash(path: string): string {
    mkdirSync(this.trashDir, { recursive: true })
    let target = join(this.trashDir, basename(path))
    if (existsSync(target)) {
      const stamp = toLocalIso(new Date()).replace(/[-:+T]/g, '').slice(0, 14)
      target = join(this.trashDir, `${stamp}-${basename(path)}`)
    }
    renameSync(path, target)
    return target
  }

  /** 휴지통을 거치지 않고 지운다 (빈 메모 정리용) */
  removeFile(path: string): void {
    if (existsSync(path)) unlinkSync(path)
  }

  /** notes 폴더 아래의 모든 .md 파일 */
  listFiles(): NoteFile[] {
    const result: NoteFile[] = []
    const walk = (dir: string) => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          result.push({ path: full, mtimeMs: statSync(full).mtimeMs })
        }
      }
    }
    walk(this.notesDir)
    return result
  }
}
