import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppInfo, ConnectionsState, TagCount } from '../../../shared/types'
import { IconCalendar, IconCheck, IconChevronDown, IconGear, IconNotes, IconPlus } from '../icons'
import { initialOf, menuName, menuShown, profileName, type Prefs } from '../prefs'
import type { MemoFilter } from './MemoView'

export type View = 'calendar' | 'memo' | 'settings'

export const SETTING_SECTIONS = [
  { id: 'profile', label: '프로필' },
  { id: 'workspace', label: '워크스페이스' },
  { id: 'menu', label: '메뉴' },
  { id: 'look', label: '화면 · 강조색' },
  { id: 'calendar', label: '캘린더' },
  { id: 'google', label: 'Google 캘린더' },
  { id: 'memo', label: '메모 보관 · 백업' },
  { id: 'about', label: '정보' }
]

function IconQuick({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />
    </svg>
  )
}

/** 신호등: 초록 연결됨 / 노랑 키만 있음(연결 필요) / 회색 꺼짐 */
export function googleSignal(conn: ConnectionsState | null): 'g' | 'y' | 'off' {
  if (!conn) return 'off'
  if (conn.google.connected) return 'g'
  if (conn.google.configured) return 'y'
  return 'off'
}

export function Rail({ view, prefs, onView, onScratch }: { view: View; prefs: Prefs; onView: (v: View) => void; onScratch: () => void }) {
  const item = (v: View, icon: ReactNode, label: string) => (
    <button className={`rail-btn ${view === v ? 'on' : ''}`} aria-label={label} title={label} onClick={() => onView(v)}>
      {icon}
    </button>
  )
  return (
    <nav className="rail" aria-label="주 메뉴">
      <div className="rail-logo" aria-label="Opus">
        O
      </div>
      {menuShown(prefs, 'calendar') && item('calendar', <IconCalendar size={20} />, menuName(prefs, 'calendar'))}
      {menuShown(prefs, 'memo') && item('memo', <IconNotes size={20} />, menuName(prefs, 'memo'))}
      {menuShown(prefs, 'scratch') && (
        <button className="rail-btn" aria-label={menuName(prefs, 'scratch')} title={`${menuName(prefs, 'scratch')} (Ctrl+Shift+Space)`} onClick={onScratch}>
          <IconQuick />
        </button>
      )}
      <span className="spacer" />
      {item('settings', <IconGear size={20} />, menuName(prefs, 'settings'))}
    </nav>
  )
}

function backupLabel(iso: string | null | undefined): string {
  if (!iso) return '백업 아직 없음'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `마지막 백업 ${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function Workspace({
  open,
  view,
  prefs,
  info,
  conn,
  tags,
  memoFilter,
  pinnedCount,
  todayCount,
  docCount,
  settingsSection,
  onView,
  onWorkspace,
  onMemoFilter,
  onNewMemo,
  onScratch,
  onSettings
}: {
  open: boolean
  view: View
  prefs: Prefs
  info: AppInfo | null
  conn: ConnectionsState | null
  tags: TagCount[]
  memoFilter: MemoFilter
  pinnedCount: number
  todayCount: number
  docCount: number
  settingsSection: string
  onView: (v: View) => void
  onWorkspace: (id: string) => void
  onMemoFilter: (f: MemoFilter) => void
  onNewMemo: () => void
  onScratch: () => void
  onSettings: (section: string) => void
}) {
  const sig = googleSignal(conn)
  const isMemo = (f: MemoFilter) =>
    view === 'memo' && memoFilter.mode === f.mode && (f.mode !== 'tag' || (memoFilter.mode === 'tag' && memoFilter.tag === f.tag))
  return (
    <aside className={`ws cardp ${open ? '' : 'closed'}`} aria-hidden={!open}>
      <div className="cardp-h ws-brand">
        <WorkspaceSwitch info={info} onWorkspace={onWorkspace} onManage={() => onSettings('workspace')} />
      </div>

      <div className="ws-scroll">
        {menuShown(prefs, 'calendar') && (
          <button className={`ws-item ${view === 'calendar' ? 'on' : ''}`} onClick={() => onView('calendar')}>
            {menuName(prefs, 'calendar')}
          </button>
        )}
        {menuShown(prefs, 'memo') && (
          <button className={`ws-item ${view === 'memo' ? 'on' : ''}`} onClick={() => onView('memo')}>
            {menuName(prefs, 'memo')}
            <span className="cnt">{docCount}</span>
          </button>
        )}
        {menuShown(prefs, 'scratch') && (
          <button className="ws-item" onClick={onScratch}>
            {menuName(prefs, 'scratch')}
          </button>
        )}

        {view === 'memo' && (
          <>
            <div className="ws-label">개요</div>
            <button className={`ws-item ${isMemo({ mode: 'pinned' }) ? 'on' : ''}`} onClick={() => onMemoFilter({ mode: 'pinned' })}>
              <i className="dot on" /> 진행 중 <span className="cnt">{pinnedCount}</span>
            </button>
            <button className={`ws-item ${isMemo({ mode: 'today' }) ? 'on' : ''}`} onClick={() => onMemoFilter({ mode: 'today' })}>
              <i className="dot hollow" /> 오늘 <span className="cnt">{todayCount}</span>
            </button>
            <button className={`ws-item ${isMemo({ mode: 'all' }) ? 'on' : ''}`} onClick={() => onMemoFilter({ mode: 'all' })}>
              <i className="dot hollow" /> 모든 메모 <span className="cnt">{docCount}</span>
            </button>
            <div className="ws-label">
              프로젝트
              <button className="ws-add" aria-label="새 메모" onClick={onNewMemo}>
                <IconPlus size={14} />
              </button>
            </div>
            {tags.length === 0 && <p className="ws-hint">메모에 태그를 달면 프로젝트로 묶여요</p>}
            {tags.map((t) => (
              <button
                key={t.tag}
                className={`ws-item proj ${isMemo({ mode: 'tag', tag: t.tag }) ? 'on' : ''}`}
                onClick={() => onMemoFilter({ mode: 'tag', tag: t.tag })}
              >
                <i className="sq" /> {t.tag} <span className="cnt">{t.count}</span>
              </button>
            ))}
          </>
        )}

        {view === 'settings' && (
          <>
            <div className="ws-label">설정</div>
            {SETTING_SECTIONS.map((s, i) => (
              <button key={s.id} className={`ws-item num ${settingsSection === s.id ? 'on' : ''}`} onClick={() => onSettings(s.id)}>
                <span className="no">{String(i + 1).padStart(2, '0')}</span> {s.label}
              </button>
            ))}
          </>
        )}

        <div className="ws-label">연동 캘린더</div>
        <button className="ws-item" onClick={() => onSettings('google')} title="설정 › Google 캘린더">
          <i className={`sig ${sig}`} /> Google
          <span className="cnt">{sig === 'g' ? '읽기' : sig === 'y' ? '연결 필요' : '꺼짐'}</span>
        </button>
      </div>

      <button className="ws-card" onClick={() => onSettings('profile')} title={backupLabel(info?.lastBackup)}>
        <Avatar prefs={prefs} size={28} />
        <span className="ws-card-t">
          <b>{profileName(prefs)}</b>
          <small>프로필 · 설정</small>
        </span>
      </button>
    </aside>
  )
}

/** 프로필 사진 (없으면 이름 첫 글자) */
export function Avatar({ prefs, size }: { prefs: Prefs; size: number }) {
  const photo = prefs.profile.photo
  return (
    <span className="av" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {photo ? <img src={photo} alt="" /> : initialOf(profileName(prefs))}
    </span>
  )
}

/** 사이드바 맨 위: 지금 공간 이름을 누르면 켜진 공간 목록이 열리고, 골라서 바로 전환한다 */
function WorkspaceSwitch({ info, onWorkspace, onManage }: { info: AppInfo | null; onWorkspace: (id: string) => void; onManage: () => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const cur = info?.workspaces.find((w) => w.id === info.workspaceId)
  const list = info?.workspaces.filter((w) => w.enabled !== false || w.id === info.workspaceId) ?? []
  return (
    <div className="wss" ref={box}>
      <button className="wss-btn" aria-haspopup="menu" aria-expanded={open} aria-label="워크스페이스 전환" onClick={() => setOpen((o) => !o)}>
        <span className="wss-mark" aria-hidden="true">
          {(cur?.name ?? 'O').slice(0, 1)}
        </span>
        <span className="wss-name">{cur?.name ?? 'Opus'}</span>
        <IconChevronDown size={14} />
      </button>
      {open && (
        <div className="wss-menu" role="menu">
          {list.map((w) => (
            <button
              key={w.id}
              role="menuitemradio"
              aria-checked={w.id === info?.workspaceId}
              className={`wss-opt ${w.id === info?.workspaceId ? 'on' : ''}`}
              onClick={() => {
                setOpen(false)
                onWorkspace(w.id)
              }}
            >
              <span className="wss-name">{w.name}</span>
              {w.id === info?.workspaceId && <IconCheck size={14} />}
            </button>
          ))}
          <div className="wss-sep" />
          <button
            role="menuitem"
            className="wss-opt"
            onClick={() => {
              setOpen(false)
              onManage()
            }}
          >
            워크스페이스 관리
          </button>
        </div>
      )}
    </div>
  )
}

function IconSidebar() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </svg>
  )
}

/** 맨 위 줄: 사이드바 접기 · 위치 표시 · 창 단추 (창을 끌어 옮기는 곳) */
export function TopBar({ crumbs, wsOpen, onToggleWs }: { crumbs: string[]; wsOpen: boolean; onToggleWs: () => void }) {
  return (
    <div className="topbar">
      <button
        className={`tb-toggle ${wsOpen ? 'on' : ''}`}
        aria-label={wsOpen ? '사이드바 접기' : '사이드바 펴기'}
        title={`${wsOpen ? '사이드바 접기' : '사이드바 펴기'} (Ctrl+\\)`}
        onClick={onToggleWs}
      >
        <IconSidebar />
      </button>
      <nav className="crumbs" aria-label="현재 위치">
        {crumbs.map((c, i) => (
          <span key={i} className={i === crumbs.length - 1 ? 'cur' : ''}>
            {c}
          </span>
        ))}
      </nav>
      <span className="spacer" />
      <div className="winbtns">
        <button className="winbtn" aria-label="최소화" onClick={() => void window.api.windowControl('minimize')}>
          <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <button className="winbtn" aria-label="최대화" onClick={() => void window.api.windowControl('maximize')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="1.5" /></svg>
        </button>
        <button className="winbtn close" aria-label="닫기" onClick={() => void window.api.windowControl('close')}>
          <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </div>
  )
}
