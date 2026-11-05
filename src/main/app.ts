// 앱 전체 상태: 데이터 폴더, 메모 서비스, 백업을 한곳에서 관리한다.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { DiaryService } from './diaryService'
import { NoteIndex } from './index/noteIndex'
import { SettingsStore } from './settings'
import { createBackup, lastBackupIso, lastBackupTime, shouldBackup } from './backup/backup'
import type { AppInfo, WorkspaceInfo } from '../shared/types'

export interface AppPaths {
  settingsFile: string
  documents: string
  portableDir?: string
  envDataDir?: string
  version: string
}

/** 데이터 폴더마다 이 PC에만 두는 파일의 폴더 (설정 파일 옆 local/<폴더 경로 해시>) */
export function localDirFor(settingsFile: string, dataDir: string): string {
  const key = createHash('sha1').update(resolve(dataDir).toLowerCase()).digest('hex').slice(0, 12)
  return join(dirname(settingsFile), 'local', key)
}

export class AppState {
  readonly settings: SettingsStore
  service!: DiaryService
  dataDir = ''
  scratchShortcut: string | null = null

  constructor(private paths: AppPaths) {
    this.settings = new SettingsStore(paths.settingsFile)
    const saved = this.settings.get()
    if (!saved.workspaces?.length) {
      const dataDir = this.resolveDataDir()
      this.settings.update({ workspaceId: 'personal', workspaces: [{ id: 'personal', name: '개인 워크스페이스', dataDir,
        backupDir: saved.backupDir ?? join(dirname(dataDir), 'LimeDiary-backups') }] })
    }
    this.open(this.workspace.dataDir)
  }

  private resolveDataDir(): string {
    const { envDataDir, portableDir, documents } = this.paths
    if (envDataDir) return resolve(envDataDir)
    const saved = this.settings.get().dataDir
    if (saved) return saved
    if (portableDir) return join(portableDir, 'LimeDiary-data')
    return join(documents || homedir(), 'LimeDiary-data')
  }

  get workspace(): WorkspaceInfo {
    const s = this.settings.get()
    return s.workspaces!.find(w => w.id === s.workspaceId) ?? s.workspaces![0]
  }

  get backupDir(): string { return this.workspace.backupDir }

  /**
   * 이 PC에만 두는 파일(검색 색인, Google 일정 임시 파일)의 폴더.
   * 데이터 폴더를 Google Drive에 두고 집·회사 PC가 같이 쓰면, 색인 같은 파일이 서로 덮어써지고
   * 회사 일정이 개인 드라이브로 올라가므로 데이터 폴더 밖(설정 폴더 아래)에 둔다.
   */
  localDirFor(dataDir: string): string {
    return localDirFor(this.paths.settingsFile, dataDir)
  }

  get localDir(): string { return this.localDirFor(this.dataDir) }

  private indexFileFor(dataDir: string): string {
    return join(this.localDirFor(dataDir), 'index.sqlite')
  }

  private openService(dir: string): DiaryService {
    // 예전 버전이 데이터 폴더 안에 둔 Google 일정 임시 파일은 지운다 (다시 받을 수 있고, 회사 일정이 동기화되면 안 됨)
    for (const name of ['cache.json', 'cache.json.tmp']) rmSync(join(dir, 'personal', 'external', name), { force: true })
    return new DiaryService(dir, 'personal', this.indexFileFor(dir))
  }

  private updateWorkspace(patch: Partial<WorkspaceInfo>): void {
    const id = this.workspace.id
    this.settings.update({ workspaces: this.settings.get().workspaces!.map(w => w.id === id ? { ...w, ...patch } : w) })
  }

  createWorkspace(name: string): AppInfo {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) throw new Error('이름은 1~40자로 입력해 주세요')
    const workspaces = this.settings.get().workspaces!
    if (workspaces.some(w => w.name === name.trim())) throw new Error('이미 사용 중인 이름이에요')
    const id = randomUUID()
    const root = join(dirname(this.paths.settingsFile), 'workspaces', id)
    const workspace = { id, name: name.trim(), dataDir: join(root, 'data'), backupDir: join(root, 'backups') }
    mkdirSync(workspace.dataDir, { recursive: true })
    this.settings.update({ workspaces: [...workspaces, workspace] })
    return this.info()
  }

  switchWorkspace(id: string): AppInfo {
    const next = this.settings.get().workspaces!.find(w => w.id === id)
    if (!next) throw new Error('워크스페이스를 찾을 수 없어요')
    if (next.id === this.workspace.id) return this.info()
    this.backupBeforeMigration(next.dataDir)
    const service = this.openService(next.dataDir)
    try { this.settings.update({ workspaceId: id }) } catch (e) { service.close(); throw e }
    this.service.close()
    this.service = service
    this.dataDir = next.dataDir
    return this.info()
  }

  /** 검색 색인 구조가 바뀌어 다시 만들어야 하면, 만들기 전에 백업부터 한다 */
  private backupBeforeMigration(dir: string): void {
    const indexFile = this.indexFileFor(dir)
    if (!NoteIndex.needsMigration(indexFile)) return
    try {
      copyFileSync(indexFile, `${indexFile}.before-migration.bak`)
    } catch {
      /* 색인은 다시 만들 수 있으므로 복사 실패는 넘어간다 */
    }
    const backupDir = this.settings.get().workspaces?.find(w => w.dataDir === dir)?.backupDir ?? this.settings.get().backupDir ?? join(dirname(dir), 'LimeDiary-backups')
    createBackup(dir, backupDir) // 실패하면 예외 → 마이그레이션을 중단해 데이터를 지킨다
  }

  private open(dir: string): void {
    mkdirSync(dir, { recursive: true })
    this.service?.close()
    this.backupBeforeMigration(dir)
    this.dataDir = dir
    this.service = this.openService(dir)
  }

  info(): AppInfo {
    return {
      appVersion: this.paths.version,
      workspaceId: this.workspace.id,
      workspaces: this.settings.get().workspaces!.map(w => ({ ...w })),
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
    this.checkWorkspacePath(target)
    const hasNotes = existsSync(join(target, 'personal', 'notes'))
    if (!hasNotes && existsSync(this.dataDir)) {
      mkdirSync(target, { recursive: true })
      for (const name of readdirSync(this.dataDir)) {
        if (name.startsWith('index.sqlite')) continue
        cpSync(join(this.dataDir, name), join(target, name), { recursive: true })
      }
    }
    this.open(target)
    this.updateWorkspace({ dataDir: target })
  }

  setBackupDir(dir: string): void {
    this.checkWorkspacePath(resolve(dir))
    this.updateWorkspace({ backupDir: resolve(dir) })
  }

  private checkWorkspacePath(target: string): void {
    const overlaps = (a: string, b: string) => {
      a = resolve(a).toLowerCase(); b = resolve(b).toLowerCase()
      return a === b || a.startsWith(b + sep) || b.startsWith(a + sep)
    }
    for (const w of this.settings.get().workspaces!) {
      if (w.id !== this.workspace.id && (overlaps(target, w.dataDir) || overlaps(target, w.backupDir))) {
        throw new Error('다른 워크스페이스의 보관 폴더와 겹칠 수 없어요')
      }
    }
  }

  backupNow(now: Date = new Date()): string | null {
    // 백업은 지우지 않고 계속 쌓는다 (예전에는 최근 30개만 남겼음)
    return createBackup(this.dataDir, this.backupDir, now)
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
