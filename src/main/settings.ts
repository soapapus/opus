// 앱 설정(데이터 폴더, 백업 폴더 위치)을 작은 JSON 파일로 기억한다.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Settings {
  workspaces?: import('../shared/types').WorkspaceInfo[]
  workspaceId?: string
  dataDir?: string
  backupDir?: string
  /** 화면 설정 (강조색, 메뉴 이름, 캘린더 보기 등). 화면 쪽에서 모양을 정한다 */
  prefs?: Record<string, unknown>
}

export class SettingsStore {
  private data: Settings = {}

  constructor(private file: string) {
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Settings
        this.data = {
          workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : undefined,
          workspaceId: typeof parsed.workspaceId === 'string' ? parsed.workspaceId : undefined,
          dataDir: typeof parsed.dataDir === 'string' ? parsed.dataDir : undefined,
          backupDir: typeof parsed.backupDir === 'string' ? parsed.backupDir : undefined,
          prefs: parsed.prefs && typeof parsed.prefs === 'object' && !Array.isArray(parsed.prefs) ? parsed.prefs : undefined
        }
      }
    } catch {
      this.data = {}
    }
  }

  get(): Settings {
    return { ...this.data }
  }

  update(patch: Settings): void {
    this.data = { ...this.data, ...patch }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
  }
}

