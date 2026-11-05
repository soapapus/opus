// 검색용 색인 (SQLite). 원본은 마크다운 파일이고, 이 색인은 지워도 파일에서 다시 만들 수 있다.

import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import type { Note, NoteKind, NoteSummary, TagCount } from '../../shared/types'
import type { NoteFile } from '../storage/noteStore'

/** 색인 구조 버전. 올리면 옛 색인은 지우고 파일에서 다시 만든다(원본 파일은 건드리지 않는다). */
export const INDEX_VERSION = 2

const SUMMARY_COLUMNS = 'n.id, n.title, n.kind, n.classified, n.time, n.date, n.preview, n.created, n.updated'

interface SummaryRow {
  id: string
  title: string
  kind: string
  classified: number
  time: string | null
  date: string
  preview: string
  created: string
  updated: string
}

export interface SyncResult {
  added: number
  updated: number
  removed: number
}

export class NoteIndex {
  private db: DatabaseSync

  constructor(
    file: string,
    private workspace = 'personal'
  ) {
    this.db = new DatabaseSync(file)
    this.migrate()
  }

  private closed = false

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  /** 이미 있는 색인 파일이 옛 구조라 다시 만들어야 하는지 (앱이 열기 전에 백업하려고 먼저 확인한다) */
  static needsMigration(file: string): boolean {
    if (!existsSync(file)) return false
    let db: DatabaseSync | null = null
    try {
      db = new DatabaseSync(file)
      const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      const hasNotes = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='notes'").get()
      return !!hasNotes && version < INDEX_VERSION
    } catch {
      return false
    } finally {
      db?.close()
    }
  }

  private migrate(): void {
    const version = Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    if (version < INDEX_VERSION) {
      // 색인은 파일에서 다시 만들 수 있으므로 옛 표는 지우고 새로 만든다
      this.db.exec(`
        DROP TABLE IF EXISTS notes_fts;
        DROP TABLE IF EXISTS note_tags;
        DROP TABLE IF EXISTS note_links;
        DROP TABLE IF EXISTS notes;
      `)
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'note',
        classified INTEGER NOT NULL DEFAULT 1,
        time TEXT,
        date TEXT NOT NULL,
        source TEXT NOT NULL,
        path TEXT NOT NULL,
        created TEXT NOT NULL,
        updated TEXT NOT NULL,
        mtime REAL NOT NULL,
        preview TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS notes_date ON notes(date);
      CREATE UNIQUE INDEX IF NOT EXISTS notes_path ON notes(path);
      CREATE TABLE IF NOT EXISTS note_tags (
        note_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (note_id, tag)
      );
      CREATE INDEX IF NOT EXISTS note_tags_tag ON note_tags(tag);
      CREATE TABLE IF NOT EXISTS note_links (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id)
      );
      CREATE INDEX IF NOT EXISTS note_links_to ON note_links(to_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        id UNINDEXED, title, body, tags, tokenize = 'trigram'
      );
    `)
    this.db.exec(`PRAGMA user_version = ${INDEX_VERSION}`)
  }

  private transaction(work: () => void): void {
    this.db.exec('BEGIN')
    try {
      work()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  upsert(note: Note, path: string, mtimeMs: number): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM notes WHERE id = ? OR path = ?').run(note.id, path)
      this.db
        .prepare(
          `INSERT INTO notes (id, workspace, title, kind, classified, time, date, source, path, created, updated, mtime, preview)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          note.id,
          this.workspace,
          note.title,
          note.kind,
          note.classified ? 1 : 0,
          note.time,
          note.date,
          note.source,
          path,
          note.created,
          note.updated,
          mtimeMs,
          note.preview
        )
      this.db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(note.id)
      const addTag = this.db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)')
      for (const tag of note.tags) addTag.run(note.id, tag)
      this.db.prepare('DELETE FROM note_links WHERE from_id = ?').run(note.id)
      const addLink = this.db.prepare('INSERT OR IGNORE INTO note_links (from_id, to_id) VALUES (?, ?)')
      for (const to of note.links) if (to !== note.id) addLink.run(note.id, to)
      this.db.prepare('DELETE FROM notes_fts WHERE id = ?').run(note.id)
      this.db
        .prepare('INSERT INTO notes_fts (id, title, body, tags) VALUES (?, ?, ?, ?)')
        .run(note.id, note.title, note.body, note.tags.join(' '))
    })
  }

  remove(id: string): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM notes WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(id)
      this.db.prepare('DELETE FROM note_links WHERE from_id = ?').run(id)
      this.db.prepare('DELETE FROM notes_fts WHERE id = ?').run(id)
    })
  }

  clear(): void {
    this.transaction(() => {
      this.db.exec('DELETE FROM notes; DELETE FROM note_tags; DELETE FROM note_links; DELETE FROM notes_fts;')
    })
  }

  pathOf(id: string): string | null {
    const row = this.db.prepare('SELECT path FROM notes WHERE id = ? AND workspace = ?').get(id, this.workspace) as
      | { path: string }
      | undefined
    return row?.path ?? null
  }

  /** 디스크의 파일 목록과 맞춘다. 바뀐 파일만 다시 읽는다. */
  sync(files: NoteFile[], read: (path: string) => Note): SyncResult {
    const rows = this.db.prepare('SELECT id, path, mtime FROM notes WHERE workspace = ?').all(this.workspace) as {
      id: string
      path: string
      mtime: number
    }[]
    const byPath = new Map(rows.map((r) => [r.path, r]))
    const seenPaths = new Set<string>()
    const seenIds = new Set<string>()
    const result: SyncResult = { added: 0, updated: 0, removed: 0 }

    for (const file of files) {
      seenPaths.add(file.path)
      const existing = byPath.get(file.path)
      if (existing && Math.abs(existing.mtime - file.mtimeMs) < 1) {
        seenIds.add(existing.id)
        continue
      }
      let note: Note
      try {
        note = read(file.path)
      } catch {
        continue // 읽을 수 없는 파일은 건너뛴다
      }
      if (seenIds.has(note.id)) continue // 복사된 파일 등 id가 겹치면 먼저 본 것을 따른다
      seenIds.add(note.id)
      this.upsert(note, file.path, file.mtimeMs)
      if (existing) result.updated++
      else result.added++
    }

    for (const row of rows) {
      if (!seenPaths.has(row.path) && !seenIds.has(row.id)) {
        this.remove(row.id)
        result.removed++
      }
    }
    return result
  }

  private tagsOf(ids: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>()
    if (ids.length === 0) return map
    const marks = ids.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT note_id, tag FROM note_tags WHERE note_id IN (${marks}) ORDER BY tag`)
      .all(...ids) as { note_id: string; tag: string }[]
    for (const row of rows) {
      const list = map.get(row.note_id) ?? []
      list.push(row.tag)
      map.set(row.note_id, list)
    }
    return map
  }

  /** 각 기록과 연결된 다른 기록(어느 쪽에서 걸었든)의 id. 이미 없어진 기록은 뺀다. */
  private linksOf(ids: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>()
    if (ids.length === 0) return map
    const marks = ids.map(() => '?').join(',')
    const rows = this.db
      .prepare(
        `SELECT l.from_id AS a, l.to_id AS b FROM note_links l
         JOIN notes x ON x.id = l.from_id JOIN notes y ON y.id = l.to_id
         WHERE l.from_id IN (${marks}) OR l.to_id IN (${marks})`
      )
      .all(...ids, ...ids) as { a: string; b: string }[]
    const add = (k: string, v: string) => {
      const list = map.get(k) ?? []
      if (!list.includes(v)) list.push(v)
      map.set(k, list)
    }
    for (const r of rows) {
      add(r.a, r.b)
      add(r.b, r.a)
    }
    return map
  }

  /** 이 기록과 연결된 기록들의 id */
  linkedIds(id: string): string[] {
    return this.linksOf([id]).get(id) ?? []
  }

  /** id로 요약 하나씩 (연결된 기록 보여 줄 때) */
  summaries(ids: string[]): NoteSummary[] {
    if (ids.length === 0) return []
    const marks = ids.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM notes n WHERE n.workspace = ? AND n.id IN (${marks}) ORDER BY n.date, n.updated DESC`)
      .all(this.workspace, ...ids) as unknown as SummaryRow[]
    return this.toSummaries(rows)
  }

  private toSummaries(rows: SummaryRow[]): NoteSummary[] {
    const tags = this.tagsOf(rows.map((r) => r.id))
    const links = this.linksOf(rows.map((r) => r.id))
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind as NoteKind,
      classified: Boolean(r.classified),
      time: r.time,
      links: links.get(r.id) ?? [],
      date: r.date,
      tags: tags.get(r.id) ?? [],
      preview: r.preview,
      created: r.created,
      updated: r.updated
    }))
  }

  byDate(date: string): NoteSummary[] {
    const rows = this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM notes n WHERE n.workspace = ? AND n.date = ? AND n.kind != 'document'
         ORDER BY (n.kind = 'event') DESC, n.time, n.updated DESC, n.id DESC`)
      .all(this.workspace, date) as unknown as SummaryRow[]
    return this.toSummaries(rows)
  }

  byMonth(month: string): NoteSummary[] {
    const rows = this.db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM notes n WHERE n.workspace = ? AND n.date LIKE ? AND n.kind != 'document'
         ORDER BY n.date, (n.kind = 'event') DESC, n.time, n.updated DESC, n.id DESC`
      )
      .all(this.workspace, `${month}-%`) as unknown as SummaryRow[]
    return this.toSummaries(rows)
  }

  all(tag?: string): NoteSummary[] {
    const rows = (
      tag
        ? this.db
            .prepare(
              `SELECT ${SUMMARY_COLUMNS} FROM notes n JOIN note_tags t ON t.note_id = n.id
               WHERE n.workspace = ? AND t.tag = ? ORDER BY n.updated DESC, n.id DESC LIMIT 1000`
            )
            .all(this.workspace, tag)
        : this.db
            .prepare(`SELECT ${SUMMARY_COLUMNS} FROM notes n WHERE n.workspace = ? ORDER BY n.updated DESC, n.id DESC LIMIT 1000`)
            .all(this.workspace)
    ) as unknown as SummaryRow[]
    return this.toSummaries(rows)
  }

  /** 메모장(문서)만. 달력 기록·일정은 포함하지 않는다. */
  documents(tag?: string): NoteSummary[] {
    const rows = (
      tag
        ? this.db
            .prepare(
              `SELECT ${SUMMARY_COLUMNS} FROM notes n JOIN note_tags t ON t.note_id = n.id
               WHERE n.workspace = ? AND n.kind = 'document' AND t.tag = ? ORDER BY n.updated DESC, n.id DESC LIMIT 1000`
            )
            .all(this.workspace, tag)
        : this.db
            .prepare(
              `SELECT ${SUMMARY_COLUMNS} FROM notes n WHERE n.workspace = ? AND n.kind = 'document'
               ORDER BY n.updated DESC, n.id DESC LIMIT 1000`
            )
            .all(this.workspace)
    ) as unknown as SummaryRow[]
    return this.toSummaries(rows)
  }

  /** 제목·본문·태그 검색. 3글자 이상은 전문 검색(FTS), 짧은 말은 LIKE로 찾는다. */
  search(query: string): NoteSummary[] {
    const term = query.trim().replace(/^#+\s*/, '')
    if (!term) return []
    let rows: SummaryRow[]
    if ([...term].length >= 3) {
      const phrase = `"${term.replace(/"/g, '""')}"`
      rows = this.db
        .prepare(
          `SELECT ${SUMMARY_COLUMNS} FROM notes_fts JOIN notes n ON n.id = notes_fts.id
           WHERE notes_fts MATCH ? AND n.workspace = ? ORDER BY n.updated DESC LIMIT 100`
        )
        .all(phrase, this.workspace) as unknown as SummaryRow[]
    } else {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      rows = this.db
        .prepare(
          `SELECT ${SUMMARY_COLUMNS} FROM notes_fts JOIN notes n ON n.id = notes_fts.id
           WHERE n.workspace = ? AND (notes_fts.title LIKE ? ESCAPE '\\' OR notes_fts.body LIKE ? ESCAPE '\\' OR notes_fts.tags LIKE ? ESCAPE '\\')
           ORDER BY n.updated DESC LIMIT 100`
        )
        .all(this.workspace, like, like, like) as unknown as SummaryRow[]
    }
    return this.toSummaries(rows)
  }

  tagCounts(kind?: NoteKind): TagCount[] {
    const rows = this.db
      .prepare(
        `SELECT t.tag AS tag, COUNT(*) AS count FROM note_tags t JOIN notes n ON n.id = t.note_id
         WHERE n.workspace = ? AND (? IS NULL OR n.kind = ?) GROUP BY t.tag ORDER BY count DESC, t.tag`
      )
      .all(this.workspace, kind ?? null, kind ?? null) as { tag: string; count: number }[]
    return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }))
  }

  count(kind?: NoteKind): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM notes WHERE workspace = ? AND (? IS NULL OR kind = ?)')
      .get(this.workspace, kind ?? null, kind ?? null) as { c: number }
    return Number(row.c)
  }
}
