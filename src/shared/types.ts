// 화면(renderer)과 메인(main)이 함께 쓰는 타입
import type { WorkspaceFeaturesApi } from './workspaceFeatures'

/**
 * 기록의 종류
 * - note: 달력의 날짜별 짧은 기록 (calendar_note)
 * - event: 날짜(와 시간)가 있는 일정 (calendar_event)
 * - document: 날짜와 무관한 독립 문서 (메모장)
 */
export type NoteKind = 'note' | 'event' | 'document'

export interface NoteSummary {
  id: string
  title: string
  kind: NoteKind
  /** 달력에서 이 기록이 속한 날. YYYY-MM-DD. 문서(document)는 빈 문자열 */
  date: string
  /** 일정의 시작 시각 HH:mm (없으면 null) */
  time: string | null
  /** 명시적으로 연결된 다른 기록의 id (연결은 양방향으로 보인다) */
  links: string[]
  /** 종류를 사용자가 확인한 기록인지. false면 예전에 만든 미분류 기록 */
  classified: boolean
  tags: string[]
  preview: string
  /** ISO 시각 (예: 2026-11-05T17:52:00+09:00) */
  created: string
  updated: string
}

export interface Note extends NoteSummary {
  /** 마크다운 본문 */
  body: string
  /** 메모의 출처. 지금은 항상 local, 나중에 google:계정 등으로 확장 */
  source: string
}

export interface TagCount {
  tag: string
  count: number
}

export interface WorkspaceInfo {
  id: string
  name: string
  dataDir: string
  backupDir: string
  /** false면 꺼진 공간: 전환 목록에서 빠지지만 메모·파일은 그대로 남는다 (없으면 켜짐) */
  enabled?: boolean
}

export interface AppInfo {
  workspaceId: string
  workspaces: WorkspaceInfo[]
  appVersion: string
  dataDir: string
  backupDir: string
  lastBackup: string | null
  /** 전체 기록 수 (달력 기록 + 일정 + 문서) */
  totalNotes: number
  /** 메모장(문서) 수 */
  documentCount: number
  /** 빠른 메모 전역 단축키. 다른 프로그램이 쓰고 있어 등록하지 못했으면 null */
  scratchShortcut: string | null
}

export interface CreateNoteInput {
  /** 내부용: 정해진 id로 만들 때 */
  id?: string
  kind?: NoteKind
  /** 문서는 비워 둔다 */
  date: string
  time?: string | null
  /** 이 기록에서 다른 기록으로 거는 연결 */
  links?: string[]
  title?: string
  body?: string
  tags?: string[]
}

export interface SaveNoteInput {
  id: string
  /** 생략하면 기존 값 유지. null이면 시간 지우기 */
  time?: string | null
  title: string
  body: string
  tags: string[]
  /**
   * 편집기가 이 메모를 읽었을 때의 updated 값. 저장하려는 사이에 다른 PC(Google Drive 동기화)에서
   * 파일이 바뀌었으면 덮어쓰기 전에 그 내용을 사본으로 남긴다.
   */
  baseUpdated?: string
}

/** 저장 결과. 다른 PC에서 바뀐 내용을 사본으로 남겼으면 conflictCopy에 그 사본이 온다 */
export type SavedNote = Note & { conflictCopy?: NoteSummary }

export type WindowAction = 'minimize' | 'maximize' | 'close'

/** preload가 화면에 열어 주는 기능 목록 (window.api) */
export interface Api extends WorkspaceFeaturesApi {
  cloudState(): Promise<CloudState>
  cloudSaveKeys(clientId: string, clientSecret: string): Promise<CloudState>
  driveConnect(calendarWrite?: boolean): Promise<CloudState>
  driveDisconnect(): Promise<CloudState>
  driveFolders(): Promise<DriveFile[]>
  driveSelectFolder(id: string): Promise<CloudState>
  driveFiles(): Promise<DriveFile[]>
  driveBackup(): Promise<CloudState>
  driveAutoBackup(enabled: boolean): Promise<CloudState>
  driveOpen(id: string): Promise<void>
  driveDownload(id: string): Promise<boolean>
  driveMergePreview(id: string): Promise<MergeReport>
  driveMergeApply(token: string): Promise<MergeReport>
  driveAutoMerge(enabled: boolean): Promise<CloudState>
  aiConfigure(key: string, model: string): Promise<CloudState>
  aiMessages(): Promise<AiMessage[]>
  aiArchives(): Promise<{ id: string; messages: AiMessage[] }[]>
  aiSend(text: string): Promise<AiMessage[]>
  info(): Promise<AppInfo>
  createWorkspace(name: string): Promise<AppInfo>
  switchWorkspace(id: string): Promise<AppInfo>
  renameWorkspace(id: string, name: string): Promise<AppInfo>
  /** 공간 켜기·끄기. 지금 쓰는 공간은 끌 수 없다. 꺼도 데이터는 지우지 않는다 */
  setWorkspaceEnabled(id: string, enabled: boolean): Promise<AppInfo>
  /** 한국 공휴일 (그 해) */
  holidays(year: number): Promise<import('./holidays').Holiday[]>
  holidayStatus(): Promise<HolidayStatus>
  /** Google 공개 공휴일 달력 받기 (force=false면 하루 한 번만) */
  refreshHolidays(force?: boolean): Promise<HolidayStatus>
  /** 받은 달력을 지우고 앱에 넣어 둔 규칙만 쓰기 */
  useBuiltinHolidays(): Promise<HolidayStatus>
  /** 화면 설정 읽기/쓰기 (settings.json 안에 저장) */
  prefsGet(): Promise<Record<string, unknown>>
  prefsSet(patch: Record<string, unknown>): Promise<Record<string, unknown>>
  notesByMonth(month: string): Promise<NoteSummary[]>
  notesByDate(date: string): Promise<NoteSummary[]>
  /** 메모장(문서)만. 달력 기록은 나오지 않는다 */
  documents(tag?: string): Promise<NoteSummary[]>
  getNote(id: string): Promise<Note | null>
  createNote(input: CreateNoteInput): Promise<Note>
  saveNote(input: SaveNoteInput): Promise<SavedNote>
  deleteNote(id: string): Promise<void>
  discardIfEmpty(id: string): Promise<boolean>
  search(query: string): Promise<NoteSummary[]>
  /** 문서에 붙은 태그 */
  tags(): Promise<TagCount[]>
  setKind(id: string, kind: NoteKind): Promise<Note>
  link(fromId: string, toId: string): Promise<void>
  unlink(a: string, b: string): Promise<void>
  linksOf(id: string): Promise<NoteSummary[]>
  scratchGet(): Promise<Note>
  scratchSave(body: string): Promise<void>
  /** 빠른 메모 내용을 새 문서로 옮기고 비운다 */
  scratchToDocument(): Promise<Note | null>
  scratchHide(): Promise<void>
  /** 빠른 메모 창 열기 (단축키와 같은 동작) */
  scratchOpen(): Promise<void>
  connections(): Promise<ConnectionsState>
  externalByMonth(month: string): Promise<ExternalEvent[]>
  saveKeys(provider: Provider, clientId: string, clientSecret: string): Promise<ConnectionsState>
  connect(provider: Provider, write?: boolean): Promise<ConnectionsState>
  disconnect(provider: Provider): Promise<ConnectionsState>
  setCalendars(ids: string[]): Promise<ConnectionsState>
  syncExternal(): Promise<ConnectionsState>
  /** 내 일정을 외부 캘린더에 추가(내보내기) */
  exportEvent(id: string, provider: Provider): Promise<string>
  chooseDataDir(): Promise<AppInfo | null>
  chooseBackupDir(): Promise<AppInfo | null>
  runBackup(): Promise<AppInfo>
  rebuildIndex(): Promise<AppInfo>
  openDataDir(): Promise<void>
  windowControl(action: WindowAction): Promise<void>
  /** 창을 닫기 전에 저장하지 못한 내용을 저장하라는 요청 */
  onFlushRequest(handler: () => Promise<void> | void): () => void
  /** 백업 등으로 정보가 바뀌었을 때 */
  onInfoChanged(handler: () => void): () => void
  /** 다른 PC(동기화 폴더)에서 메모 파일이 바뀐 것을 찾았을 때 */
  onFilesChanged(handler: () => void): () => void
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  size?: string
  driveId?: string
  appProperties?: Record<string, string>
}
export interface MergeReport {
  token: string
  added: number
  updated: number
  conflicts: number
  unchanged: number
  archived: number
  aiMessages: number
  aiArchives: number
}
export interface AiMessage { role: 'user' | 'model'; text: string; created: string }
export interface CloudState {
  driveConfigured: boolean
  driveConnected: boolean
  driveAccount?: string
  folder?: DriveFile
  autoBackup: boolean
  autoMerge?: boolean
  lastMerge?: string
  pendingBackups: number
  lastBackup?: string
  error?: string
  aiConfigured: boolean
  aiModel: string
}

export type Provider = 'google' | 'naver'

/** 외부 캘린더에서 가져온 일정. 읽기 전용이라 앱에서 고치거나 지울 수 없다. */
export interface ExternalEvent {
  /** provider:calendarId:eventId[:날짜] */
  id: string
  provider: Provider
  calendarId: string
  calendarName: string
  title: string
  /** 이 일정이 걸쳐 있는 첫 날 YYYY-MM-DD */
  date: string
  /** 마지막 날(하루짜리면 date와 같음) */
  endDate: string
  time: string | null
  allDay: boolean
}

export interface ExternalCalendar {
  id: string
  name: string
  primary: boolean
  selected: boolean
}

export interface ProviderState {
  provider: Provider
  /** 사용자가 직접 발급한 클라이언트 키를 입력했는지 */
  configured: boolean
  connected: boolean
  account?: string
  /** 이 서비스가 공식적으로 지원하는 범위 (화면에 그대로 보여 준다) */
  capabilities: string[]
  lastSync?: string
  /** Google: 쓰기 권한을 따로 허용했는지 */
  writeEnabled?: boolean
  calendars?: ExternalCalendar[]
  /** 연결 도중 나온 안내/오류 */
  message?: string
  /** 로컬에 쌓인 외부 일정 수 */
  cachedEvents?: number
}

export interface ConnectionsState {
  google: ProviderState
  naver: ProviderState
}

export interface HolidayStatus {
  source: 'google' | 'builtin'
  updated: string | null
  error?: string
}
