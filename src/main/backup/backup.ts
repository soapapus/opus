// 백업: 데이터 폴더를 zip 하나로 묶어 둔다.
// - 색인(index.sqlite)은 다시 만들 수 있어서 뺀다.
// - Google 캘린더에서 읽어 온 일정 임시 파일(personal/external/)은 회사 일정이 섞여 있어 담지 않는다 (AGENTS.md 6장).
// - 백업은 영원히 쌓인다. 오래된 백업을 지우는 기능은 두지 않는다 (주인 결정 2026-11-05).

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { pad2 } from '../../shared/calendar'
import { toLocalIso } from '../../shared/text'

const PREFIX = 'Opus-backup-'
/** 새 이름(Opus-backup-)과 0.3.2까지의 옛 이름(LimeDiary-backup-) 백업을 모두 읽는다 */
const NAME_PATTERN = /^(?:Opus|LimeDiary)-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.zip$/

/** 백업에 담지 않는 폴더 (데이터 폴더 기준 상대 경로) */
const SKIP_DIRS = ['personal/external']

export interface BackupEntry {
  file: string
  path: string
  time: Date
}

export function backupFileName(now: Date): string {
  return (
    `${PREFIX}${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}.zip`
  )
}

function collectFiles(dataDir: string, backupDir: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  const skipDir = resolve(backupDir)
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (resolve(full) === skipDir) continue // 백업 폴더가 데이터 폴더 안에 있어도 자기 자신은 담지 않는다
        if (SKIP_DIRS.includes(relative(dataDir, full).split(sep).join('/'))) continue
        walk(full)
      } else if (entry.isFile()) {
        const name = entry.name
        if (name.startsWith('index.sqlite') || name.endsWith('.tmp')) continue
        files[relative(dataDir, full).split(sep).join('/')] = new Uint8Array(readFileSync(full))
      }
    }
  }
  walk(dataDir)
  return files
}

/** 백업 파일을 만들고 경로를 돌려준다. 담을 파일이 없으면 null. */
export function createBackup(dataDir: string, backupDir: string, now: Date = new Date()): string | null {
  if (!existsSync(dataDir)) return null
  const files = collectFiles(dataDir, backupDir)
  if (Object.keys(files).length === 0) return null
  mkdirSync(backupDir, { recursive: true })
  const target = join(backupDir, backupFileName(now))
  const tmp = `${target}.tmp`
  writeFileSync(tmp, zipSync(files, { level: 6 }))
  renameSync(tmp, target)
  return target
}

/** 백업 파일 목록 (최신순) */
export function listBackups(backupDir: string): BackupEntry[] {
  if (!existsSync(backupDir)) return []
  const entries: BackupEntry[] = []
  for (const file of readdirSync(backupDir)) {
    const m = NAME_PATTERN.exec(file)
    if (!m) continue
    const [, y, mo, d, h, mi, s] = m.map(Number)
    entries.push({ file, path: join(backupDir, file), time: new Date(y, mo - 1, d, h, mi, s) })
  }
  return entries.sort((a, b) => b.time.getTime() - a.time.getTime())
}

export function lastBackupTime(backupDir: string): Date | null {
  return listBackups(backupDir)[0]?.time ?? null
}

export function lastBackupIso(backupDir: string): string | null {
  const time = lastBackupTime(backupDir)
  return time ? toLocalIso(time) : null
}

/** 마지막 백업 후 지정한 시간이 지났으면 true */
export function shouldBackup(last: Date | null, now: Date = new Date(), hours = 24): boolean {
  if (!last) return true
  return now.getTime() - last.getTime() >= hours * 3600 * 1000
}

/** 백업 zip을 대상 폴더에 풀어 놓는다 (이미 있는 파일은 덮어쓴다) */
export function restoreBackup(zipPath: string, targetDir: string): number {
  const files = unzipSync(new Uint8Array(readFileSync(zipPath)))
  const base = resolve(targetDir)
  let count = 0
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue
    const dest = resolve(base, name)
    if (dest !== base && !dest.startsWith(base + sep)) continue // 폴더 밖으로 나가는 경로는 무시
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, data)
    count++
  }
  return count
}

export function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0
  let size = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    size += entry.isDirectory() ? dirSize(full) : statSync(full).size
  }
  return size
}
