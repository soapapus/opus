import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export function readJson<T>(file: string, initial: () => T): T {
  if (!existsSync(file)) return initial()
  try { return JSON.parse(readFileSync(file, 'utf8')) as T }
  catch { throw new Error('저장된 파일을 읽지 못했어요. 원본을 덮어쓰지 않았어요') }
}
export function writeJson(file: string, data: unknown, history = false): void {
  mkdirSync(dirname(file), { recursive: true })
  if (history && existsSync(file)) {
    const dir = `${file}.history`; mkdirSync(dir, { recursive: true })
    copyFileSync(file, `${dir}/${Date.now()}-${randomUUID()}.json`)
  }
  const temp = `${file}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx' })
  renameSync(temp, file)
}
