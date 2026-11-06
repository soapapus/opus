import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, symlinkSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { LocalFiles, validFileName } from '../src/main/features/localFiles'
import { Projects } from '../src/main/features/projects'
import { browserAddress, isWebAddress } from '../src/shared/browser'
import { createBackup } from '../src/main/backup/backup'
import { unzipSync } from 'fflate'
import type { ProjectCard } from '../src/shared/workspaceFeatures'

function setup(failTrash = false) {
  const dir = mkdtempSync(join(tmpdir(), 'opus-local-feature-'))
  const left = join(dir, 'left'), right = join(dir, 'right'), outside = join(dir, 'outside'), trash = join(dir, 'trash')
  for (const p of [left, right, outside, trash]) mkdirSync(p)
  writeFileSync(join(left, '한글.txt'), '보존할 원문'); mkdirSync(join(left, '하위')); writeFileSync(join(left, '하위', '기록.md'), '하위 기록')
  const files = new LocalFiles(join(dir, 'config', 'folders.json'), async p => { if (failTrash) throw new Error('휴지통 사용 불가'); renameSync(p, join(trash, `${Date.now()}-${readdirSync(trash).length}`)) })
  return { dir, left, right, outside, trash, files }
}
async function roots(t: ReturnType<typeof setup>) { await t.files.register(t.left); const roots = await t.files.register(t.right); return { a: roots[0].id, b: roots[1].id } }

describe('PC 자료실 실제 파일 작업', () => {
  it('등록·중복 방지·이름·재시작·등록 해제는 원본 폴더를 보존한다', async () => {
    const t = setup(); await t.files.register(t.left); expect(await t.files.register(t.left)).toHaveLength(1)
    const id = t.files.roots()[0].id; t.files.renameRoot(id, '내 기록')
    const reopened = new LocalFiles(join(t.dir, 'config', 'folders.json'), async () => undefined)
    expect(reopened.roots()[0].name).toBe('내 기록'); t.files.remove(id)
    expect(existsSync(join(t.left, '한글.txt'))).toBe(true)
  })
  it('폴더 탐색과 전체 주소 이동, 새 폴더와 이름 변경이 실제 파일에 반영된다', async () => {
    const t = setup(), { a } = await roots(t)
    expect((await t.files.list({ rootId: a, relativePath: '' })).entries.map(e => e.name)).toEqual(['하위', '한글.txt'])
    expect((await t.files.address(join(t.left, '하위'))).rootId).toBe(a)
    await t.files.createFolder({ rootId: a, relativePath: '' }, '새 기록')
    await t.files.rename({ rootId: a, relativePath: '한글.txt' }, '바꾼 이름.txt')
    expect(readFileSync(join(t.left, '바꾼 이름.txt'), 'utf8')).toBe('보존할 원문')
    expect(existsSync(join(t.left, '한글.txt'))).toBe(false)
    expect(existsSync(join(t.left, '새 기록'))).toBe(true)
  })
  it('등록 경로의 별칭으로 주소를 입력해도 실제 폴더 안에서 탐색한다', async () => {
    const t = setup(), { a } = await roots(t)
    const alias = join(t.dir, 'folder-alias')
    symlinkSync(t.left, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(await t.files.address(join(alias, '하위'))).toEqual({ rootId: a, relativePath: '하위' })
    await expect(t.files.address(t.outside)).rejects.toThrow('등록된 폴더 밖')
  })
  it('파일과 폴더를 복사하고 원본·하위 파일 내용을 그대로 보존한다', async () => {
    const t = setup(), { a, b } = await roots(t)
    const result = await t.files.transfer([{ rootId: a, relativePath: '한글.txt' }, { rootId: a, relativePath: '하위' }], { rootId: b, relativePath: '' }, false)
    expect(result.every(r => r.ok), JSON.stringify(result)).toBe(true)
    expect(readFileSync(join(t.right, '하위', '기록.md'), 'utf8')).toBe('하위 기록')
    expect(readFileSync(join(t.left, '한글.txt'), 'utf8')).toBe('보존할 원문')
  })
  it('이동은 복사 검증 뒤 원본을 휴지통에 보존한다', async () => {
    const t = setup(), { a, b } = await roots(t)
    expect((await t.files.transfer([{ rootId: a, relativePath: '한글.txt' }], { rootId: b, relativePath: '' }, true))[0].ok).toBe(true)
    expect(existsSync(join(t.left, '한글.txt'))).toBe(false)
    expect(readFileSync(join(t.right, '한글.txt'), 'utf8')).toBe('보존할 원문')
    expect(readFileSync(join(t.trash, readdirSync(t.trash)[0]), 'utf8')).toBe('보존할 원문')
  })
  it('동명 대상이 있으면 전체 작업을 시작하지 않고 기존 파일을 보존한다', async () => {
    const t = setup(), { a, b } = await roots(t); writeFileSync(join(t.right, '한글.txt'), '대상의 기존 원문')
    await expect(t.files.transfer([{ rootId: a, relativePath: '하위' }, { rootId: a, relativePath: '한글.txt' }], { rootId: b, relativePath: '' }, false)).rejects.toThrow('같은 이름')
    expect(readFileSync(join(t.right, '한글.txt'), 'utf8')).toBe('대상의 기존 원문')
    expect(existsSync(join(t.right, '하위'))).toBe(false)
    await expect(t.files.rename({ rootId: a, relativePath: '한글.txt' }, '하위')).rejects.toThrow('같은 이름')
  })
  it('휴지통이 실패하면 이동 원본과 검증된 복사본을 모두 남긴다', async () => {
    const t = setup(true), { a, b } = await roots(t)
    const result = await t.files.transfer([{ rootId: a, relativePath: '한글.txt' }], { rootId: b, relativePath: '' }, true)
    expect(result[0]).toMatchObject({ ok: false, error: '휴지통 사용 불가' })
    for (const p of [t.left, t.right]) expect(readFileSync(join(p, '한글.txt'), 'utf8')).toBe('보존할 원문')
  })
  it('상위 경로·미등록 경로·최상위 폴더 변경·자기 하위 이동을 막는다', async () => {
    const t = setup(), { a } = await roots(t)
    await expect(t.files.list({ rootId: a, relativePath: '../outside' })).rejects.toThrow('폴더 밖')
    await expect(t.files.address(t.outside)).rejects.toThrow('등록된 폴더 밖')
    await expect(t.files.rename({ rootId: a, relativePath: '' }, '변경')).rejects.toThrow('최상위')
    await expect(t.files.trash([{ rootId: a, relativePath: '' }])).resolves.toEqual([expect.objectContaining({ ok: false })])
    await expect(t.files.transfer([{ rootId: a, relativePath: '하위' }], { rootId: a, relativePath: '하위' }, true)).rejects.toThrow('자기 하위')
  })
  it('폴더 연결로 등록 범위를 벗어나거나 복사 시 외부 파일을 따라가지 않는다', async () => {
    const t = setup(), { a, b } = await roots(t)
    symlinkSync(t.outside, join(t.left, '외부 연결'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(t.files.list({ rootId: a, relativePath: '외부 연결' })).rejects.toThrow()
    symlinkSync(t.outside, join(t.left, '하위', '외부'), process.platform === 'win32' ? 'junction' : 'dir')
    const result = await t.files.transfer([{ rootId: a, relativePath: '하위' }], { rootId: b, relativePath: '' }, false)
    expect(result[0].ok).toBe(false); expect(existsSync(join(t.right, '하위'))).toBe(false)
  })
  it('연결되지 않은 드라이브와 손상된 등록 파일을 빈 데이터로 덮어쓰지 않는다', async () => {
    const t = setup(), { a } = await roots(t); renameSync(t.left, join(t.dir, 'offline'))
    await expect(t.files.list({ rootId: a, relativePath: '' })).rejects.toThrow()
    expect(t.files.roots()).toHaveLength(2)
    const config = join(t.dir, 'config/folders.json'); writeFileSync(config, '손상됨')
    expect(() => t.files.roots()).toThrow('원본'); expect(readFileSync(config, 'utf8')).toBe('손상됨')
  })
  it('Windows 금지 이름을 허용하지 않는다', () => {
    for (const n of ['../x', 'CON.txt', 'NUL', 'x.', 'x ', 'a:b', 'a/b', 'a\\b', '']) expect(validFileName(n)).toBe(false)
    expect(validFileName('한글 문서 (1).md')).toBe(true)
  })
})

describe('개인 프로젝트 보존', () => {
  function project() { const t = setup(); return { ...t, project: new Projects(join(t.dir, 'data')) } }
  function newCard(b: ReturnType<Projects['get']>): ProjectCard { const now = new Date().toISOString(); return { id: 'card-1', number: 0, columnId: b.columns[0].id, title: '실행 계획', body: '보존할 카드 본문', tags: ['계획'], due: '2026-11-10', priority: 'normal' as const, archived: false, created: now, updated: now, comments: [{ id: 'comment-1', body: '첫 댓글', created: now }], attachments: [] } }
  it('직접 만든 컬럼·상태·카드·댓글을 저장하고 다시 읽는다', () => {
    const t = project(); let b = t.project.get(); b.columns.push({ id: 'custom', name: '사용자 컬럼', statusId: b.statuses[0].id, archived: false }); b.cards.push(newCard(b))
    b = t.project.save(b); expect(b.cards[0].number).toBe(1)
    b.cards[0].columnId = 'custom'; b = t.project.save(b)
    const reopened = new Projects(join(t.dir, 'data')).get(); expect(reopened.cards[0].columnId).toBe('custom'); expect(reopened.cards[0].comments[0].body).toBe('첫 댓글')
    expect(readdirSync(join(t.dir, 'data/personal/projects/board.json.history'))).toHaveLength(1)
  })
  it('동시 편집·항목 삭제·유효하지 않은 상태·날짜를 거절하고 원문을 보존한다', () => {
    const t = project(); const stale = t.project.get(); let b = t.project.get(); b.cards.push(newCard(b)); b = t.project.save(b)
    expect(() => t.project.save(stale)).toThrow('다른 창')
    expect(() => t.project.save({ ...b, cards: [] })).toThrow('보관')
    const invalid = structuredClone(b); invalid.cards[0].due = '2026-99-01'; expect(() => t.project.save(invalid)).toThrow('카드')
    expect(() => t.project.save({ ...b, columns: b.columns.map(c => ({ ...c, statusId: 'missing' })) })).toThrow('컬럼')
    expect(t.project.get().cards[0].body).toBe('보존할 카드 본문')
  })
  it('컬럼·카드 보관은 기록과 첨부 파일을 삭제하지 않고 백업에 포함한다', async () => {
    const t = project(); let b = t.project.get(); const card = newCard(b)
    card.attachments = await t.project.attach([join(t.left, '한글.txt')])
    b.cards.push(card); b = t.project.save(b); b.cards[0].archived = true; b.columns[0].archived = true; t.project.save(b)
    const attachment = t.project.attachmentPath(card.attachments[0].id); expect(readFileSync(attachment, 'utf8')).toBe('보존할 원문')
    const zip = unzipSync(readFileSync(createBackup(join(t.dir, 'data'), join(t.dir, 'backups'))!))
    expect(zip['personal/projects/board.json']).toBeTruthy()
    expect(Object.keys(zip).some(k => k.includes('/attachments/'))).toBe(true)
    expect(Object.keys(zip).some(k => k.includes('.history/'))).toBe(true)
  })
  it('마지막 컬럼 보관·첨부 경로 탈출·손상된 JSON 덮어쓰기를 막는다', () => {
    const t = project(), b = t.project.get(); expect(() => t.project.save({ ...b, columns: b.columns.map(c => ({ ...c, archived: true })) })).toThrow('하나 이상')
    expect(() => t.project.attachmentPath('../outside')).toThrow()
    const dir = join(t.dir, 'data/personal/projects'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'board.json'), 'broken')
    expect(() => t.project.get()).toThrow('원본'); expect(readFileSync(join(dir, 'board.json'), 'utf8')).toBe('broken')
  })
})

describe('브라우저 주소', () => {
  it('주소·검색어·localhost를 구분하고 한글 검색어를 보존한다', () => {
    expect(browserAddress('example.com/path')).toBe('https://example.com/path')
    expect(browserAddress('localhost:4173')).toBe('http://localhost:4173/')
    expect(new URL(browserAddress('한글 검색')).searchParams.get('q')).toBe('한글 검색')
    expect(browserAddress('')).toBe('about:blank')
  })
  it('실행 스킴·로컬 파일·주소 내 인증 정보를 거절한다', () => {
    for (const url of ['javascript:alert(1)', 'file:///C:/private.txt', 'data:text/html,test', 'chrome://settings', 'https://user:password@example.com']) expect(() => browserAddress(url)).toThrow()
    expect(isWebAddress('https://example.com')).toBe(true); expect(isWebAddress('about:blank')).toBe(false)
  })
})
