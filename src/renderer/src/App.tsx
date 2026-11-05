import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseDateStr, shiftMonth, todayStr } from '../../shared/calendar'
import type { Holiday } from '../../shared/holidays'
import type { AppInfo, ConnectionsState, ExternalEvent, HolidayStatus, Note, NoteKind, NoteSummary, TagCount } from '../../shared/types'
import { editorHandle } from './bridge'
import type { DragPayload } from './dnd'
import { addDays, CalendarView, holidayOf, toChips, visibleRange, type CalFilter, type Chip } from './components/CalendarView'
import { ConfirmDialog } from './components/Dialogs'
import { DayPanel } from './components/DayPanel'
import { MemoEditor } from './components/MemoEditor'
import { applyMemoFilter, MemoView, type MemoFilter } from './components/MemoView'
import { SettingsView } from './components/SettingsView'
import { ProfileDialog } from './components/SettingsLists'
import { googleSignal, Rail, TopBar, Workspace, type View } from './components/Shell'
import { Splitter } from './components/Splitter'
import { menuName, menuShown, usePrefs, WIDTH, type CalView } from './prefs'

function monthsIn(start: string, end: string): string[] {
  const out: string[] = []
  let { year, month } = parseDateStr(start)
  const last = end.slice(0, 7)
  for (let i = 0; i < 4; i++) {
    const key = `${year}-${String(month).padStart(2, '0')}`
    out.push(key)
    if (key >= last) break
    ;({ year, month } = shiftMonth(year, month, 1))
  }
  return out
}

function uniq<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  return list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
}

export function App() {
  const [prefs, setPrefs, prefsReady] = usePrefs()
  const [today, setToday] = useState(todayStr())
  const [view, setView] = useState<View>('calendar')
  const [calView, setCalView] = useState<CalView>('month')
  const [calFilter, setCalFilter] = useState<CalFilter>('all')
  const [selectedDate, setSelectedDate] = useState(today)
  const [memoFilter, setMemoFilter] = useState<MemoFilter>({ mode: 'all' })
  const [setJump, setSetJump] = useState({ id: 'workspace', n: 0 })
  const [setSection, setSetSection] = useState('workspace')
  const [addRequest, setAddRequest] = useState(0)

  const [items, setItems] = useState<NoteSummary[]>([])
  const [external, setExternal] = useState<ExternalEvent[]>([])
  const [docs, setDocs] = useState<NoteSummary[]>([])
  const [tags, setTags] = useState<TagCount[]>([])
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [conn, setConn] = useState<ConnectionsState | null>(null)

  const [note, setNote] = useState<Note | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  // 다른 PC에서 바뀐 내용을 편집기에 다시 불러올 때 올린다 (편집기를 새로 그림)
  const [editorRev, setEditorRev] = useState(0)
  const [linked, setLinked] = useState<NoteSummary[]>([])
  const [linkTick, setLinkTick] = useState(0)
  const [focusId, setFocusId] = useState<string | null>(null)

  const [holidayList, setHolidayList] = useState<Holiday[]>([])
  const [holidayStatus, setHolidayStatus] = useState<HolidayStatus | null>(null)
  const [holidayTick, setHolidayTick] = useState(0)
  /** 끄는 동안 바뀌는 패널 너비 (놓으면 설정에 저장) */
  const [live_w, setLiveW] = useState<{ ws?: number; day?: number; side?: number }>({})

  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // 설정에 정한 기본 보기로 시작
  const started = useRef(false)
  useEffect(() => {
    if (prefsReady && !started.current) {
      started.current = true
      setCalView(prefs.calDefaultView)
    }
  }, [prefsReady, prefs.calDefaultView])

  const selectedId = note?.id ?? null
  const live = useRef({ view, calView, selectedDate, selectedId, note, today })
  live.current = { view, calView, selectedDate, selectedId, note, today }

  const say = useCallback((text: string) => {
    setToast(text)
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 3200)
  }, [])

  // ---------- 목록 새로 읽기 ----------
  const refreshSeq = useRef(0)
  const refresh = useCallback(async () => {
    const mine = ++refreshSeq.current
    const { calView: cv, selectedDate: sd } = live.current
    const r = visibleRange(cv, sd)
    const months = monthsIn(r.start, r.end)
    const [mi, ex, dc, tg, inf, cn] = await Promise.all([
      Promise.all(months.map((m) => window.api.notesByMonth(m))),
      Promise.all(months.map((m) => window.api.externalByMonth(m))),
      window.api.documents(),
      window.api.tags(),
      window.api.info(),
      window.api.connections()
    ])
    if (mine !== refreshSeq.current) return
    setItems(uniq(mi.flat()))
    setExternal(uniq(ex.flat()))
    setDocs(dc)
    setTags(tg)
    setInfo(inf)
    setConn(cn)
    setLinkTick((t) => t + 1)
  }, [])

  const rangeKey = (() => {
    const r = visibleRange(calView, selectedDate)
    return `${r.start}~${r.end}`
  })()
  useEffect(() => {
    void refresh()
  }, [rangeKey, view, refresh])

  // ---------- 한국 공휴일 ----------
  useEffect(() => {
    if (!prefsReady) return
    let cancelled = false
    const run = prefs.holidayOnline ? window.api.refreshHolidays(false) : window.api.useBuiltinHolidays()
    void run
      .then((st) => {
        if (cancelled) return
        setHolidayStatus(st)
        setHolidayTick((t) => t + 1)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [prefsReady, prefs.holidayOnline])

  const holidayYears = (() => {
    const r = visibleRange(calView, selectedDate)
    return [...new Set([r.start.slice(0, 4), r.end.slice(0, 4), today.slice(0, 4)])].join(',')
  })()
  useEffect(() => {
    let cancelled = false
    void Promise.all(holidayYears.split(',').map((y) => window.api.holidays(Number(y))))
      .then((lists) => !cancelled && setHolidayList(lists.flat()))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [holidayYears, holidayTick])

  const holidays = useMemo(() => {
    const m = new Map<string, Holiday[]>()
    if (!prefs.showHolidays) return m
    for (const h of holidayList) {
      if (h.kind === 'observance' && !prefs.showObservances) continue
      m.set(h.date, [...(m.get(h.date) ?? []), h])
    }
    return m
  }, [holidayList, prefs.showHolidays, prefs.showObservances])

  useEffect(() => {
    const t = window.setInterval(() => setToday(todayStr()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!selectedId) {
      setLinked([])
      return
    }
    void window.api.linksOf(selectedId).then((l) => !cancelled && setLinked(l))
    return () => {
      cancelled = true
    }
  }, [selectedId, linkTick])

  // ---------- 지금 편집 중인 글 정리 ----------
  const leave = useCallback(async () => {
    await editorHandle.current?.flush()
    const id = live.current.selectedId
    if (id) {
      const gone = await window.api.discardIfEmpty(id)
      if (gone) {
        setNote(null)
        live.current.selectedId = null
      }
    }
  }, [])

  const show = useCallback(async (id: string | null, focus = false) => {
    if (!id) {
      setNote(null)
      return
    }
    const n = await window.api.getNote(id)
    setNote(n)
    setFocusId(focus && n ? n.id : null)
  }, [])

  /** 날짜 고르기: 그 날 첫 일정을 오른쪽에 연다 */
  const pickDate = useCallback(
    async (date: string, pickId?: string) => {
      await leave()
      setSelectedDate(date)
      if (pickId) return show(pickId)
      const list = await window.api.notesByDate(date)
      await show(list.find((n) => n.kind !== 'document')?.id ?? null)
    },
    [leave, show]
  )

  const shift = async (dir: -1 | 1) => {
    const { calView: cv, selectedDate: sd, today: t } = live.current
    if (cv === 'day') return pickDate(addDays(sd, dir))
    if (cv === 'week') return pickDate(addDays(sd, dir * 7))
    const { year, month } = parseDateStr(sd)
    const n = shiftMonth(year, month, dir)
    const key = `${n.year}-${String(n.month).padStart(2, '0')}`
    return pickDate(t.startsWith(key) ? t : `${key}-01`)
  }

  const goToday = async () => {
    setView('calendar')
    await pickDate(live.current.today)
    void refresh()
  }

  const changeView = async (v: View) => {
    if (v === live.current.view) return
    await leave()
    setView(v)
    if (v === 'calendar') await pickDate(live.current.selectedDate)
    else setNote(null)
  }

  const openChip = async (c: Chip) => {
    if (c.note) {
      if (c.note.id === live.current.selectedId) return
      await pickDate(c.date, c.note.id)
    } else {
      await pickDate(c.date)
      say('Google 일정은 읽기 전용이에요. 메모는 내 일정에 남겨 주세요')
    }
  }

  /** 검색 등에서 항목 열기 */
  const openSummary = async (n: NoteSummary) => {
    if (n.id === live.current.selectedId) return
    await leave()
    if (n.kind === 'document') {
      setView('memo')
      await show(n.id)
    } else {
      setView('calendar')
      await pickDate(n.date, n.id)
    }
    void refresh()
  }

  const createItem = async (input: { kind: NoteKind; date: string; title?: string; time?: string | null; tags?: string[] }) => {
    await leave()
    const created = await window.api.createNote({
      kind: input.kind,
      date: input.kind === 'document' ? '' : input.date,
      title: input.title,
      time: input.time ?? null,
      tags: input.tags
    })
    if (input.kind !== 'document') setSelectedDate(input.date)
    setNote(created)
    setFocusId(input.title ? null : created.id)
    void refresh()
    return created
  }

  const newMemo = async (tag?: string) => {
    setView('memo')
    const c = await createItem({ kind: 'document', date: '', tags: tag ? [tag] : undefined })
    if (memoFilter.mode === 'pinned') setPrefs({ pinned: [...prefs.pinned, c.id] })
    if (memoFilter.mode === 'today' || memoFilter.mode === 'pinned') return
    if (memoFilter.mode === 'tag' && !tag) setMemoFilter({ mode: 'all' })
  }

  const togglePin = (id: string) => {
    const on = prefs.pinned.includes(id)
    setPrefs({ pinned: on ? prefs.pinned.filter((x) => x !== id) : [...prefs.pinned, id] })
    say(on ? '진행 중에서 내렸어요' : '진행 중에 올렸어요')
  }

  const doDelete = async () => {
    setConfirmDelete(false)
    const cur = live.current.note
    if (!cur) return
    await editorHandle.current?.flush()
    await window.api.deleteNote(cur.id)
    setNote(null)
    if (prefs.pinned.includes(cur.id)) setPrefs({ pinned: prefs.pinned.filter((x) => x !== cur.id) })
    void refresh()
    say('지웠어요 (보관 폴더의 .trash에서 꺼낼 수 있어요)')
  }

  const changeKind = async (kind: NoteKind) => {
    const cur = live.current.note
    if (!cur) return
    await editorHandle.current?.flush()
    const next = await window.api.setKind(cur.id, kind)
    if (kind === 'document') {
      setView('memo')
      setNote(next)
      say('메모장으로 옮겼어요. 캘린더에는 더 이상 나오지 않아요')
    } else {
      setView('calendar')
      setSelectedDate(next.date)
      setNote(next)
      say('캘린더 기록으로 옮겼어요')
    }
    void refresh()
  }

  const unlink = async (otherId: string) => {
    const cur = live.current.note
    if (!cur) return
    await window.api.unlink(cur.id, otherId)
    say('연결을 끊었어요. 원본은 그대로 남아 있어요')
    void refresh()
  }

  const makeEventFromDoc = async (date: string) => {
    const cur = live.current.note
    if (!cur) return
    await editorHandle.current?.flush()
    const saved = await window.api.getNote(cur.id)
    await window.api.createNote({ kind: 'event', date, title: saved?.title.trim() || '메모', links: [cur.id] })
    const d = parseDateStr(date)
    say(`${d.month}월 ${d.day}일에 일정을 만들었어요. 메모는 그대로예요`)
    void refresh()
  }

  const dropOnDoc = async (payload: DragPayload) => {
    const cur = live.current.note
    if (!cur || cur.kind !== 'document' || payload.kind === 'document') return
    const d = payload.date ? parseDateStr(payload.date) : null
    const w = d ? ` (${d.month}/${d.day}${payload.time ? ` ${payload.time}` : ''})` : ''
    editorHandle.current?.insertTask(`${payload.title}${w}`)
    await window.api.link(cur.id, payload.id)
    void refresh()
  }

  // ---------- 워크스페이스 전환: 지금 글을 저장하고, 공간을 바꾼 뒤 화면을 다시 연다 ----------
  const switchWorkspace = async (id: string) => {
    if (busy || id === info?.workspaceId) return
    setBusy(true)
    try {
      await leave()
      ++refreshSeq.current
      await window.api.switchWorkspace(id)
      window.location.reload()
    } catch (e) {
      const m = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''
      say(m || '전환하지 못했어요. 저장 상태를 확인하고 다시 시도해 주세요')
      setBusy(false)
    }
  }

  // 숨긴 메뉴를 보고 있으면 보이는 첫 메뉴로 옮긴다 (설정은 항상 보임)
  useEffect(() => {
    if (view === 'settings' || menuShown(prefs, view)) return
    const next = (['calendar', 'memo'] as const).find((v) => menuShown(prefs, v)) ?? 'settings'
    void changeView(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, prefs.menuHidden])

  // ---------- 시작·종료·단축키 ----------
  useEffect(() => {
    void pickDate(todayStr())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => window.api.onFlushRequest(async () => leave()), [leave])
  useEffect(() => window.api.onInfoChanged(() => void refresh()), [refresh])
  // 다른 PC(Google Drive 동기화)에서 메모가 바뀌면 목록을 다시 읽고, 열린 메모도 저장 안 한 글이 없으면 새로 불러온다
  useEffect(
    () =>
      window.api.onFilesChanged(async () => {
        void refresh()
        const cur = live.current.note
        const handle = editorHandle.current
        if (!cur || !handle || handle.isDirty()) return
        const fresh = await window.api.getNote(cur.id)
        if (!fresh || fresh.updated === handle.baseUpdated() || handle.isDirty()) return
        if (live.current.note?.id !== cur.id) return
        setNote(fresh)
        setEditorRev((n) => n + 1)
        say('다른 PC에서 고친 내용을 불러왔어요')
      }),
    [refresh, say]
  )

  const toggleRef = useRef<(w: 'ws' | 'day') => void>(() => undefined)
  toggleRef.current = (w) => (w === 'ws' ? setPrefs({ wsOpen: !prefs.wsOpen }) : setPrefs({ dayOpen: !prefs.dayOpen }))

  const hotkey = useRef<() => void>(() => undefined)
  hotkey.current = () => {
    if (live.current.view === 'memo') void newMemo(memoFilter.mode === 'tag' ? memoFilter.tag : undefined)
    else {
      setView('calendar')
      setAddRequest((n) => n + 1)
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const k = e.key.toLowerCase()
      if (k === '\\') {
        e.preventDefault()
        toggleRef.current('ws')
        return
      }
      if (k === '.') {
        e.preventDefault()
        toggleRef.current('day')
        return
      }
      if (k === 'n') {
        e.preventDefault()
        hotkey.current()
      } else if (k === 'k') {
        e.preventDefault()
        const el = document.getElementById('search-input') as HTMLInputElement | null
        el?.focus()
        el?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---------- 설정 동작 ----------
  const settingsAction = async (fn: () => Promise<AppInfo | null>, done?: string, reload = false) => {
    setBusy(true)
    try {
      const r = await fn()
      if (r) {
        setInfo(r)
        if (reload) {
          setNote(null)
          await pickDate(live.current.today)
        }
        await refresh()
        if (done) say(done)
      }
    } catch {
      say('작업하지 못했어요. 다시 시도해 주세요')
    } finally {
      setBusy(false)
    }
  }

  const openSettings = async (id: string) => {
    if (live.current.view !== 'settings') {
      await leave()
      setNote(null)
      setView('settings')
    }
    setSetSection(id)
    setSetJump((j) => ({ id, n: j.n + 1 }))
  }

  // ---------- 화면에 쓸 값 ----------
  const dayChips = useMemo(
    () => toChips(items, external, 'all', prefs.showGoogle).filter((c) => c.date === selectedDate),
    [items, external, prefs.showGoogle, selectedDate]
  )
  const docIds = useMemo(() => new Set(docs.map((d) => d.id)), [docs])
  const pinned = useMemo(() => prefs.pinned.filter((id) => docIds.has(id)), [prefs.pinned, docIds])
  const memoList = useMemo(() => applyMemoFilter(docs, memoFilter, pinned, today), [docs, memoFilter, pinned, today])
  const recent = useMemo(() => [...docs].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 6), [docs])
  const related = useMemo(() => {
    if (!note) return []
    const proj = note.tags[0]
    const same = proj ? docs.filter((d) => d.id !== note.id && d.tags[0] === proj) : []
    return uniq([...linked, ...same]).slice(0, 8)
  }, [note, linked, docs])
  const marks = useMemo(() => new Set(items.filter((n) => n.kind === 'event').map((n) => n.date)), [items])
  const todayCount = applyMemoFilter(docs, { mode: 'today' }, pinned, today).length

  const editorFor = (wantDoc: boolean) => {
    if (!note || (note.kind === 'document') !== wantDoc) return null
    return (
      <MemoEditor
        key={`${note.id}:${editorRev}`}
        note={note}
        autoFocusTitle={focusId === note.id}
        linked={linked}
        onSaved={(saved) => {
          if (saved.conflictCopy) say(`다른 PC에서 고친 내용은 '${saved.conflictCopy.title}' 메모로 남겼어요`)
          void refresh()
        }}
        onDelete={() => setConfirmDelete(true)}
        onOpenLinked={(id) => {
          const l = linked.find((x) => x.id === id)
          if (l) void openSummary(l)
        }}
        onUnlink={(id) => void unlink(id)}
        onKind={(k) => void changeKind(k)}
        onMakeEvent={(d) => void makeEventFromDoc(d)}
        onDropItem={(p) => void dropOnDoc(p)}
        exportTargets={[]}
        onExport={() => undefined}
      />
    )
  }

  const wsW = live_w.ws ?? prefs.wsWidth
  const dayW = live_w.day ?? prefs.dayWidth
  const crumbs = [
    'Opus',
    view === 'calendar' ? menuName(prefs, 'calendar') : view === 'memo' ? menuName(prefs, 'memo') : menuName(prefs, 'settings'),
    ...(view === 'memo' ? [memoFilter.mode === 'tag' ? memoFilter.tag : memoFilter.mode === 'pinned' ? '진행 중' : memoFilter.mode === 'today' ? '오늘' : '모든 메모'] : []),
    ...(view === 'calendar' ? [calView === 'month' ? '월' : calView === 'week' ? '주' : '일'] : [])
  ]

  return (
    <div
      className={`app2 view-${view} ${prefs.wsOpen ? '' : 'ws-closed'} ${prefs.dayOpen ? '' : 'day-closed'}`}
      style={{ ['--ws-w' as string]: `${prefs.wsOpen ? wsW : 0}px`, ['--day-w' as string]: `${dayW}px`, ['--side-w' as string]: `${prefs.sideWidth}px` }}
    >
      <Rail view={view} prefs={prefs} onView={(v) => void changeView(v)} onScratch={() => void window.api.scratchOpen()} />
      <TopBar crumbs={crumbs} wsOpen={prefs.wsOpen} onToggleWs={() => toggleRef.current('ws')} />
      <Workspace
        open={prefs.wsOpen}
        view={view}
        prefs={prefs}
        info={info}
        conn={conn}
        tags={tags}
        memoFilter={memoFilter}
        pinnedCount={pinned.length}
        todayCount={todayCount}
        docCount={docs.length}
        settingsSection={setSection}
        onView={(v) => void changeView(v)}
        onWorkspace={(id) => void switchWorkspace(id)}
        onProfile={() => setProfileOpen(true)}
        onMemoFilter={async (f) => {
          await leave()
          setNote(null)
          setMemoFilter(f)
        }}
        onNewMemo={() => void newMemo(memoFilter.mode === 'tag' ? memoFilter.tag : undefined)}
        onScratch={() => void window.api.scratchOpen()}
        onSettings={(id) => void openSettings(id)}
      />
      {prefs.wsOpen ? (
        <Splitter
          label="사이드바 너비"
          value={wsW}
          {...WIDTH.ws}
          dir={1}
          onLive={(v) => setLiveW((w) => ({ ...w, ws: v }))}
          onCommit={(v) => {
            setLiveW((w) => ({ ...w, ws: undefined }))
            setPrefs({ wsWidth: v })
          }}
        />
      ) : (
        <div className="splitter off" />
      )}

      <main className="main2">
        {view === 'calendar' && (
          <div className="cal-layout">
            <CalendarView
              prefs={prefs}
              view={calView}
              filter={calFilter}
              today={today}
              selected={selectedDate}
              selectedId={selectedId}
              items={items}
              external={external}
              googleOn={googleSignal(conn) === 'g'}
              addRequest={addRequest}
              holidays={holidays}
              dayOpen={prefs.dayOpen}
              onToggleDay={() => toggleRef.current('day')}
              onView={setCalView}
              onFilter={setCalFilter}
              onSelect={(d) => void pickDate(d)}
              onOpen={(c) => void openChip(c)}
              onShift={(d) => void shift(d)}
              onToday={() => void goToday()}
              onAdd={(v) => void createItem({ kind: v.kind, date: v.date, title: v.title, time: v.time })}
              onSearchPick={(n) => void openSummary(n)}
            />
            {prefs.dayOpen ? (
              <Splitter
                label="오른쪽 패널 너비"
                value={dayW}
                {...WIDTH.day}
                dir={-1}
                onLive={(v) => setLiveW((w) => ({ ...w, day: v }))}
                onCommit={(v) => {
                  setLiveW((w) => ({ ...w, day: undefined }))
                  setPrefs({ dayWidth: v })
                }}
              />
            ) : (
              <div className="splitter off" />
            )}
            <DayPanel
              holiday={holidayOf(holidays, selectedDate)}
              date={selectedDate}
              chips={dayChips}
              selectedId={selectedId}
              memoLabel={prefs.dayMemoLabel.trim() || '회의 메모'}
              onOpen={(c) => void openChip(c)}
              onQuick={(title, time) => void createItem({ kind: 'event', date: live.current.selectedDate, title, time })}
            >
              {editorFor(false) ?? (
                <div className="dayp-hint">
                  일정을 고르면 여기에 메모를 남길 수 있어요.
                  <br />
                  쓰는 동안 자동으로 저장돼요.
                </div>
              )}
            </DayPanel>
          </div>
        )}

        {view === 'memo' && (
          <MemoView
            onScheduleTask={async (id, title, date) => {
              await editorHandle.current?.flush()
              await window.api.createNote({ kind: 'event', date, title, links: [id] })
              await refresh()
            }}
            filter={memoFilter}
            list={memoList}
            today={today}
            pinned={pinned}
            selectedId={note?.kind === 'document' ? selectedId : null}
            editor={editorFor(true)}
            recent={recent}
            related={related}
            marks={marks}
            holidays={holidays}
            onSelect={(n) => void openSummary(n)}
            onNew={(tag) => void newMemo(tag)}
            onPin={togglePin}
            onSearchPick={(n) => void openSummary(n)}
            onPickDate={async (d) => {
              await pickDate(d)
              setView('calendar')
            }}
          />
        )}

        {view === 'settings' && (
          <SettingsView
            onWorkspace={(id) => void switchWorkspace(id)}
            prefs={prefs}
            onPrefs={setPrefs}
            info={info}
            busy={busy}
            jump={setJump}
            onSection={setSetSection}
            onChooseData={async () => {
              await leave()
              await settingsAction(() => window.api.chooseDataDir(), '메모 폴더를 바꿨어요', true)
            }}
            onChooseBackup={() => void settingsAction(() => window.api.chooseBackupDir(), '백업 폴더를 바꿨어요')}
            onOpenData={() => void window.api.openDataDir()}
            onBackup={() => void settingsAction(() => window.api.runBackup(), '백업했어요')}
            onRebuild={() => void settingsAction(() => window.api.rebuildIndex(), '검색 목록을 다시 만들었어요')}
            onConnChanged={() => void refresh()}
            holidayStatus={holidayStatus}
            onHolidayRefresh={async () => {
              const st = await window.api.refreshHolidays(true)
              setHolidayStatus(st)
              setHolidayTick((t) => t + 1)
              say(st.error ? `받지 못했어요 (${st.error}). 내장 규칙으로 보여 드려요` : '공휴일 달력을 새로 받았어요')
            }}
          />
        )}
      </main>

      {confirmDelete && (
        <ConfirmDialog
          title="이 기록을 지울까요?"
          message="지운 기록은 보관 폴더의 .trash 폴더로 옮겨져요. 연결된 다른 기록은 지워지지 않아요."
          confirmLabel="지우기"
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {profileOpen && (
        <ProfileDialog
          prefs={prefs}
          onClose={() => setProfileOpen(false)}
          onSave={(profile) => {
            setPrefs({ profile })
            setProfileOpen(false)
            say('프로필을 저장했어요')
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
