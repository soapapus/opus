// 브라우저에서 화면만 미리 볼 때 쓰는 가짜 api (Electron 안에서는 쓰지 않는다).
import { builtinHolidays } from '../../shared/holidays'
import { changedSince, conflictTitle } from '../../shared/sync'
import { mockWorkspaceFeatures } from './mockWorkspaceFeatures'
import type { AiMessage, CloudState, Api, ConnectionsState, ExternalEvent, Note, NoteSummary, WorkspaceInfo } from '../../shared/types'

export function installMockApi(): void {
  if ((window as unknown as { api?: Api }).api) return
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const ym = `${now.getFullYear()}-${p(now.getMonth() + 1)}`
  const d = (day: number) => `${ym}-${p(day)}`
  const iso = (day: number, hm = '10:00') => `${d(day)}T${hm}:00+09:00`
  let seq = 100
  let notes = new Map<string, Note>()
  const mk = (n: Partial<Note> & { title: string }) => {
    const id = n.id ?? `n${seq++}`
    const body = n.body ?? ''
    notes.set(id, {
      id,
      title: n.title,
      kind: n.kind ?? 'event',
      date: n.date ?? '',
      time: n.time ?? null,
      links: n.links ?? [],
      classified: true,
      tags: n.tags ?? [],
      preview: body.replace(/[#*\-[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80),
      created: n.created ?? iso(1),
      updated: n.updated ?? n.created ?? iso(1),
      body,
      source: 'local'
    })
    return id
  }
  const today = now.getDate()
  mk({ title: '생산 주간회의', date: d(today), time: '14:00', body: '- [ ] 생산 일정 확인\n- [ ] 품질 이슈 공유\n- [x] 지난주 출하 실적 정리', updated: iso(today, '15:10') })
  mk({ title: '1:1 면담', date: d(today), time: '16:30' })
  mk({ title: '오전 출하 검수', date: d(Math.max(1, today - 2)), time: '09:00' })
  mk({ title: '공정 개선 아이디어 정리', kind: 'note', date: d(Math.max(1, today - 1)) })
  mk({ title: '설비 점검', date: d(Math.min(28, today + 1)), time: '10:00' })
  mk({ title: '사이드 프로젝트 데모', date: d(Math.min(28, today + 2)), time: '15:00' })
  mk({ title: '월간 보고 마감', date: d(Math.min(28, today + 6)), time: '18:00' })
  mk({ title: '팀 회식', date: d(Math.min(28, today + 7)), time: '19:00' })
  mk({ title: '헬스', kind: 'note', date: d(Math.min(28, today + 3)) })
  mk({ title: '자격증 공부 2시간', kind: 'note', date: d(Math.max(1, today - 4)) })
  mk({ title: '외부 교육', date: d(Math.max(1, today - 6)), time: '13:00' })
  const doc1 = mk({ title: '2026 하반기 성과 정리', kind: 'document', tags: ['성과'], body: '## 핵심\n- 반복 업무 자동화 — 주 7건 수작업 → 0건\n- 보고서 자동 작성', updated: iso(today, '11:20') })
  mk({ title: '사이드 프로젝트 아이디어', kind: 'document', tags: ['사이드 프로젝트'], body: '사진 찍으면 자동 분류', updated: iso(Math.max(1, today - 2), '14:00') })
  mk({ title: '읽을거리', kind: 'document', tags: ['나중에 읽기'], body: 'Electron 보안 체크리스트, SQLite FTS5 정리', updated: iso(Math.max(1, today - 3), '09:30') })
  mk({ title: '면담 준비 메모', kind: 'document', tags: ['성과'], body: '올해 한 일 3가지, 내년 목표', updated: iso(Math.max(1, today - 1), '21:05') })
  mk({ title: '주간 회고', kind: 'document', tags: [], body: '이번 주 잘한 것 / 아쉬운 것', updated: iso(Math.max(1, today - 5), '18:00') })
  const pinnedPref = [doc1]

  const ext: ExternalEvent[] = [
    { id: 'g1', provider: 'google', calendarId: 'c', calendarName: '업무', title: '협력사 미팅', date: d(Math.min(28, today + 1)), endDate: d(Math.min(28, today + 1)), time: '11:00', allDay: false },
    { id: 'g2', provider: 'google', calendarId: 'c', calendarName: '개인', title: '가족 생일', date: d(Math.min(28, today + 4)), endDate: d(Math.min(28, today + 4)), time: null, allDay: true },
    { id: 'g3', provider: 'google', calendarId: 'c', calendarName: '업무', title: '출장', date: d(Math.min(26, today + 9)), endDate: d(Math.min(28, today + 11)), time: null, allDay: true },
    { id: 'g4', provider: 'google', calendarId: 'c', calendarName: '업무', title: '분기 리뷰', date: d(today), endDate: d(today), time: '10:00', allDay: false }
  ]
  const conn: ConnectionsState = {
    google: { provider: 'google', configured: true, connected: true, account: 'me@gmail.com', capabilities: ['일정 읽기'], lastSync: now.toISOString(), calendars: [{ id: 'c', name: '업무', primary: true, selected: true }], cachedEvents: 4 },
    naver: { provider: 'naver', configured: false, connected: false, capabilities: [] }
  }
  // 화면 설정은 미리보기 탭이 열려 있는 동안 유지 (새로 고침해도 남음)
  let prefs: Record<string, unknown> = { pinned: pinnedPref }
  try {
    const saved = JSON.parse(sessionStorage.getItem('opus-preview-prefs') ?? 'null')
    if (saved && typeof saved === 'object') prefs = saved
  } catch { /* 저장값이 없으면 기본값 */ }
  const filesChanged = new Set<() => void>()
  const sum = (n: Note): NoteSummary => {
    const { body: _b, source: _s, ...rest } = n
    return rest
  }
  const all = () => [...notes.values()]
  const sortCal = (a: Note, b: Note) => (a.date + (a.time ?? '99')).localeCompare(b.date + (b.time ?? '99'))
  let workspaceId = 'personal'
  const workspaces: WorkspaceInfo[] = [{ id: 'personal', name: '개인 워크스페이스', dataDir: 'preview/personal', backupDir: 'preview/personal-backups' }]
  const stores = new Map([['personal', notes]])
  try {
    const saved = JSON.parse(sessionStorage.getItem('opus-preview-workspaces') ?? 'null')
    if (saved) {
      workspaces.splice(0, workspaces.length, ...saved.workspaces)
      stores.clear()
      for (const [id, entries] of saved.stores) stores.set(id, new Map(entries))
      workspaceId = saved.workspaceId
      notes = stores.get(workspaceId)!
      seq = saved.seq
    }
  } catch { /* 미리보기 저장값이 없으면 샘플로 시작 */ }
  const persistWorkspaces = () => sessionStorage.setItem('opus-preview-workspaces', JSON.stringify({
    workspaceId, workspaces, stores: [...stores].map(([id, records]) => [id, [...records]]), seq
  }))
  const info = async () => ({
    workspaceId,
    workspaces: workspaces.map((w) => ({ ...w })),
    appVersion: '0.2.0',
    dataDir: 'C:\\Users\\me\\Documents\\LimeDiary-data',
    backupDir: 'C:\\Users\\me\\Documents\\LimeDiary-backups',
    lastBackup: now.toISOString(),
    totalNotes: notes.size,
    documentCount: all().filter((n) => n.kind === 'document').length,
    scratchShortcut: 'CommandOrControl+Shift+Space'
  })
  const cloudStates = new Map<string, CloudState>()
  const chats = new Map<string, AiMessage[]>()
  const cloudState = (): CloudState => {
    if (!cloudStates.has(workspaceId)) cloudStates.set(workspaceId, { driveConfigured: false, driveConnected: false, autoBackup: false, pendingBackups: 0, aiConfigured: false, aiModel: 'gemini-flash-latest' })
    return cloudStates.get(workspaceId)!
  }
  const previewFolder = { id: 'preview-opus', name: 'Opus 미리보기', mimeType: 'application/vnd.google-apps.folder' }
  const api: Api = {
    ...mockWorkspaceFeatures(() => workspaceId),
    cloudState: async () => ({ ...cloudState() }),
    cloudSaveKeys: async () => { cloudState().driveConfigured = true; conn.google.configured = true; return { ...cloudState() } },
    driveConnect: async (write) => { cloudState().driveConnected = true; conn.google.connected = true; conn.google.writeEnabled = !!write; return { ...cloudState() } },
    driveDisconnect: async () => { cloudState().driveConnected = false; cloudState().autoBackup = false; conn.google.connected = false; return { ...cloudState() } },
    driveFolders: async () => [previewFolder],
    driveSelectFolder: async () => { cloudState().folder = previewFolder; cloudState().autoBackup = false; return { ...cloudState() } },
    driveFiles: async () => [],
    driveAutoBackup: async (on) => { cloudState().autoBackup = on; return { ...cloudState() } },
    driveBackup: async () => { cloudState().lastBackup = new Date().toISOString(); return { ...cloudState() } },
    driveOpen: async () => undefined,
    driveDownload: async () => false,
    driveMergePreview: async () => ({ token: 'preview-merge', added: 2, updated: 1, conflicts: 1, unchanged: 3, archived: 0, aiMessages: 0, aiArchives: 0 }),
    driveMergeApply: async () => ({ token: 'preview-merge', added: 2, updated: 1, conflicts: 1, unchanged: 3, archived: 0, aiMessages: 0, aiArchives: 0 }),
    driveAutoMerge: async (on) => { cloudState().autoMerge = on; if (on) cloudState().autoBackup = true; return { ...cloudState() } },
    aiConfigure: async (key, model) => { if (key.trim()) cloudState().aiConfigured = true; cloudState().aiModel = model; return { ...cloudState() } },
    aiMessages: async () => [...(chats.get(workspaceId) ?? [])],
    aiArchives: async () => [],
    aiSend: async (text) => {
      const history = chats.get(workspaceId) ?? []
      history.push({ role: 'user', text, created: new Date().toISOString() }, { role: 'model', text: '미리보기 응답이에요. 실제 Gemini 호출은 데스크톱 앱에서 이뤄져요.', created: new Date().toISOString() })
      chats.set(workspaceId, history)
      return [...history]
    },
    info,
    createWorkspace: async (name) => {
      if (!name.trim() || workspaces.some(w => w.name === name.trim())) throw new Error('이름을 확인해 주세요')
      const id = `workspace-${seq++}`
      workspaces.push({ id, name: name.trim(), dataDir: `preview/${id}`, backupDir: `preview/${id}-backups` })
      stores.set(id, new Map())
      persistWorkspaces()
      return info()
    },
    renameWorkspace: async (id, name) => {
      const w = workspaces.find((x) => x.id === id)
      if (!w) throw new Error('워크스페이스를 찾을 수 없어요')
      if (!name.trim() || name.trim().length > 40) throw new Error('이름은 1~40자로 입력해 주세요')
      if (workspaces.some((x) => x.id !== id && x.name === name.trim())) throw new Error('이미 사용 중인 이름이에요')
      w.name = name.trim()
      persistWorkspaces()
      return info()
    },
    setWorkspaceEnabled: async (id, enabled) => {
      const w = workspaces.find((x) => x.id === id)
      if (!w) throw new Error('워크스페이스를 찾을 수 없어요')
      if (!enabled && id === workspaceId) throw new Error('지금 쓰는 공간은 끌 수 없어요. 다른 공간으로 전환한 뒤 꺼 주세요')
      w.enabled = enabled
      persistWorkspaces()
      return info()
    },
    switchWorkspace: async (id) => {
      if (!stores.has(id)) throw new Error('워크스페이스를 찾을 수 없어요')
      if (workspaces.find((x) => x.id === id)?.enabled === false) throw new Error('꺼진 공간이에요. 설정에서 켠 뒤 전환해 주세요')
      workspaceId = id
      notes = stores.get(id)!
      persistWorkspaces()
      return info()
    },
    holidays: async (y) => builtinHolidays(y),
    holidayStatus: async () => ({ source: 'builtin', updated: null }),
    refreshHolidays: async () => ({ source: 'builtin', updated: null, error: '미리보기' }),
    useBuiltinHolidays: async () => ({ source: 'builtin', updated: null }),
    prefsGet: async () => prefs,
    prefsSet: async (patch) => {
      prefs = { ...prefs, ...patch }
      try { sessionStorage.setItem('opus-preview-prefs', JSON.stringify(prefs)) } catch { /* 미리보기 저장 실패는 무시 */ }
      return prefs
    },
    notesByMonth: async (m) => all().filter((n) => n.kind !== 'document' && n.date.startsWith(m)).sort(sortCal).map(sum),
    notesByDate: async (day) => all().filter((n) => n.kind !== 'document' && n.date === day).sort(sortCal).map(sum),
    documents: async (tag) =>
      all()
        .filter((n) => n.kind === 'document' && (!tag || n.tags.includes(tag)))
        .sort((a, b) => b.updated.localeCompare(a.updated))
        .map(sum),
    getNote: async (id) => notes.get(id) ?? null,
    createNote: async (input) => {
      const id = mk({ title: input.title ?? '', body: input.body, kind: input.kind, date: input.date, time: input.time ?? null, tags: input.tags, links: input.links, created: new Date().toISOString() })
      persistWorkspaces()
      return notes.get(id)!
    },
    saveNote: async (input) => {
      const n = notes.get(input.id)!
      let conflictCopy: NoteSummary | undefined
      if (changedSince(input.baseUpdated, n.updated)) {
        const id = mk({ ...n, id: undefined, title: conflictTitle(n.title, new Date()), created: new Date().toISOString(), updated: n.updated })
        conflictCopy = sum(notes.get(id)!)
      }
      Object.assign(n, { title: input.title, body: input.body, tags: input.tags, updated: new Date().toISOString() })
      n.preview = input.body.replace(/[#*\-[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
      if (input.time !== undefined) n.time = input.time
      persistWorkspaces()
      return { ...n, conflictCopy }
    },
    deleteNote: async (id) => { notes.delete(id); persistWorkspaces() },
    discardIfEmpty: async (id) => {
      const n = notes.get(id)
      if (n && !n.title.trim() && !n.body.trim()) {
        notes.delete(id)
        return true
      }
      return false
    },
    search: async (q) => all().filter((n) => (n.title + n.body).includes(q)).map(sum),
    tags: async () => {
      const m = new Map<string, number>()
      for (const n of all()) if (n.kind === 'document') for (const t of n.tags) m.set(t, (m.get(t) ?? 0) + 1)
      return [...m.entries()].map(([tag, count]) => ({ tag, count }))
    },
    setKind: async (id, kind) => {
      const n = notes.get(id)!
      n.kind = kind
      return n
    },
    link: async () => undefined,
    unlink: async () => undefined,
    linksOf: async () => [],
    scratchGet: async () => notes.values().next().value as Note,
    scratchSave: async () => undefined,
    scratchToDocument: async () => null,
    scratchHide: async () => undefined,
    scratchOpen: async () => undefined,
    connections: async () => conn,
    externalByMonth: async (m) => ext.filter((e) => e.date.startsWith(m)),
    saveKeys: async () => conn,
    connect: async () => conn,
    disconnect: async () => conn,
    setCalendars: async () => conn,
    syncExternal: async () => conn,
    exportEvent: async () => '',
    chooseDataDir: async () => null,
    chooseBackupDir: async () => null,
    runBackup: info,
    rebuildIndex: info,
    openDataDir: async () => undefined,
    windowControl: async () => undefined,
    onFlushRequest: () => () => undefined,
    onInfoChanged: () => () => undefined,
    onFilesChanged: (handler) => {
      filesChanged.add(handler)
      return () => filesChanged.delete(handler)
    }
  }
  ;(window as unknown as { api: Api }).api = api
  // 화면 테스트용: 다른 PC가 동기화 폴더에서 메모를 고친 것처럼 만든다
  ;(window as unknown as { __otherPcEdit: (idOrTitle: string, body: string) => void }).__otherPcEdit = (idOrTitle, body) => {
    const n = notes.get(idOrTitle) ?? all().find((x) => x.title === idOrTitle)
    if (!n) return
    Object.assign(n, { body, preview: body.slice(0, 80), updated: new Date(Date.now() + 1000).toISOString() })
    filesChanged.forEach((h) => h())
  }
}
