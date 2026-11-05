// 앱 전체 상태: 데이터 폴더, 메모 서비스, 백업을 한곳에서 관리한다.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DiaryService } from './diaryService'
import { NoteIndex } from './index/noteIndex'
import { SettingsStore } from './settings'
import { createBackup, lastBackupIso, lastBackupTime, pruneBackups, shouldBackup } from './backup/backup'
import type { AppInfo } from '../shared/types'

export interface AppPaths {
  settingsFile: string
  documents: string
  portableDir?: string
  envDataDir?: string
  version: string
}

export class AppState {
  readonly settings: SettingsStore
  service!: DiaryService
  dataDir = ''
  scratchShortcut: string | null = null

  constructor(private paths: AppPaths) {
    this.settings = new SettingsStore(paths.settingsFile)
    this.open(this.resolveDataDir())
  }

  private resolveDataDir(): string {
    const { envDataDir, portableDir, documents } = this.paths
    if (envDataDir) return resolve(envDataDir)
    const saved = this.settings.get().dataDir
    if (saved) return saved
    if (portableDir) return join(portableDir, 'LimeDiary-data')
    return join(documents || homedir(), 'LimeDiary-data')
  }

  get backupDir(): string {
    return this.settings.get().backupDir ?? join(dirname(this.dataDir), 'LimeDiary-backups')
  }

  /** 검색 색인 구조가 바뀌어 다시 만들어야 하면, 만들기 전에 백업부터 한다 */
  private backupBeforeMigration(dir: string): void {
    const indexFile = join(dir, 'index.sqlite')
    if (!NoteIndex.needsMigration(indexFile)) return
    try {
      copyFileSync(indexFile, join(dir, 'index.sqlite.before-migration.bak'))
    } catch {
      /* 색인은 다시 만들 수 있으므로 복사 실패는 넘어간다 */
    }
    const backupDir = this.settings.get().backupDir ?? join(dirname(dir), 'LimeDiary-backups')
    createBackup(dir, backupDir) // 실패하면 예외 → 마이그레이션을 중단해 데이터를 지킨다
  }

  private open(dir: string): void {
    mkdirSync(dir, { recursive: true })
    this.service?.close()
    this.backupBeforeMigration(dir)
    this.dataDir = dir
    this.service = new DiaryService(dir)
  }

  info(): AppInfo {
    return {
      appVersion: this.paths.version,
      dataDir: this.dataDir,
      backupDir: this.backupDir,
      lastBackup: lastBackupIso(this.backupDir),
      totalNotes: this.service.total(),
      documentCount: this.service.total('document'),
      scratchShortcut: this.scratchShortcut
    }
  }

  /** 데이터 폴더를 옮긴다. 새 폴더가 비어 있으면 기존 메모를 복사해 간다. */
  switchDataDir(dir: string): void {
    const target = resolve(dir)
    if (target === this.dataDir) return
    const hasNotes = existsSync(join(target, 'personal', 'notes'))
    if (!hasNotes && existsSync(this.dataDir)) {
      mkdirSync(target, { recursive: true })
      for (const name of readdirSync(this.dataDir)) {
        if (name.startsWith('index.sqlite')) continue
        cpSync(join(this.dataDir, name), join(target, name), { recursive: true })
      }
    }
    this.open(target)
    this.settings.update({ dataDir: target })
  }

  setBackupDir(dir: string): void {
    this.settings.update({ backupDir: resolve(dir) })
  }

  backupNow(now: Date = new Date()): string | null {
    const zip = createBackup(this.dataDir, this.backupDir, now)
    if (zip) pruneBackups(this.backupDir, 30)
    return zip
  }

  /** 마지막 백업이 24시간 넘었으면 자동으로 백업한다. */
  autoBackup(now: Date = new Date()): boolean {
    if (!shouldBackup(lastBackupTime(this.backupDir), now)) return false
    return this.backupNow(now) !== null
  }

  close(): void {
    this.service.close()
  }
}
