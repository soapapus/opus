import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  backupFileName,
  createBackup,
  lastBackupTime,
  listBackups,
  pruneBackups,
  restoreBackup,
  shouldBackup
} from '../src/main/backup/backup'
import { DiaryService } from '../src/main/diaryService'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'limediary-backup-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeData(dir: string) {
  const service = new DiaryService(dir)
  service.create({ date: '2026-11-05', title: '백업할 메모', body: '본문 내용', tags: ['업무'] })
  service.create({ date: '2026-11-06', title: '두 번째', body: '둘째 본문' })
  service.close()
}

describe('백업 파일 이름·주기', () => {
  it('이름에 현지 날짜와 시각이 들어간다', () => {
    expect(backupFileName(new Date(2026, 10, 5, 17, 40, 9))).toBe('LimeDiary-backup-20261105-174009.zip')
  })

  it('24시간이 지났거나 백업이 없을 때만 새로 한다', () => {
    const now = new Date(2026, 10, 5, 18, 0, 0)
    expect(shouldBackup(null, now)).toBe(true)
    expect(shouldBackup(new Date(2026, 10, 5, 9, 0, 0), now)).toBe(false)
    expect(shouldBackup(new Date(2026, 10, 4, 17, 59, 0), now)).toBe(true)
  })
})

describe('백업 만들기', () => {
  it('메모와 휴지통은 담고 색인 파일은 뺀다', () => {
    const data = join(root, 'data')
    makeData(data)
    const backupDir = join(root, 'backups')
    const zip = createBackup(data, backupDir, new Date(2026, 10, 5, 17, 40, 0))!
    expect(zip).toBe(join(backupDir, 'LimeDiary-backup-20261105-174000.zip'))
    const names = Object.keys(unzipSync(new Uint8Array(readFileSync(zip)))).sort()
    expect(names).toHaveLength(2)
    expect(names.every((n) => n.startsWith('personal/notes/2026/11/') && n.endsWith('.md'))).toBe(true)
    expect(names.some((n) => n.includes('index.sqlite'))).toBe(false)
  })

  it('백업 폴더가 데이터 폴더 안에 있어도 이전 백업을 다시 담지 않는다', () => {
    const data = join(root, 'data')
    makeData(data)
    const inside = join(data, 'backups')
    createBackup(data, inside, new Date(2026, 10, 5, 8, 0, 0))
    const second = createBackup(data, inside, new Date(2026, 10, 5, 9, 0, 0))!
    const names = Object.keys(unzipSync(new Uint8Array(readFileSync(second))))
    expect(names.some((n) => n.includes('backups'))).toBe(false)
  })

  it('담을 파일이 없으면 만들지 않는다', () => {
    const data = join(root, 'empty')
    mkdirSync(data)
    expect(createBackup(data, join(root, 'backups'))).toBeNull()
    expect(existsSync(join(root, 'backups'))).toBe(false)
  })
})

describe('정리와 복원', () => {
  it('최근 N개만 남기고 마지막 백업 시각을 알려 준다', () => {
    const data = join(root, 'data')
    makeData(data)
    const backupDir = join(root, 'backups')
    for (let day = 1; day <= 5; day++) createBackup(data, backupDir, new Date(2026, 10, day, 12, 0, 0))
    expect(listBackups(backupDir)).toHaveLength(5)
    expect(pruneBackups(backupDir, 3)).toBe(2)
    expect(listBackups(backupDir).map((b) => b.time.getDate())).toEqual([5, 4, 3])
    expect(lastBackupTime(backupDir)?.getDate()).toBe(5)
    expect(lastBackupTime(join(root, '없는폴더'))).toBeNull()
  })

  it('새 폴더에 복원하면 메모가 그대로 열린다', () => {
    const data = join(root, 'data')
    makeData(data)
    const zip = createBackup(data, join(root, 'backups'))!

    const restored = join(root, 'restored')
    expect(restoreBackup(zip, restored)).toBe(2)
    const service = new DiaryService(restored)
    expect(service.all().map((n) => n.title).sort()).toEqual(['두 번째', '백업할 메모'])
    expect(service.search('본문 내용')).toHaveLength(1)
    expect(service.tags()).toEqual([{ tag: '업무', count: 1 }])
    service.close()
  })

  it('폴더 밖으로 나가는 경로가 든 zip은 그 파일을 무시한다', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const evil = join(root, 'evil.zip')
    writeFileSync(evil, zipSync({ '../밖으로.txt': strToU8('x'), 'personal/ok.md': strToU8('ok') }))
    const target = join(root, 'target')
    expect(restoreBackup(evil, target)).toBe(1)
    expect(existsSync(join(root, '밖으로.txt'))).toBe(false)
    expect(existsSync(join(target, 'personal', 'ok.md'))).toBe(true)
  })
})
