import { constants, existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { basename, join, relative, isAbsolute, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { emptyBoard, validateBoard } from '../../shared/projects'
import type { ProjectAttachment, ProjectBoard } from '../../shared/workspaceFeatures'
import { readJson, writeJson } from './jsonFile'

export class Projects {
  private file: string
  private attachmentsDir: string
  constructor(dataDir: string) { this.file = join(dataDir, 'personal/projects/board.json'); this.attachmentsDir = join(dataDir, 'personal/projects/attachments') }
  get(): ProjectBoard { const b = readJson(this.file, emptyBoard); validateBoard(b); return b }
  save(board: ProjectBoard): ProjectBoard {
    validateBoard(board)
    const current = this.get()
    if (board.revision !== current.revision) throw new Error('다른 창에서 프로젝트가 바뀌었어요. 입력 내용은 유지했으니 최신 보드를 다시 확인해 주세요')
    for (const key of ['cards', 'columns', 'statuses'] as const) if (current[key].some(old => !board[key].some(n => n.id === old.id))) throw new Error('기록은 삭제하지 않고 보관해 주세요')
    if (!board.columns.some(c => !c.archived)) throw new Error('컬럼은 하나 이상 남겨 주세요')
    const next = structuredClone(board); next.revision = current.revision + 1; next.nextNumber = current.nextNumber
    const now = new Date().toISOString()
    for (const c of next.cards) {
      const old = current.cards.find(x => x.id === c.id)
      c.number = old?.number ?? next.nextNumber++
      c.created = old?.created ?? now
      c.updated = old && JSON.stringify({ ...old, updated: '' }) === JSON.stringify({ ...c, updated: '' }) ? old.updated : now
      for (const a of c.attachments) this.attachmentPath(a.id)
    }
    writeJson(this.file, next, true)
    return next
  }
  async attach(paths: string[]): Promise<ProjectAttachment[]> {
    const result: ProjectAttachment[] = []
    for (const path of paths) {
      const info = await stat(path)
      if (!info.isFile()) throw new Error('일반 파일만 첨부할 수 있어요')
      const id = randomUUID(); const dir = join(this.attachmentsDir, id); await mkdir(dir, { recursive: true })
      await copyFile(path, join(dir, basename(path)), constants.COPYFILE_EXCL)
      result.push({ id, name: basename(path), size: info.size })
    }
    return result
  }
  attachmentPath(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('첨부 파일을 찾을 수 없어요')
    const dir = join(this.attachmentsDir, id)
    if (!existsSync(dir)) throw new Error('첨부 파일이 없어요. 백업에 첨부 자료가 포함됐는지 확인해 주세요')
    const files = readdirSync(dir)
    if (files.length !== 1) throw new Error('첨부 파일 구성을 확인해 주세요')
    const path = realpathSync(join(dir, files[0])); const rel = relative(realpathSync(this.attachmentsDir), path)
    if (isAbsolute(rel) || rel.startsWith(`..${sep}`) || rel === '..') throw new Error('첨부 자료 폴더 밖으로 나갈 수 없어요')
    return path
  }
}
