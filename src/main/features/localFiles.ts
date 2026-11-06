import { randomUUID, createHash } from 'node:crypto'
import { createReadStream, constants } from 'node:fs'
import { cp, link, lstat, mkdir, readdir, realpath, rename, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FileRef, FileResult, LocalListing, LocalRoot } from '../../shared/workspaceFeatures'
import { readJson, writeJson } from './jsonFile'

export const validFileName = (name: string): boolean => typeof name === 'string' && !!name.trim() && name.length <= 180 && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !/[. ]$/.test(name) && !/^\.{1,2}$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
const within = (root: string, path: string): boolean => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) }
const message = (e: unknown) => e instanceof Error ? e.message : '파일 작업을 마치지 못했어요'

export class LocalFiles {
  private static mutating = false
  private async mutation<T>(work: () => Promise<T>): Promise<T> {
    if (LocalFiles.mutating) throw new Error('다른 파일 작업이 끝난 뒤 다시 시도해 주세요')
    LocalFiles.mutating = true
    try { return await work() } finally { LocalFiles.mutating = false }
  }
  createFolder(parent: FileRef, name: string): Promise<void> { return this.mutation(() => this.createFolderImpl(parent, name)) }
  rename(ref: FileRef, name: string): Promise<void> { return this.mutation(() => this.renameImpl(ref, name)) }
  transfer(sources: FileRef[], destination: FileRef, move: boolean): Promise<FileResult[]> { return this.mutation(() => this.transferImpl(sources, destination, move)) }
  trash(sources: FileRef[]): Promise<FileResult[]> { return this.mutation(() => this.trashImpl(sources)) }

  constructor(private file: string, private trashItem: (path: string) => Promise<void>) {}
  roots(): LocalRoot[] {
    const roots = readJson<LocalRoot[]>(this.file, () => [])
    if (!Array.isArray(roots) || roots.some(r => !r || typeof r.id !== 'string' || typeof r.path !== 'string' || typeof r.name !== 'string' || !isAbsolute(r.path)) || new Set(roots.map(r => r.id)).size !== roots.length) throw new Error('폴더 등록 정보를 확인해 주세요')
    return roots
  }
  async register(path: string): Promise<LocalRoot[]> {
    const canonical = await realpath(path)
    if (!(await lstat(canonical)).isDirectory()) throw new Error('폴더를 선택해 주세요')
    const roots = this.roots()
    if (!roots.some(r => relative(r.path, canonical) === '')) {
      roots.push({ id: randomUUID(), name: basename(canonical) || canonical, path: canonical })
      writeJson(this.file, roots)
    }
    return roots
  }
  remove(id: string): LocalRoot[] { const roots = this.roots().filter(r => r.id !== id); writeJson(this.file, roots); return roots }
  renameRoot(id: string, name: string): LocalRoot[] {
    if (!name.trim() || name.length > 80) throw new Error('표시 이름은 1~80자로 입력해 주세요')
    const roots = this.roots(); const root = roots.find(r => r.id === id)
    if (!root) throw new Error('등록된 폴더를 찾을 수 없어요')
    root.name = name.trim(); writeJson(this.file, roots); return roots
  }
  private async path(ref: FileRef, change = false): Promise<{ root: LocalRoot; path: string }> {
    if (!ref || typeof ref.relativePath !== 'string' || ref.relativePath.includes('\0') || isAbsolute(ref.relativePath)) throw new Error('올바른 폴더 경로가 아니에요')
    const root = this.roots().find(r => r.id === ref.rootId)
    if (!root) throw new Error('먼저 PC 폴더를 등록해 주세요')
    // 등록 당시의 실제 경로 밖으로 바뀐 연결·상위 경로는 허용하지 않는다.
    const rootNow = await realpath(root.path)
    if (relative(root.path, rootNow) !== '') throw new Error('등록한 폴더의 실제 위치가 바뀌었어요. 다시 등록해 주세요')
    const path = resolve(root.path, ref.relativePath || '.')
    if (!within(root.path, path) || !within(root.path, await realpath(path))) throw new Error('등록한 폴더 밖으로 나갈 수 없어요')
    if ((await lstat(path)).isSymbolicLink()) throw new Error('연결된 파일은 원래 폴더를 따로 등록해 주세요')
    if (change && path === root.path) throw new Error('등록한 최상위 폴더 자체는 변경할 수 없어요')
    return { root, path }
  }
  async address(address: string): Promise<FileRef> {
    if (typeof address !== 'string' || !isAbsolute(address)) throw new Error('PC의 전체 폴더 경로를 입력해 주세요')
    const path = resolve(address)
    const roots = this.roots().filter(r => within(r.path, path)).sort((a, b) => b.path.length - a.path.length)
    if (!roots.length) throw new Error('이 경로는 등록된 폴더 밖이에요. 폴더 등록을 먼저 해 주세요')
    const ref = { rootId: roots[0].id, relativePath: relative(roots[0].path, path) }
    const checked = await this.path(ref)
    if (!(await lstat(checked.path)).isDirectory()) throw new Error('폴더 경로를 입력해 주세요')
    return ref
  }
  async list(ref: FileRef): Promise<LocalListing> {
    const { root, path } = await this.path(ref)
    if (!(await lstat(path)).isDirectory()) throw new Error('폴더가 아니에요')
    const entries: LocalListing['entries'] = []
    for (const entry of await readdir(path, { withFileTypes: true })) {
      try {
        const full = join(path, entry.name); const stat = await lstat(full)
        entries.push({ name: entry.name, relativePath: relative(root.path, full), directory: stat.isDirectory(), symbolicLink: stat.isSymbolicLink(), size: stat.size, modified: stat.mtime.toISOString() })
      } catch { /* 탐색 도중 다른 프로그램이 지운 파일은 다음 새로고침에서 확인한다. */ }
    }
    return { root, relativePath: relative(root.path, path), absolutePath: path, entries: entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'ko', { numeric: true })) }
  }
  async openPath(ref: FileRef): Promise<string> { return (await this.path(ref)).path }
  private async createFolderImpl(parent: FileRef, name: string): Promise<void> {
    if (!validFileName(name)) throw new Error('폴더 이름에 사용할 수 없는 문자가 있어요')
    const { path } = await this.path(parent)
    await mkdir(join(path, name)) // 이미 있는 폴더는 덮어쓰지 않는다.
  }
  private async renameImpl(ref: FileRef, name: string): Promise<void> {
    if (!validFileName(name)) throw new Error('파일 이름에 사용할 수 없는 문자가 있어요')
    const { path } = await this.path(ref, true); const destination = join(dirname(path), name)
    if (path === destination) return
    if (relative(path, destination) === '') { await rename(path, destination); return }
    if (await this.exists(destination)) throw new Error('같은 이름의 항목이 있어요. 덮어쓰지 않았어요')
    if ((await lstat(path)).isFile()) {
      try { await link(path, destination) }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('같은 이름의 항목이 있어요. 덮어쓰지 않았어요')
        const before = await this.fingerprint(path)
        await cp(path, destination, { force: false, errorOnExist: true, mode: constants.COPYFILE_EXCL })
        if (before !== await this.fingerprint(destination) || before !== await this.fingerprint(path)) throw new Error('작업 중 원본이 바뀌었어요. 두 파일을 모두 남겼어요')
        await this.trashItem(path)
        return
      }
      await unlink(path) // 새 이름의 하드 링크가 생긴 뒤 예전 이름만 제거한다.
    } else await rename(path, destination)

  }
  private async exists(path: string): Promise<boolean> {
    try { await lstat(path); return true } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e }
  }
  private async fingerprint(path: string): Promise<string> {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error('연결된 파일·폴더가 포함되어 있어 복사하지 않았어요')
    if (stat.isDirectory()) {
      const parts: string[] = []
      for (const name of (await readdir(path)).sort()) parts.push(`${name}:${await this.fingerprint(join(path, name))}`)
      return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
    }
    if (!stat.isFile()) throw new Error('일반 파일과 폴더만 처리할 수 있어요')
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(path)) digest.update(chunk)
    return digest.digest('hex')
  }
  private async copyExclusive(source: string, destination: string): Promise<void> {
    const stat = await lstat(source)
    if (stat.isSymbolicLink()) throw new Error('연결된 파일·폴더는 따라가지 않아요')
    if (stat.isDirectory()) {
      await mkdir(destination) // 다른 프로세스가 먼저 만든 이름도 덮어쓰지 않는다.
      for (const name of await readdir(source)) await this.copyExclusive(join(source, name), join(destination, name))
    } else if (stat.isFile()) await cp(source, destination, { force: false, errorOnExist: true, preserveTimestamps: true, mode: constants.COPYFILE_EXCL })
    else throw new Error('일반 파일과 폴더만 복사할 수 있어요')
  }
  private async transferImpl(sources: FileRef[], destination: FileRef, move: boolean): Promise<FileResult[]> {
    if (!Array.isArray(sources) || !sources.length || sources.length > 500) throw new Error('1~500개 항목을 선택해 주세요')
    const target = await this.path(destination)
    if (!(await lstat(target.path)).isDirectory()) throw new Error('대상 폴더를 선택해 주세요')
    const plans: { source: string; destination: string }[] = []
    for (const ref of sources) {
      const { path } = await this.path(ref, move)
      const dest = join(target.path, basename(path))
      if (within(path, dest)) throw new Error('같은 위치나 자기 하위 폴더로 복사·이동할 수 없어요')
      if (plans.some(p => p.source === path)) continue
      if (plans.some(p => p.destination === dest) || await this.exists(dest)) throw new Error('대상에 같은 이름의 항목이 있어요. 아무것도 덮어쓰지 않았어요')
      if (plans.some(p => within(p.source, path) || within(path, p.source))) throw new Error('상위 폴더와 그 안의 파일을 함께 선택할 수 없어요')
      plans.push({ source: path, destination: dest })
    }
    const results: FileResult[] = []
    for (const p of plans) {
      try {
        const before = await this.fingerprint(p.source)
        await this.copyExclusive(p.source, p.destination)
        if (before !== await this.fingerprint(p.destination) || before !== await this.fingerprint(p.source)) throw new Error('작업 중 원본이 바뀌었어요. 원본과 복사본을 모두 남겼어요')
        // 이동도 검증된 복사 후 원본을 OS 휴지통에 보낸다. 영구 삭제하지 않는다.
        if (move) await this.trashItem(p.source)
        results.push({ ...p, ok: true })
      } catch (e) { results.push({ ...p, ok: false, error: message(e) }) }
    }
    return results
  }
  private async trashImpl(sources: FileRef[]): Promise<FileResult[]> {
    if (!Array.isArray(sources) || !sources.length || sources.length > 500) throw new Error('1~500개 항목을 선택해 주세요')
    const results: FileResult[] = []
    for (const ref of sources) {
      try { const { path } = await this.path(ref, true); await this.trashItem(path); results.push({ source: path, ok: true }) }
      catch (e) { results.push({ source: ref.relativePath, ok: false, error: message(e) }) }
    }
    return results
  }
}
