// 집·회사 두 PC가 Google Drive 폴더로 같은 메모를 쓸 때 (동기화 A안)
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppState } from '../src/main/app'
import { DiaryService } from '../src/main/diaryService'
import { changedSince, conflictTitle, isCloudSyncedPath } from '../src/shared/sync'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opus-sync-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** 같은 드라이브 폴더를 쓰는 두 PC. 색인은 PC마다 따로 */
function twoPcs() {
  const drive = join(root, 'drive', 'Opus')
  const home = new DiaryService(drive, 'personal', join(root, 'home-pc', 'index.sqlite'))
  const work = new DiaryService(drive, 'personal', join(root, 'work-pc', 'index.sqlite'))
  return { drive, home, work }
}

describe('순수 함수', () => {
  it('Google Drive·OneDrive 폴더를 알아본다', () => {
    expect(isCloudSyncedPath('G:\\내 드라이브\\Opus')).toBe(true)
    expect(isCloudSyncedPath('G:\\My Drive\\Opus')).toBe(true)
    expect(isCloudSyncedPath('C:\\Users\\me\\Google Drive\\Opus')).toBe(true)
    expect(isCloudSyncedPath('/Users/me/Library/CloudStorage/GoogleDrive-x/My Drive/Opus')).toBe(true)
    expect(isCloudSyncedPath('C:\\Users\\me\\OneDrive - 회사\\Opus')).toBe(true)
    expect(isCloudSyncedPath('C:\\Users\\me\\Documents\\LimeDiary-data')).toBe(false)
    expect(isCloudSyncedPath('C:\\drivers\\Opus')).toBe(false)
  })

  it('사본 제목에 원래 제목과 시각이 들어간다', () => {
    expect(conflictTitle('주간 회고', new Date(2026, 10, 5, 9, 7))).toBe('주간 회고 (다른 PC에서 고친 내용 11/05 09:07)')
    expect(conflictTitle('  ', new Date(2026, 10, 5, 9, 7))).toBe('제목 없음 (다른 PC에서 고친 내용 11/05 09:07)')
  })

  it('편집기가 읽은 값이 없으면 바뀐 것으로 보지 않는다', () => {
    expect(changedSince(undefined, 'a')).toBe(false)
    expect(changedSince('a', 'a')).toBe(false)
    expect(changedSince('a', 'b')).toBe(true)
  })
})

describe('두 PC가 같은 폴더를 쓸 때', () => {
  it('다른 PC에서 만든 메모가 다시 읽으면 보인다', () => {
    const { home, work } = twoPcs()
    const n = work.create({ kind: 'document', date: '', title: '회사에서 쓴 메모', body: '오늘 배운 것' }, new Date(2026, 10, 5, 9))
    expect(home.get(n.id)).toBeNull()
    const r = home.refreshIndex()
    expect(r.added).toBe(1)
    expect(home.get(n.id)?.body).toBe('오늘 배운 것')
    expect(home.search('배운')).toHaveLength(1)
    home.close()
    work.close()
  })

  it('같은 메모를 양쪽에서 고치면, 나중에 저장한 쪽이 덮어쓰지 않고 다른 PC 내용을 사본으로 남긴다', () => {
    const { home, work } = twoPcs()
    const n = home.create({ kind: 'document', date: '', title: '주간 회고', body: '처음' }, new Date(2026, 10, 5, 9))
    work.refreshIndex()
    const base = work.get(n.id)!.updated // 회사 PC 편집기가 읽은 값

    home.save({ id: n.id, title: '주간 회고', body: '집에서 고침', tags: [], baseUpdated: n.updated }, new Date(2026, 10, 5, 10))
    // 회사 PC는 집 PC가 고친 줄 모르고 저장
    const saved = work.save({ id: n.id, title: '주간 회고', body: '회사에서 고침', tags: [], baseUpdated: base }, new Date(2026, 10, 5, 11))

    expect(saved.body).toBe('회사에서 고침')
    expect(saved.conflictCopy?.title).toBe('주간 회고 (다른 PC에서 고친 내용 11/05 11:00)')
    const copy = work.get(saved.conflictCopy!.id)!
    expect(copy.body).toBe('집에서 고침')
    expect(copy.kind).toBe('document')
    // 집 PC도 다시 읽으면 두 개 다 본다
    home.refreshIndex()
    expect(home.get(n.id)?.body).toBe('회사에서 고침')
    expect(home.get(copy.id)?.body).toBe('집에서 고침')
    home.close()
    work.close()
  })

  it('다른 PC가 안 고쳤으면 사본을 만들지 않는다', () => {
    const { home, work } = twoPcs()
    const n = home.create({ kind: 'document', date: '', title: 'a', body: '1' }, new Date(2026, 10, 5, 9))
    const s1 = home.save({ id: n.id, title: 'a', body: '2', tags: [], baseUpdated: n.updated }, new Date(2026, 10, 5, 10))
    const s2 = home.save({ id: n.id, title: 'a', body: '3', tags: [], baseUpdated: s1.updated }, new Date(2026, 10, 5, 11))
    expect(s1.conflictCopy).toBeUndefined()
    expect(s2.conflictCopy).toBeUndefined()
    expect(home.documents()).toHaveLength(1)
    home.close()
    work.close()
  })

  it('다른 PC에서 날짜를 옮겨 파일 위치가 바뀌어도 저장된다', () => {
    const { home, work } = twoPcs()
    const n = home.create({ kind: 'event', date: '2026-11-05', title: '회의', body: '' }, new Date(2026, 10, 5, 9))
    work.refreshIndex()
    work.setKind(n.id, 'document') // 회사 PC에서 문서로 옮김 → 파일이 다른 달 폴더로 이동할 수 있음
    const saved = home.save({ id: n.id, title: '회의', body: '집에서 메모', tags: [] }, new Date(2026, 10, 5, 10))
    expect(saved.body).toBe('집에서 메모')
    home.close()
    work.close()
  })
})

describe('이 PC에만 두는 파일', () => {
  it('검색 색인은 데이터 폴더 밖(설정 폴더 아래)에 만든다', () => {
    const dataDir = join(root, 'drive', 'Opus')
    const state = new AppState({ settingsFile: join(root, 'appdata', 'settings.json'), documents: root, envDataDir: dataDir, version: 'test' })
    state.service.create({ kind: 'document', date: '', title: 't', body: 'b' })
    expect(existsSync(join(dataDir, 'index.sqlite'))).toBe(false)
    expect(existsSync(join(state.localDir, 'index.sqlite'))).toBe(true)
    expect(state.localDir.startsWith(join(root, 'appdata'))).toBe(true)
    state.close()
  })

  it('예전 버전이 데이터 폴더에 둔 Google 일정 임시 파일은 지우고, 메모는 그대로 둔다', () => {
    const dataDir = join(root, 'drive', 'Opus')
    const ext = join(dataDir, 'personal', 'external')
    mkdirSync(ext, { recursive: true })
    writeFileSync(join(ext, 'cache.json'), '{"events":[{"title":"회사 회의"}]}')
    const notes = join(dataDir, 'personal', 'notes', '2026', '11')
    mkdirSync(notes, { recursive: true })
    const md = '---\nid: k1\ntitle: "내 메모"\ndate: 2026-11-05\ntags: []\nsource: local\ncreated: 2026-11-05T09:00:00+09:00\nupdated: 2026-11-05T09:00:00+09:00\n---\n본문\n'
    writeFileSync(join(notes, 'k1.md'), md)

    const state = new AppState({ settingsFile: join(root, 'appdata', 'settings.json'), documents: root, envDataDir: dataDir, version: 'test' })
    expect(existsSync(join(ext, 'cache.json'))).toBe(false)
    expect(readFileSync(join(notes, 'k1.md'), 'utf8')).toBe(md)
    expect(state.service.get('k1')?.title).toBe('내 메모')
    state.close()
  })

  it('예전 버전이 데이터 폴더에 둔 색인은 쓰지 않고, 메모 파일에서 다시 만든다', () => {
    const dataDir = join(root, 'drive', 'Opus')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'index.sqlite'), 'not a database')
    const state = new AppState({ settingsFile: join(root, 'appdata', 'settings.json'), documents: root, envDataDir: dataDir, version: 'test' })
    state.service.create({ kind: 'document', date: '', title: '새 메모', body: '' })
    expect(state.service.documents().map((d) => d.title)).toContain('새 메모')
    expect(readdirSync(dataDir)).toContain('index.sqlite') // 건드리지 않음
    state.close()
  })
})
