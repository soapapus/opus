import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { zipSync, unzipSync } from 'fflate'
import { BackupMerger } from '../src/main/backup/merge'
import { NoteStore } from '../src/main/storage/noteStore'
import { createBackup } from '../src/main/backup/backup'

function pc() {
  const dir = mkdtempSync(join(tmpdir(), 'opus-merge-')); const data = join(dir, 'data'); mkdirSync(data)
  const store = new NoteStore(data); store.ensureDirs(); const merger = new BackupMerger(data, 'personal')
  return { dir, data, store, merger, snapshot: () => { merger.capture(); return readFileSync(createBackup(data, join(dir, 'backups'))!) } }
}
function write(p: ReturnType<typeof pc>, body: string, id = 'record-1') {
  const existing = p.store.listFiles().map(f => p.store.read(f.path)).find(n => n.id === id)
  const n = existing ?? p.store.build({ id, kind: 'document', date: '', title: '기록', body: '' }, new Date('2026-11-06T10:00:00+09:00'))
  p.store.write({ ...n, body }) // 시각은 고의로 같게 둬서 타임스탬프에 의존하지 않는지 확인한다.
}
const notes = (p: ReturnType<typeof pc>) => p.store.listFiles().map(f => p.store.read(f.path))
function twin() {
  const a = pc(); write(a, '공통 원본'); a.snapshot()
  const b = pc(); cpSync(a.data, b.data, { recursive: true })
  return { a, b }
}
function merge(to: ReturnType<typeof pc>, zip: Uint8Array) { const plan = to.merger.plan(zip); to.merger.apply(plan); return plan.report }

describe('백업 기반 병합', () => {
  it('서로 다른 메모를 합치고 같은 백업을 반복해도 중복이 생기지 않는다', () => {
    const a = pc(), b = pc(); write(a, '집 기록', 'home-1'); write(b, '회사 기록', 'office-1')
    const source = b.snapshot()
    expect(merge(a, source).added).toBe(1)
    expect(notes(a).map(n => n.body).sort()).toEqual(['집 기록', '회사 기록'])
    expect(merge(a, source).added).toBe(0)
    expect(notes(a)).toHaveLength(2)
    expect(merge(b, a.snapshot()).added).toBe(1)
    expect(notes(b)).toHaveLength(2)
  })
  it('공통 원본 이후 한쪽만 수정했다면 같은 시각이어도 그 메모를 이어서 갱신한다', () => {
    const { a, b } = twin(); write(b, '회사에서 수정')
    const newer = b.snapshot()
    expect(merge(a, newer).updated).toBe(1)
    expect(notes(a)[0].body).toBe('회사에서 수정')
    expect(merge(a, newer).unchanged).toBe(1)
  })
  it('과거 백업을 합쳐도 새 기록으로 되돌아가지 않는다', () => {
    const { a, b } = twin(); const old = a.snapshot(); write(b, '새 내용'); merge(a, b.snapshot())
    expect(merge(a, old).updated).toBe(0)
    expect(notes(a)[0].body).toBe('새 내용')
  })
  it('양쪽 동시 수정은 원문과 사본을 모두 보존하며 재실행·왕복 병합도 사본이 늘지 않는다', () => {
    const { a, b } = twin(); write(a, '집 수정'); write(b, '회사 수정'); const source = b.snapshot()
    expect(merge(a, source).conflicts).toBe(1)
    expect(notes(a).map(n => n.body).sort()).toEqual(['집 수정', '회사 수정'])
    expect(merge(a, source).conflicts).toBe(0)
    merge(b, a.snapshot()); merge(a, b.snapshot()); merge(b, a.snapshot())
    expect(new Set(notes(a).map(n => n.body))).toEqual(new Set(['집 수정', '회사 수정']))
    expect(notes(a)).toHaveLength(2)
    expect(notes(b)).toHaveLength(2)
  })
  it('백업에 없는 로컬 기록을 지우지 않고 보관한 기록을 다시 활성화하지 않는다', () => {
    const { a, b } = twin(); const old = b.snapshot(); const path = a.store.listFiles()[0].path; a.store.trash(path)
    write(a, '새 로컬 메모', 'local-only')
    merge(a, old)
    expect(notes(a).map(n => n.id)).toEqual(['local-only'])
    expect(existsSync(a.store.trashDir)).toBe(true)
  })
  it('빠른 메모의 충돌은 문서 사본으로 남긴다', () => {
    const a = pc(), b = pc(); write(a, '집 빠른 메모', 'scratchpad'); write(b, '회사 빠른 메모', 'scratchpad')
    expect(merge(a, b.snapshot()).conflicts).toBe(1)
    expect(notes(a).find(n => n.id.startsWith('merge-'))?.kind).toBe('document')
  })
  it('미리보기 후 수정했으면 병합을 중단하고 새 글을 보존한다', () => {
    const { a, b } = twin(); write(b, '원격 수정'); const plan = a.merger.plan(b.snapshot()); write(a, '미리보기 이후 내 글')
    expect(() => a.merger.apply(plan)).toThrow('기록이 바뀌었어요')
    expect(notes(a)[0].body).toBe('미리보기 이후 내 글')
  })
  it('이어지는 AI 대화는 갱신하고 갈라진 대화는 별도 파일에 보존한다', () => {
    const a = pc(), b = pc(); const chat = (p: ReturnType<typeof pc>, texts: string[]) => {
      mkdirSync(join(p.data, 'personal/ai'), { recursive: true })
      writeFileSync(join(p.data, 'personal/ai/conversation.json'), JSON.stringify(texts.map(text => ({ role: 'user', text, created: '2026-11-06T10:00:00+09:00' }))))
    }
    chat(a, ['공통']); chat(b, ['공통', '회사 질문'])
    expect(merge(a, b.snapshot()).aiMessages).toBe(1)
    chat(a, ['공통', '집 질문'])
    expect(merge(a, b.snapshot()).aiArchives).toBe(1)
    expect(merge(a, b.snapshot()).aiArchives).toBe(0)
    expect(readFileSync(join(a.data, 'personal/ai/conversation.json'), 'utf8')).toContain('집 질문')
  })
  it('여러 대화: 이어지면 더 긴 쪽, 갈라지면 (다른 PC) 새 대화로 보존하고 반복해도 같다', () => {
    const a = pc(), b = pc()
    const put = (p: ReturnType<typeof pc>, id: string, texts: string[]) => {
      mkdirSync(join(p.data, 'personal/ai/chats'), { recursive: true })
      writeFileSync(join(p.data, 'personal/ai/chats', `${id}.json`), JSON.stringify({ title: '공통 대화', created: '2026-11-06T10:00:00+09:00', messages: texts.map(text => ({ role: 'user', text, created: '2026-11-06T10:00:00+09:00' })) }))
    }
    put(a, 'c1', ['공통']); put(b, 'c1', ['공통', '회사 질문']); put(b, 'c2', ['회사에서만'])
    const r = merge(a, b.snapshot())
    expect(r.aiMessages).toBe(2)
    expect(readFileSync(join(a.data, 'personal/ai/chats/c1.json'), 'utf8')).toContain('회사 질문')
    expect(existsSync(join(a.data, 'personal/ai/chats/c2.json'))).toBe(true)
    put(a, 'c1', ['공통', '회사 질문', '집 질문']); put(b, 'c1', ['공통', '회사 질문', '회사 둘째'])
    expect(merge(a, b.snapshot()).aiArchives).toBe(1)
    expect(merge(a, b.snapshot()).aiArchives).toBe(0)
    expect(readFileSync(join(a.data, 'personal/ai/chats/c1.json'), 'utf8')).toContain('집 질문')
  })
  it('다른 워크스페이스·조작된 버전·폴더 탈출 파일을 받아들이지 않는다', () => {
    const a = pc(), b = pc(); write(b, '원격'); const files = unzipSync(b.snapshot())
    files['../../outside.md'] = new TextEncoder().encode('금지')
    merge(a, zipSync(files)); expect(existsSync(join(a.dir, 'outside.md'))).toBe(false)
    const m = JSON.parse(new TextDecoder().decode(files['personal/sync/manifest.json'])); m.workspace = 'other'
    files['personal/sync/manifest.json'] = new TextEncoder().encode(JSON.stringify(m))
    expect(() => a.merger.plan(zipSync(files))).toThrow('같은 워크스페이스')
    m.workspace = 'personal'; m.records['record-1'].hash = 'tampered'
    files['personal/sync/manifest.json'] = new TextEncoder().encode(JSON.stringify(m))
    expect(() => a.merger.plan(zipSync(files))).toThrow('버전 정보')
  })
})
