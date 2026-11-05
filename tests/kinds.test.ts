import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppState } from '../src/main/app'
import { DiaryService } from '../src/main/diaryService'

let root: string
let service: DiaryService

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'limediary-kinds-'))
  service = new DiaryService(root)
})
afterEach(() => {
  service.close()
  rmSync(root, { recursive: true, force: true })
})

const at = (h: number) => new Date(2026, 10, 5, h, 0, 0)

describe('시나리오 1·2: 달력 기록과 문서는 서로 보이지 않는다', () => {
  it('달력에 쓴 "회사 회식"은 모든 메모(문서)에 나오지 않는다', () => {
    service.create({ kind: 'event', date: '2026-11-05', time: '18:30', title: '회사 회식' }, at(9))
    service.create({ kind: 'note', date: '2026-11-05', title: '오늘 기분 기록' }, at(10))
    expect(service.documents()).toEqual([])
    expect(service.total('document')).toBe(0)
    expect(service.byDate('2026-11-05').map((n) => n.title)).toEqual(['회사 회식', '오늘 기분 기록']) // 일정이 먼저
    expect(service.byMonth('2026-11')).toHaveLength(2)
  })

  it('메모장에서 쓴 문서는 날짜 없이 저장되고 달력에 나오지 않는다', () => {
    const doc = service.create({ kind: 'document', date: '2026-11-05', title: '프로젝트 기획서', body: '목표와 일정' }, at(11))
    expect(doc.date).toBe('') // 날짜를 넘겨도 문서는 날짜와 연결하지 않는다
    expect(service.byDate('2026-11-05')).toEqual([])
    expect(service.byMonth('2026-11')).toEqual([])
    expect(service.documents().map((n) => n.title)).toEqual(['프로젝트 기획서'])
    const file = readFileSync(join(root, 'personal', 'notes', '2026', '11', `${doc.id}.md`), 'utf8')
    expect(file).toContain('kind: document')
    expect(file).toContain('date: \n')
  })

  it('태그와 개수도 종류별로 센다', () => {
    service.create({ kind: 'note', date: '2026-11-05', title: 'a', tags: ['업무'] }, at(9))
    service.create({ kind: 'document', date: '', title: 'b', tags: ['업무', '아이디어'] }, at(10))
    expect(service.tags('document')).toEqual([
      { tag: '아이디어', count: 1 },
      { tag: '업무', count: 1 }
    ])
    expect(service.tags().find((t) => t.tag === '업무')?.count).toBe(2)
  })

  it('검색은 종류와 상관없이 모두 찾는다', () => {
    service.create({ kind: 'event', date: '2026-11-05', title: '회사 회식' }, at(9))
    service.create({ kind: 'document', date: '', title: '회식 장소 후보' }, at(10))
    expect(service.search('회식').map((n) => n.kind).sort()).toEqual(['document', 'event'])
  })

  it('일정의 시간은 HH:mm만 받고, 일정이 아니면 시간이 없다', () => {
    const ev = service.create({ kind: 'event', date: '2026-11-05', time: '25:99', title: 'x' })
    expect(ev.time).toBeNull()
    const ok = service.save({ id: ev.id, title: 'x', body: '', tags: [], time: '09:05' })
    expect(ok.time).toBe('09:05')
    const note = service.create({ kind: 'note', date: '2026-11-05', time: '09:00', title: 'y' })
    expect(note.time).toBeNull()
  })
})

describe('시나리오 3: 연결해도 원본은 유지된다', () => {
  it('문서→일정 연결은 양쪽에서 보이고, 원본 본문은 그대로다', () => {
    const doc = service.create({ kind: 'document', date: '', title: '기획서', body: '원본 내용' }, at(9))
    const ev = service.create({ kind: 'event', date: '2026-11-07', title: '기획 회의' }, at(10))
    service.link(doc.id, ev.id)
    expect(service.linksOf(doc.id).map((n) => n.id)).toEqual([ev.id])
    expect(service.linksOf(ev.id).map((n) => n.id)).toEqual([doc.id])
    expect(service.get(doc.id)?.body).toBe('원본 내용')
    expect(service.get(ev.id)?.title).toBe('기획 회의')
    // 연결돼도 종류 분리는 유지
    expect(service.documents().map((n) => n.id)).toEqual([doc.id])
    expect(service.byDate('2026-11-07').map((n) => n.id)).toEqual([ev.id])
    // 연결 목록에 요약의 links도 들어 있다
    expect(service.byDate('2026-11-07')[0].links).toEqual([doc.id])
  })

  it('연결은 재시작·색인 재생성 후에도 파일에서 복구된다', () => {
    const doc = service.create({ kind: 'document', date: '', title: 'd' })
    const ev = service.create({ kind: 'event', date: '2026-11-07', title: 'e' }, at(10), )
    service.link(doc.id, ev.id)
    service.close()
    rmSync(join(root, 'index.sqlite'))
    service = new DiaryService(root)
    expect(service.linksOf(ev.id).map((n) => n.id)).toEqual([doc.id])
  })

  it('연결 해제는 두 기록을 지우지 않는다. 한쪽을 삭제해도 다른 쪽은 남는다', () => {
    const doc = service.create({ kind: 'document', date: '', title: 'd' })
    const ev = service.create({ kind: 'event', date: '2026-11-07', title: 'e' })
    service.link(ev.id, doc.id)
    service.unlink(doc.id, ev.id)
    expect(service.linksOf(doc.id)).toEqual([])
    expect(service.total()).toBe(2)
    service.link(doc.id, ev.id)
    service.remove(ev.id)
    expect(service.linksOf(doc.id)).toEqual([])
    expect(service.get(doc.id)).not.toBeNull()
  })

  it('create 때 links를 주면 처음부터 연결된다 (문서를 날짜로 끌어다 놓기)', () => {
    const doc = service.create({ kind: 'document', date: '', title: '기획서' })
    const ev = service.create({ kind: 'event', date: '2026-11-09', title: '기획서', links: [doc.id] })
    expect(service.linksOf(doc.id).map((n) => n.id)).toEqual([ev.id])
  })
})

describe('시나리오 5: 예전 기록은 보존되고 자동으로 바뀌지 않는다', () => {
  function writeLegacy(dir: string, id: string, title: string, date: string) {
    const folder = join(dir, 'personal', 'notes', ...date.split('-').slice(0, 2))
    mkdirSync(folder, { recursive: true })
    const path = join(folder, `${id}.md`)
    writeFileSync(
      path,
      `---\nid: ${id}\ntitle: ${JSON.stringify(title)}\ndate: ${date}\ntags: ["업무"]\nsource: local\ncreated: ${date}T09:00:00+09:00\nupdated: ${date}T09:00:00+09:00\n---\n예전 본문\n`,
      'utf8'
    )
    return path
  }

  it('kind가 없는 파일은 달력 기록으로 보이지만 미분류이고, 파일은 그대로다', () => {
    service.close()
    const path = writeLegacy(root, 'old-1', '예전 메모', '2026-10-20')
    const before = readFileSync(path, 'utf8')
    service = new DiaryService(root)
    const n = service.byDate('2026-10-20')[0]
    expect(n.title).toBe('예전 메모')
    expect(n.classified).toBe(false)
    expect(service.documents()).toEqual([]) // 모든 메모에 자동 표시되지 않는다
    expect(readFileSync(path, 'utf8')).toBe(before) // 읽기만으로는 파일을 바꾸지 않는다
  })

  it('내용을 고쳐 저장해도 미분류 상태를 임의로 확정하지 않는다', () => {
    service.close()
    const path = writeLegacy(root, 'old-2', '예전 메모', '2026-10-20')
    service = new DiaryService(root)
    service.save({ id: 'old-2', title: '예전 메모', body: '고친 본문', tags: ['업무'] })
    expect(readFileSync(path, 'utf8')).not.toContain('kind:')
    expect(service.get('old-2')?.classified).toBe(false)
  })

  it('사용자가 직접 문서로 옮기면 날짜 연결이 풀리고 본문·태그·연결은 그대로다', () => {
    service.close()
    writeLegacy(root, 'old-3', '옮길 메모', '2026-10-20')
    service = new DiaryService(root)
    const ev = service.create({ kind: 'event', date: '2026-11-01', title: '관련 일정' })
    service.link('old-3', ev.id)
    const moved = service.setKind('old-3', 'document')
    expect(moved.kind).toBe('document')
    expect(moved.date).toBe('')
    expect(moved.body).toBe('예전 본문')
    expect(moved.tags).toEqual(['업무'])
    expect(service.byDate('2026-10-20')).toEqual([])
    expect(service.documents().map((n) => n.id)).toEqual(['old-3'])
    expect(service.linksOf('old-3').map((n) => n.id)).toEqual([ev.id])
    // 파일은 하나만 존재하고 종류가 기록된다 (복사본이 생기지 않는다)
    const files = readdirSync(join(root, 'personal', 'notes', '2026', '10'))
    expect(files).toEqual(['old-3.md'])
    expect(readFileSync(join(root, 'personal', 'notes', '2026', '10', 'old-3.md'), 'utf8')).toContain('kind: document')
  })

  it('달력 기록으로 되돌리면 만든 날에 붙고 미분류가 아니게 된다', () => {
    const doc = service.create({ kind: 'document', date: '', title: '문서' }, at(9))
    const back = service.setKind(doc.id, 'note')
    expect(back.date).toBe('2026-11-05')
    expect(back.classified).toBe(true)
    expect(service.byDate('2026-11-05')).toHaveLength(1)
  })
})

describe('마이그레이션: 옛 색인 구조(v1)로 열어도 기록이 사라지지 않는다', () => {
  it('v1 색인이 있는 데이터 폴더를 열면 백업이 먼저 만들어지고 모든 기록이 남는다', () => {
    service.close()
    // 옛 버전(v1)이 만든 폴더를 흉내 낸다: 메모 파일 + 옛 구조의 색인
    const folder = join(root, 'personal', 'notes', '2026', '10')
    mkdirSync(folder, { recursive: true })
    for (const [id, title] of [
      ['a1', '첫 기록'],
      ['a2', '둘째 기록']
    ]) {
      writeFileSync(
        join(folder, `${id}.md`),
        `---\nid: ${id}\ntitle: ${JSON.stringify(title)}\ndate: 2026-10-20\ntags: []\nsource: local\ncreated: 2026-10-20T09:00:00+09:00\nupdated: 2026-10-20T09:00:00+09:00\n---\n본문 ${id}\n`
      )
    }
    rmSync(join(root, 'index.sqlite'), { force: true })
    const old = new DatabaseSync(join(root, 'index.sqlite'))
    old.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL,
      source TEXT NOT NULL, path TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, mtime REAL NOT NULL, preview TEXT NOT NULL DEFAULT '');
      INSERT INTO notes VALUES ('a1','personal','첫 기록','2026-10-20','local','x','','',0,'');`)
    old.close()

    const state = new AppState({
      settingsFile: join(root, 'settings.json'),
      documents: root,
      envDataDir: root,
      version: 'test'
    })
    // 1) 옛 색인은 다시 만들었고 2) 백업이 만들어졌고 3) 모든 기록이 남아 있다
    expect(state.service.byDate('2026-10-20').map((n) => n.id).sort()).toEqual(['a1', 'a2'])
    expect(state.service.search('본문 a2')).toHaveLength(1)
    expect(existsSync(join(root, 'index.sqlite.before-migration.bak'))).toBe(true)
    const backups = readdirSync(join(root, '..', 'LimeDiary-backups')).filter((f) => f.endsWith('.zip'))
    expect(backups.length).toBeGreaterThanOrEqual(1)
    expect(readFileSync(join(folder, 'a1.md'), 'utf8')).toContain('본문 a1') // 원본 파일 그대로
    state.close()
    rmSync(join(root, '..', 'LimeDiary-backups'), { recursive: true, force: true })
  })
})

describe('시나리오 7 일부: 빠른 메모', () => {
  it('항상 같은 문서 하나를 쓰고, 새 문서로 옮기면 비워진다', () => {
    const s1 = service.scratch()
    expect(service.scratch().id).toBe(s1.id)
    service.scratchSave('잠깐 적은 생각\n둘째 줄')
    expect(service.scratch().body).toBe('잠깐 적은 생각\n둘째 줄')
    expect(service.byMonth('2026-11')).toEqual([]) // 달력에는 안 나온다
    const doc = service.scratchToDocument()!
    expect(doc.kind).toBe('document')
    expect(doc.title).toBe('잠깐 적은 생각')
    expect(service.scratch().body).toBe('')
    expect(service.scratchToDocument()).toBeNull() // 비어 있으면 만들지 않는다
  })
})
