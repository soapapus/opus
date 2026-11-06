// Drive에는 새 백업만 추가한다. 기존 파일의 수정·삭제 API는 사용하지 않는다.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { AiMessage, CloudState, DriveFile, MergeReport } from '../../shared/types'
import { BackupMerger, type MergePlan } from '../backup/merge'
import type { Vault } from './service'
import type { FetchFn } from './oauth'

const DRIVE = 'https://www.googleapis.com/drive/v3'
interface Pending { path: string; name: string; folderId: string; account?: string; sequence: number }
interface Config {
  folder?: DriveFile
  folderAccount?: string
  autoBackup: boolean
  lastBackup?: string
  lastSnapshot?: string
  pending: Pending[]
  model: string
  deviceId: string
  sequence: number
  autoMerge?: boolean
  lastMerge?: string
  mergedDevices?: Record<string, number>
}
export interface CloudDeps {
  localDir: string
  dataDir: string
  workspaceId?: string
  vault: Vault
  token: () => Promise<string>
  connected: () => boolean
  configured: () => boolean
  account: () => string | undefined
  snapshot: () => string | null
  fetch?: FetchFn
}

export class CloudService {
  private error?: string
  private mergeError?: string
  private backingUp = false
  private chatting = false
  private merging = false
  private preview?: { plan: MergePlan; zip: Uint8Array }
  constructor(private d: CloudDeps) {}
  private get configFile(): string { return join(this.d.localDir, 'cloud.json') }
  private get keyFile(): string { return join(this.d.localDir, 'gemini.bin') }
  private get chatFile(): string { return join(this.d.dataDir, 'personal', 'ai', 'conversation.json') }
  private read<T>(file: string, fallback: T): T {
    if (!existsSync(file)) return fallback
    // 손상된 파일을 빈 데이터로 취급해서 덮어쓰지 않는다.
    return JSON.parse(readFileSync(file, 'utf8')) as T
  }
  private write(file: string, data: unknown): void {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmp, file)
  }
  private config(): Config {
    const existed = existsSync(this.configFile)
    const c = this.read<Config>(this.configFile, { autoBackup: false, pending: [], model: 'gemini-flash-latest', deviceId: randomUUID(), sequence: 0 })
    const migrate = !c.deviceId
    if (migrate) c.deviceId = randomUUID()
    c.sequence ??= 0
    if (!existed || migrate) this.write(this.configFile, c)
    return c
  }
  state(): CloudState {
    const c = this.config()
    return {
      driveConfigured: this.d.configured(), driveConnected: this.d.connected(), driveAccount: this.d.account(),
      folder: c.folder, autoBackup: c.autoBackup, pendingBackups: c.pending.length,
      lastBackup: c.lastBackup, error: this.error ?? this.mergeError, aiConfigured: existsSync(this.keyFile), aiModel: c.model,
      autoMerge: !!c.autoMerge, lastMerge: c.lastMerge
    }
  }
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.d.token()
    const res = await (this.d.fetch ?? fetch)(`${DRIVE}${path}`, {
      ...init, signal: AbortSignal.timeout(60_000),
      headers: { ...init.headers, authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error(`Google Drive 요청 실패 (${res.status}). 권한과 연결을 확인해 주세요`)
    return res
  }
  private async list(q: string, driveId?: string): Promise<DriveFile[]> {
    const all: DriveFile[] = []
    let pageToken = ''
    do {
      const params = new URLSearchParams({ q, spaces: 'drive', pageSize: '100',
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,driveId,appProperties)',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', pageToken })
      if (driveId) { params.set('corpora', 'drive'); params.set('driveId', driveId) }
      const res = await this.request(`/files?${params}`)
      const data = await res.json() as { files?: DriveFile[]; nextPageToken?: string }
      all.push(...data.files ?? [])
      pageToken = data.nextPageToken ?? ''
    } while (pageToken)
    return all.sort((a, b) => a.name.localeCompare(b.name))
  }
  async folders(): Promise<DriveFile[]> {
    const q = "trashed = false and mimeType = 'application/vnd.google-apps.folder'"
    const folders = await this.list(q)
    let pageToken = ''
    do {
      const params = new URLSearchParams({ pageSize: '100', fields: 'nextPageToken,drives(id,name)', pageToken })
      const data = await (await this.request(`/drives?${params}`)).json() as { drives?: { id: string; name: string }[]; nextPageToken?: string }
      for (const drive of data.drives ?? []) {
        // 공유 드라이브 자체의 루트도 백업 대상으로 선택할 수 있다.
        folders.push({ id: drive.id, name: drive.name, mimeType: 'application/vnd.google-apps.folder', driveId: drive.id })
        folders.push(...await this.list(q, drive.id))
      }
      pageToken = data.nextPageToken ?? ''
    } while (pageToken)
    return [...new Map(folders.map(f => [f.id, f])).values()]
  }
  async selectFolder(id: string): Promise<CloudState> {
    if (this.backingUp || this.merging) throw new Error('백업·병합이 끝난 뒤 폴더를 바꿔 주세요')
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('올바른 폴더를 선택해 주세요')
    const params = new URLSearchParams({ fields: 'id,name,mimeType,driveId,capabilities(canAddChildren)', supportsAllDrives: 'true' })
    const folder = await (await this.request(`/files/${id}?${params}`)).json() as DriveFile & { capabilities?: { canAddChildren?: boolean } }
    if (folder.mimeType !== 'application/vnd.google-apps.folder' || !folder.capabilities?.canAddChildren)
      throw new Error('파일을 추가할 수 있는 폴더를 선택해 주세요')
    const c = this.config()
    // 폴더 변경 시 과거 큐는 원래 목적지를 유지하며, 자동 전송은 다시 켜야 한다.
    c.folder = { id: folder.id, name: folder.name, mimeType: folder.mimeType, driveId: folder.driveId }
    c.folderAccount = this.d.account()
    c.autoBackup = false
    c.autoMerge = false
    this.write(this.configFile, c)
    this.error = undefined
    return this.state()
  }
  files(): Promise<DriveFile[]> {
    const folder = this.config().folder
    if (!folder) return Promise.resolve([])
    return this.list(`trashed = false and '${folder.id}' in parents`, folder.driveId)
  }
  setAutoBackup(enabled: boolean): CloudState {
    const c = this.config()
    if (enabled && (!c.folder || !this.d.connected())) throw new Error('Google Drive를 연결하고 백업 폴더를 선택해 주세요')
    c.autoBackup = enabled
    if (!enabled) c.autoMerge = false
    this.write(this.configFile, c)
    return this.state()
  }
  private merger(): BackupMerger { return new BackupMerger(this.d.dataDir, this.d.workspaceId ?? 'personal') }
  private snapshot(): string | null {
    this.merger().capture()
    return this.d.snapshot()
  }
  setAutoMerge(enabled: boolean): CloudState {
    const c = this.config()
    if (enabled && (!c.folder || !this.d.connected())) throw new Error('먼저 Drive 백업 폴더를 연결해 주세요')
    c.autoMerge = enabled
    if (enabled) c.autoBackup = true
    this.write(this.configFile, c)
    return this.state()
  }
  async previewMerge(id: string, automatic = false): Promise<MergeReport> {
    if (this.chatting) throw new Error('AI 답변이 저장된 뒤 병합해 주세요')
    if (this.merging && !automatic) throw new Error('자동 병합이 끝난 뒤 시도해 주세요')
    const file = await this.file(id)
    if (file.mimeType !== 'application/zip' || Number(file.size ?? 0) > 100 * 1024 * 1024) throw new Error('100MB 이하의 Opus ZIP 백업을 선택해 주세요')
    const zip = await this.download(id)
    const plan = this.merger().plan(zip)
    this.preview = { plan, zip }
    return plan.report
  }
  applyMerge(token: string, automatic = false): MergeReport {
    if (this.chatting) throw new Error('AI 답변이 저장된 뒤 병합해 주세요')
    if (this.merging && !automatic) throw new Error('자동 병합이 끝난 뒤 시도해 주세요')
    const p = this.preview
    if (!p || p.plan.report.token !== token) throw new Error('백업 병합 미리보기를 다시 열어 주세요')
    // 병합 전의 전체 상태와 가져온 ZIP을 둘 다 PC에 남긴다.
    const before = this.snapshot()
    if (!before) throw new Error('병합 전 백업을 만들지 못했어요')
    const source = join(dirname(before), `Opus-source-${createHash('sha256').update(p.zip).digest('hex')}.zip`)
    if (!existsSync(source)) writeFileSync(source, p.zip)
    const report = this.merger().apply(p.plan)
    this.preview = undefined
    this.mergeError = undefined
    const c = this.config(); c.lastMerge = new Date().toISOString()
    if (report.added || report.updated || report.conflicts || report.archived || report.aiMessages || report.aiArchives) c.lastSnapshot = undefined
    this.write(this.configFile, c)
    return report
  }
  async mergeAutomatic(): Promise<void> {
    const c = this.config()
    if (!c.autoMerge || !this.d.connected() || this.merging || this.chatting) return
    this.merging = true
    this.mergeError = undefined
    try {
      if (c.folderAccount !== this.d.account()) throw new Error('연결 계정이 바뀌었어요. 백업 폴더를 다시 선택해 주세요')
      // 장치별 단조 증가 번호로 최신 백업을 고른다. PC 시계 차이로 버전을 판정하지 않는다.
      const latest = new Map<string, DriveFile>()
      for (const file of await this.files()) {
        const p = file.appProperties
        if (!p || p.opus !== 'backup-v1' || p.workspace !== (this.d.workspaceId ?? 'personal') || p.device === c.deviceId || !p.device || !/^\d+$/.test(p.sequence ?? '') || !Number.isSafeInteger(Number(p.sequence))) continue
        const previous = latest.get(p.device)
        if (!previous || Number(p.sequence) > Number(previous.appProperties!.sequence)) latest.set(p.device, file)
      }
      for (const [device, file] of latest) {
        const seq = Number(file.appProperties!.sequence)
        if ((this.config().mergedDevices?.[device] ?? -1) >= seq) continue
        // previewMerge의 수동 작업과 겹치지 않도록 다운로드 동안에도 잠근다.
        const report = await this.previewMerge(file.id, true)
        if (!this.config().autoMerge || !this.d.connected()) return
        this.applyMerge(report.token, true)
        const next = this.config(); next.mergedDevices = { ...next.mergedDevices, [device]: seq }; this.write(this.configFile, next)
      }
    } catch (e) { this.mergeError = e instanceof Error ? e.message : '자동 병합하지 못했어요'; throw e }
    finally { this.merging = false }
  }
  async backup(automatic = false): Promise<CloudState> {
    if (this.backingUp) return this.state()
    const initial = this.config()
    if (automatic && (!initial.autoBackup || !this.d.connected())) return this.state()
    if (!initial.folder) throw new Error('설정에서 백업 폴더를 선택해 주세요')
    if (initial.folderAccount !== this.d.account()) throw new Error('연결 계정이 바뀌었어요. 백업 폴더를 다시 선택해 주세요')
    this.backingUp = true
    this.error = undefined
    try {
      // 먼저 로컬 zip을 완성한다. 네트워크 실패·앱 재시작 뒤에도 큐와 원본 zip은 남는다.
      if (!automatic || !initial.lastSnapshot || Date.now() - Date.parse(initial.lastSnapshot) >= 3600_000) {
        const path = this.snapshot()
        if (path) {
          const c = this.config()
          c.sequence++
          c.pending.push({ path, folderId: initial.folder.id, account: this.d.account(), sequence: c.sequence, name: `Opus-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.zip` })
          c.lastSnapshot = new Date().toISOString()
          this.write(this.configFile, c)
        } else if (!initial.pending.length) throw new Error('아직 백업할 기록이 없어요')
      }
      for (const item of [...this.config().pending]) {
        if (item.account !== this.d.account()) throw new Error('다른 계정의 전송 대기 백업이 있어요. 원래 계정으로 연결하면 재시도할 수 있어요')
        const bytes = readFileSync(item.path)
        const boundary = `opus_${randomUUID()}`
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: item.name, parents: [item.folderId], appProperties: { opus: 'backup-v1', workspace: this.d.workspaceId ?? 'personal', device: this.config().deviceId, sequence: String(item.sequence) } })}\r\n--${boundary}\r\nContent-Type: application/zip\r\n\r\n`),
          bytes, Buffer.from(`\r\n--${boundary}--\r\n`)
        ])
        const token = await this.d.token()
        const res = await (this.d.fetch ?? fetch)('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
          method: 'POST', signal: AbortSignal.timeout(120_000),
          headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` }, body
        })
        if (!res.ok) throw new Error(`백업 업로드 실패 (${res.status}). 로컬 백업은 보존되며 다음에 다시 전송해요`)
        const uploaded = await res.json() as { id?: string }
        if (!uploaded.id) throw new Error('백업 완료를 확인하지 못했어요. 로컬 백업은 보존돼요')
        const c = this.config()
        c.pending = c.pending.filter(p => p.name !== item.name)
        c.lastBackup = new Date().toISOString()
        this.write(this.configFile, c)
      }
    } catch (e) { this.error = e instanceof Error ? e.message : '백업하지 못했어요' }
    finally { this.backingUp = false }
    return this.state()
  }
  async file(id: string): Promise<DriveFile> {
    // 선택한 폴더에 실제로 있는 파일만 열거나 내려받는다.
    const file = (await this.files()).find(f => f.id === id)
    if (!file) throw new Error('선택한 폴더에서 자료를 찾을 수 없어요')
    return file
  }
  async download(id: string): Promise<Uint8Array> {
    const file = await this.file(id)
    if (file.mimeType.startsWith('application/vnd.google-apps.')) throw new Error('Google 문서는 자료 열기로 확인해 주세요')
    const res = await this.request(`/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`)
    return new Uint8Array(await res.arrayBuffer())
  }
  configureAi(key: string, model: string): CloudState {
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('올바른 Gemini 모델 이름을 입력해 주세요')
    if (key.trim()) {
      if (!this.d.vault.available()) throw new Error('이 PC에서는 API 키를 안전하게 저장할 수 없어요')
      mkdirSync(dirname(this.keyFile), { recursive: true })
      writeFileSync(`${this.keyFile}.tmp`, this.d.vault.encrypt(key.trim()))
      renameSync(`${this.keyFile}.tmp`, this.keyFile)
    }
    const c = this.config(); c.model = model; this.write(this.configFile, c)
    return this.state()
  }
  messages(): AiMessage[] { return this.read<AiMessage[]>(this.chatFile, []) }
  archives(): { id: string; messages: AiMessage[] }[] {
    const dir = join(this.d.dataDir, 'personal/ai/imports')
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => ({ id: name.slice(0, -5), messages: this.read<AiMessage[]>(join(dir, name), []) }))
  }
  async send(text: string): Promise<AiMessage[]> {
    if (this.chatting) throw new Error('답변을 기다려 주세요')
    if (typeof text !== 'string' || !text.trim() || text.length > 30_000) throw new Error('질문은 1~30,000자로 입력해 주세요')
    if (!existsSync(this.keyFile)) throw new Error('설정에서 Gemini API 키를 입력해 주세요')
    this.chatting = true
    try {
      const history = this.messages()
      history.push({ role: 'user', text: text.trim(), created: new Date().toISOString() })
      this.write(this.chatFile, history) // 요청 실패도 사용자가 쓴 글은 보존한다.
      const base = JSON.stringify(history)
      const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = []
      for (const m of history.slice(-30)) {
        if (!contents.length && m.role === 'model') continue
        const last = contents.at(-1)
        if (last?.role === m.role) last.parts.push({ text: m.text })
        else contents.push({ role: m.role, parts: [{ text: m.text }] })
      }
      const key = this.d.vault.decrypt(readFileSync(this.keyFile))
      const res = await (this.d.fetch ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${this.config().model}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(90_000),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents })
      })
      if (!res.ok) throw new Error(`Gemini 요청 실패 (${res.status}). API 키·모델·사용 한도를 확인해 주세요. 질문은 저장됐어요`)
      const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      const answer = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim()
      if (!answer) throw new Error('답변을 받지 못했어요. 질문은 저장됐어요')
      history.push({ role: 'model', text: answer, created: new Date().toISOString() })
      if (JSON.stringify(this.messages()) !== base) {
        const branch = JSON.stringify(history)
        this.write(join(this.d.dataDir, 'personal/ai/imports', `${createHash('sha256').update(branch).digest('hex')}.json`), history)
        throw new Error('대화가 다른 곳에서 바뀌어 답변을 별도 대화로 보존했어요. AI 대화 선택에서 확인해 주세요')
      }
      this.write(this.chatFile, history)
      return history
    } finally { this.chatting = false }
  }
}
