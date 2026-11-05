import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  backupFileName,
  createBackup,
  lastBackupTime,
  listBackups,
  restoreBackup,
  shouldBackup
} from '../src/main/backup/backup'
import { AppState } from '../src/main/app'
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
    expect(backupFileName(new Date(2026, 10, 5, 17, 40, 9))).toBe('Opus-backup-20261105-174009.zip')
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
    expect(zip).toBe(join(backupDir, 'Opus-backup-20261105-174000.zip'))
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
  it('백업은 지우지 않고 계속 쌓인다 (예전 30개 제한 없음)', () => {
    const data = join(root, 'data')
    makeData(data)
    const backupDir = join(root, 'backups')
    const state = new AppState({ settingsFile: join(root, 'settings.json'), documents: root, envDataDir: data, version: 'test' })
    state.setBackupDir(backupDir)
    for (let i = 0; i < 35; i++) state.backupNow(new Date(2026, 9, 1 + i, 12, 0, 0))
    state.close()
    expect(listBackups(backupDir)).toHaveLength(35)
    expect(lastBackupTime(backupDir)?.getDate()).toBe(4) // 10월 1일 + 34일 = 11월 4일
    expect(lastBackupTime(join(root, '없는폴더'))).toBeNull()
  })

  it('예전 이름(LimeDiary-backup-) 백업도 목록에 나오고 복원된다', () => {
    const data = join(root, 'data')
    makeData(data)
    const backupDir = join(root, 'backups')
    const zip = createBackup(data, backupDir, new Date(2026, 10, 5, 9, 0, 0))!
    const old = join(backupDir, 'LimeDiary-backup-20261101-090000.zip')
    copyFileSync(zip, old)
    expect(listBackups(backupDir).map((b) => b.file)).toEqual(['Opus-backup-20261105-090000.zip', 'LimeDiary-backup-20261101-090000.zip'])
    expect(restoreBackup(old, join(root, 'restored'))).toBe(2)
  })

  it('Google에서 읽어 온 일정 임시 파일은 백업에 담지 않는다', () => {
    const data = join(root, 'data')
    makeData(data)
    mkdirSync(join(data, 'personal', 'external'), { recursive: true })
    writeFileSync(join(data, 'personal', 'external', 'cache.json'), '{"google":{"events":[{"title":"회사 일정"}]}}')
    const zip = createBackup(data, join(root, 'backups'))!
    const names = Object.keys(unzipSync(new Uint8Array(readFileSync(zip))))
    expect(names.some((n) => n.includes('external'))).toBe(false)
    expect(names.filter((n) => n.endsWith('.md'))).toHaveLength(2)
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
