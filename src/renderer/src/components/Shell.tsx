import type { ReactNode } from 'react'
import type { AppInfo, ConnectionsState, TagCount } from '../../../shared/types'
import { IconCalendar, IconGear, IconNotes, IconPlus } from '../icons'
import { menuName, type CalView, type Prefs } from '../prefs'
import type { MemoFilter } from './MemoView'

export type View = 'calendar' | 'memo' | 'settings'

export const SETTING_SECTIONS = [
  { id: 'look', label: '화면 · 강조색' },
  { id: 'menu', label: '메뉴 이름' },
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
      {item('calendar', <IconCalendar size={20} />, menuName(prefs, 'calendar'))}
      {item('memo', <IconNotes size={20} />, menuName(prefs, 'memo'))}
      <button className="rail-btn" aria-label={menuName(prefs, 'scratch')} title={`${menuName(prefs, 'scratch')} (Ctrl+Shift+Space)`} onClick={onScratch}>
        <IconQuick />
      </button>
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
  calView,
  memoFilter,
  pinnedCount,
  todayCount,
  docCount,
  settingsSection,
  onView,
  onCalView,
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
  calView: CalView
  memoFilter: MemoFilter
  pinnedCount: number
  todayCount: number
  docCount: number
  settingsSection: string
  onView: (v: View) => void
  onCalView: (v: CalView) => void
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
        <div>
          <b>Opus</b>
          <span>WORKSPACE</span>
        </div>
      </div>

      <div className="ws-scroll">
        <button className={`ws-item ${view === 'calendar' ? 'on' : ''}`} onClick={() => onView('calendar')}>
          {menuName(prefs, 'calendar')}
        </button>
        {view === 'calendar' && (
          <div className="ws-sub">
            {(['month', 'week', 'day'] as CalView[]).map((v) => (
              <button key={v} className={`ws-subitem ${calView === v ? 'on' : ''}`} onClick={() => onCalView(v)}>
                {v === 'month' ? '월 보기' : v === 'week' ? '주 보기' : '일 보기'}
              </button>
            ))}
          </div>
        )}
        <button className={`ws-item ${view === 'memo' ? 'on' : ''}`} onClick={() => onView('memo')}>
          {menuName(prefs, 'memo')}
          <span className="cnt">{docCount}</span>
        </button>
        <button className="ws-item" onClick={onScratch}>
          {menuName(prefs, 'scratch')}
        </button>

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

      <div className="ws-card">
        <div className="av">나</div>
        <div>
          <b>개인 워크스페이스</b>
          <small>{backupLabel(info?.lastBackup)}</small>
        </div>
      </div>
    </aside>
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
