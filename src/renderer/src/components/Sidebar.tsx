import type { AppInfo, TagCount } from '../../../shared/types'
import { IconCalendar, IconDash, IconGear, IconLink, IconNews, IconNotes, IconPlus, IconTag, IconTrash } from '../icons'

export type View = 'calendar' | 'documents' | 'connections'

interface Props {
  view: View
  tagFilter: string | null
  tags: TagCount[]
  info: AppInfo | null
  onView: (v: View) => void
  onTag: (tag: string) => void
  onNew: () => void
  onScratch: () => void
  onSettings: () => void
}

function backupLabel(iso: string | null): string {
  if (!iso) return '마지막 백업: 아직 없음'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `마지막 백업 ${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function Sidebar({ view, tagFilter, tags, info, onView, onTag, onNew, onScratch, onSettings }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-dot" />
        <span className="brand-name">라임 다이어리</span>
      </div>
      <button className="new-btn" onClick={onNew}>
        <IconPlus size={18} /> {view === 'documents' ? '새 문서' : '새 기록'} <kbd>Ctrl+N</kbd>
      </button>
      <div className="nav-scroll">
        <button
          className={`nav-item ${view === 'calendar' ? 'active' : ''}`}
          onClick={() => onView('calendar')}
        >
          <IconCalendar /> 캘린더
        </button>
        <button
          className={`nav-item ${view === 'documents' && !tagFilter ? 'active' : ''}`}
          onClick={() => onView('documents')}
        >
          <IconNotes /> 모든 메모
          {info && <span className="count">{info.documentCount}</span>}
        </button>
        <button className="nav-item" onClick={onScratch} title={info?.scratchShortcut ? `단축키 ${info.scratchShortcut.replace('CommandOrControl', 'Ctrl')}` : '단축키를 등록하지 못했어요. 여기서 열 수 있어요'}>
          <IconPlus size={16} /> 빠른 메모
        </button>

        {tags.length > 0 && <div className="nav-label">태그</div>}
        {tags.slice(0, 12).map((t) => (
          <button
            key={t.tag}
            className={`nav-item tag-item ${view === 'documents' && tagFilter === t.tag ? 'active' : ''}`}
            onClick={() => onTag(t.tag)}
          >
            <IconTag size={16} /> {t.tag}
            <span className="count">{t.count}</span>
          </button>
        ))}

        <div className="nav-label">연결</div>
        <button
          className={`nav-item ${view === 'connections' ? 'active' : ''}`}
          onClick={() => onView('connections')}
        >
          <IconLink size={18} /> 캘린더 연결
          <span className="count">선택</span>
        </button>

        <div className="nav-label">곧 만들 기능</div>
        <button className="nav-item" disabled>
          <IconNews /> 카드뉴스 <span className="soon">준비 중</span>
        </button>
        <button className="nav-item" disabled>
          <IconDash /> 대시보드 <span className="soon">준비 중</span>
        </button>
        <button className="nav-item" disabled>
          <IconTrash /> 휴지통 <span className="soon">준비 중</span>
        </button>
      </div>

      <div className="side-card">
        <div className="ws">개인 워크스페이스</div>
        <div className="meta">{backupLabel(info?.lastBackup ?? null)}</div>
        <button className="settings-btn" onClick={onSettings}>
          <IconGear size={16} /> 설정
        </button>
      </div>
    </aside>
  )
}
