import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DiaryService } from '../src/main/diaryService'

let root: string
let service: DiaryService

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'limediary-'))
  service = new DiaryService(root)
})

afterEach(() => {
  service.close()
  rmSync(root, { recursive: true, force: true })
})

const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m, 0)

describe('메모 만들기·저장·읽기', () => {
  it('만든 메모는 월별 폴더에 마크다운 파일로 저장된다', () => {
    const note = service.create({ date: '2026-11-05', title: '카드뉴스 수집 구조', body: 'RSS에서 가져온다', tags: ['아이디어'] }, at(17, 52))
    const path = join(root, 'personal', 'notes', '2026', '11', `${note.id}.md`)
    expect(existsSync(path)).toBe(true)
    const text = readFileSync(path, 'utf8')
    expect(text).toContain('title: "카드뉴스 수집 구조"')
    expect(text).toContain('RSS에서 가져온다')
    expect(service.get(note.id)?.title).toBe('카드뉴스 수집 구조')
  })

  it('저장하면 본문·태그·수정 시각이 바뀌고 만든 시각은 그대로다', () => {
    const note = service.create({ date: '2026-11-05', title: '초안' }, at(9))
    const saved = service.save({ id: note.id, title: '수정본', body: '- [ ] 할 일', tags: ['#업무'] }, at(10))
    expect(saved.title).toBe('수정본')
    expect(saved.tags).toEqual(['업무'])
    expect(saved.created).toBe(note.created)
    expect(saved.updated).not.toBe(note.updated)
    expect(service.get(note.id)?.body).toBe('- [ ] 할 일')
  })

  it('제목을 비워서 저장하면 본문 첫 줄이 제목이 된다', () => {
    const note = service.create({ date: '2026-11-05' })
    const saved = service.save({ id: note.id, title: '', body: '장보기 목록\n- 우유', tags: [] })
    expect(saved.title).toBe('장보기 목록')
  })

  it('없는 메모를 저장하면 오류이고, 읽으면 null이다', () => {
    expect(service.get('nope')).toBeNull()
    expect(() => service.save({ id: 'nope', title: '', body: '', tags: [] })).toThrow()
  })

  it('저장 중 임시 파일이 남지 않는다', () => {
    const note = service.create({ date: '2026-11-05', title: 'a' })
    service.save({ id: note.id, title: 'b', body: 'c', tags: [] })
    const dir = join(root, 'personal', 'notes', '2026', '11')
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('날짜별·월별·전체 목록', () => {
  it('날짜와 월로 묶어서 최근 수정 순으로 준다', () => {
    const a = service.create({ date: '2026-11-05', title: 'A' }, at(8, 30))
    const b = service.create({ date: '2026-11-05', title: 'B' }, at(9, 10))
    service.create({ date: '2026-11-09', title: 'C' }, at(10))
    service.create({ date: '2026-12-01', title: 'D' }, at(11))
    expect(service.byDate('2026-11-05').map((n) => n.title)).toEqual(['B', 'A'])
    expect(service.byMonth('2026-11').map((n) => n.title)).toEqual(['B', 'A', 'C'])
    expect(service.all().map((n) => n.title)).toEqual(['D', 'C', 'B', 'A'])
    expect(service.total()).toBe(4)
    expect(a.id).not.toBe(b.id)
  })

  it('잘못된 날짜·월 형식은 빈 목록이다', () => {
    expect(service.byDate('아무거나')).toEqual([])
    expect(service.byMonth('2026-1')).toEqual([])
  })
})

describe('태그', () => {
  it('태그별 개수를 세고 태그로 걸러 볼 수 있다', () => {
    service.create({ date: '2026-11-05', title: 'a', tags: ['업무', '아이디어'] }, at(8))
    service.create({ date: '2026-11-06', title: 'b', tags: ['업무'] }, at(9))
    service.create({ date: '2026-11-07', title: 'c', tags: ['개인'] }, at(10))
    expect(service.tags()).toEqual([
      { tag: '업무', count: 2 },
      { tag: '개인', count: 1 },
      { tag: '아이디어', count: 1 }
    ])
    expect(service.all('업무').map((n) => n.title).sort()).toEqual(['a', 'b'])
    expect(service.byDate('2026-11-05')[0].tags).toEqual(['socket'.length ? '아이디어' : '', '업무'].sort())
  })
})

describe('검색', () => {
  beforeEach(() => {
    service.create({ date: '2026-11-05', title: '카드뉴스 수집 구조', body: 'RSS에서 기사를 가져와 카드로 저장한다', tags: ['아이디어'] }, at(8))
    service.create({ date: '2026-11-06', title: '주간 업무 정리', body: '재고 수량 확인', tags: ['업무'] }, at(9))
    service.create({ date: '2026-11-07', title: '회의 준비', body: '질문 목록', tags: [] }, at(10))
  })

  it('세 글자 이상은 제목·본문 어디서든 찾는다 (글 중간 일부도)', () => {
    expect(service.search('카드뉴스').map((n) => n.title)).toEqual(['카드뉴스 수집 구조'])
    expect(service.search('기사를 가져').map((n) => n.title)).toEqual(['카드뉴스 수집 구조'])
    expect(service.search('rss').map((n) => n.title)).toEqual(['카드뉴스 수집 구조'])
    expect(service.search('수량 확인').map((n) => n.title)).toEqual(['주간 업무 정리'])
  })

  it('두 글자 한글 단어도 찾는다', () => {
    expect(service.search('회의').map((n) => n.title)).toEqual(['회의 준비'])
    expect(service.search('수집').map((n) => n.title)).toEqual(['카드뉴스 수집 구조'])
  })

  it('태그로도 찾고, #을 붙여도 된다', () => {
    expect(service.search('업무').map((n) => n.title)).toEqual(['주간 업무 정리'])
    expect(service.search('#아이디어').map((n) => n.title)).toEqual(['카드뉴스 수집 구조'])
  })

  it('없는 말과 빈 검색어는 빈 목록이고, 특수문자가 있어도 오류가 나지 않는다', () => {
    expect(service.search('존재하지않는단어')).toEqual([])
    expect(service.search('   ')).toEqual([])
    expect(() => service.search('"따옴표" OR % _ \\')).not.toThrow()
  })

  it('저장해서 바뀐 내용으로 다시 찾는다', () => {
    const note = service.search('회의')[0]
    service.save({ id: note.id, title: '발표 준비', body: '슬라이드 만들기', tags: [] })
    expect(service.search('회의')).toEqual([])
    expect(service.search('슬라이드').map((n) => n.title)).toEqual(['발표 준비'])
  })
})

describe('삭제', () => {
  it('삭제하면 목록·검색에서 사라지고 파일은 .trash로 옮겨진다', () => {
    const note = service.create({ date: '2026-11-05', title: '지울 메모', body: '내용' })
    service.remove(note.id)
    expect(service.get(note.id)).toBeNull()
    expect(service.byDate('2026-11-05')).toEqual([])
    expect(service.search('지울 메모')).toEqual([])
    expect(existsSync(join(root, 'personal', '.trash', `${note.id}.md`))).toBe(true)
    expect(existsSync(join(root, 'personal', 'notes', '2026', '11', `${note.id}.md`))).toBe(false)
  })

  it('비어 있는 새 메모는 정리하지만 내용이 있으면 남긴다', () => {
    const empty = service.create({ date: '2026-11-05' })
    const filled = service.create({ date: '2026-11-05', title: '내용 있음' })
    expect(service.discardIfEmpty(empty.id)).toBe(true)
    expect(service.discardIfEmpty(filled.id)).toBe(false)
    expect(service.get(empty.id)).toBeNull()
    expect(service.get(filled.id)).not.toBeNull()
    expect(existsSync(join(root, 'personal', '.trash', `${empty.id}.md`))).toBe(false)
  })
})

describe('파일을 직접 고쳤을 때 색인 맞추기', () => {
  it('앱 밖에서 추가·수정·삭제한 파일이 다시 열 때 반영된다', () => {
    const note = service.create({ date: '2026-11-05', title: '원래 제목', body: '원래 본문' })
    const notePath = join(root, 'personal', 'notes', '2026', '11', `${note.id}.md`)

    // 외부에서 새 파일 추가 (정보 칸 없이 그냥 글)
    const extra = join(root, 'personal', 'notes', '2026', '11', '메모장에서-만든-글.md')
    writeFileSync(extra, '메모장에서 쓴 글\n내용', 'utf8')

    // 외부에서 기존 파일 수정
    const edited = readFileSync(notePath, 'utf8').replace('원래 제목', '바뀐 제목')
    writeFileSync(notePath, edited, 'utf8')
    const future = new Date(Date.now() + 5000)
    utimesSync(notePath, future, future)

    service.close()
    service = new DiaryService(root)
    const titles = service.all().map((n) => n.title).sort()
    expect(titles).toEqual(['메모장에서 쓴 글', '바뀐 제목'].sort())

    // 외부에서 삭제
    unlinkSync(notePath)
    service.refreshIndex()
    expect(service.all().map((n) => n.title)).toEqual(['메모장에서 쓴 글'])
  })

  it('색인 파일을 지워도 다시 만들어진다', () => {
    service.create({ date: '2026-11-05', title: '남아야 함', body: '본문', tags: ['업무'] })
    service.close()
    rmSync(join(root, 'index.sqlite'), { force: true })
    service = new DiaryService(root)
    expect(service.search('남아야').map((n) => n.title)).toEqual(['남아야 함'])
    expect(service.tags()).toEqual([{ tag: '업무', count: 1 }])
  })

  it('색인 다시 만들기', () => {
    service.create({ date: '2026-11-05', title: 'x' })
    const result = service.rebuildIndex()
    expect(result.added).toBe(1)
    expect(service.total()).toBe(1)
  })

  it('같은 id의 복사본 파일이 있어도 목록에 하나만 나온다', () => {
    const note = service.create({ date: '2026-11-05', title: '원본' })
    const src = join(root, 'personal', 'notes', '2026', '11', `${note.id}.md`)
    mkdirSync(join(root, 'personal', 'notes', '2026', '10'), { recursive: true })
    writeFileSync(join(root, 'personal', 'notes', '2026', '10', '복사본.md'), readFileSync(src, 'utf8'), 'utf8')
    service.rebuildIndex()
    expect(service.total()).toBe(1)
  })
})
