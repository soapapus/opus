import type { ReactNode } from 'react'
import { parseDateStr } from '../../../shared/calendar'
import type { Holiday } from '../../../shared/holidays'
import type { NoteSummary } from '../../../shared/types'
import { IconPlus } from '../icons'
import { MiniMonth } from './CalendarView'
import { SearchBox } from './SearchBox'

export type MemoFilter = { mode: 'pinned' | 'today' | 'all' } | { mode: 'tag'; tag: string }

const WD = ['일', '월', '화', '수', '목', '금', '토']
const NO_PROJECT = '분류 없음'

export function filterLabel(f: MemoFilter): string {
  if (f.mode === 'tag') return f.tag
  return f.mode === 'pinned' ? '진행 중' : f.mode === 'today' ? '오늘' : '모든 메모'
}

/** "오늘 14:00", "어제 09:10", "수요일 14:00", "10/21" */
export function when(iso: string, today: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  const t = parseDateStr(today)
  const t0 = new Date(t.year, t.month - 1, t.day).getTime()
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((t0 - d0) / 86400000)
  if (diff === 0) return `오늘 ${hm}`
  if (diff === 1) return `어제 ${hm}`
  if (diff > 1 && diff < 7) return `${WD[d.getDay()]}요일 ${hm}`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function applyMemoFilter(docs: NoteSummary[], f: MemoFilter, pinned: string[], today: string): NoteSummary[] {
  if (f.mode === 'pinned') return docs.filter((d) => pinned.includes(d.id))
  if (f.mode === 'today') return docs.filter((d) => d.updated.slice(0, 10) === today || d.created.slice(0, 10) === today)
  if (f.mode === 'tag') return docs.filter((d) => d.tags.includes(f.tag))
  return docs
}

function groups(list: NoteSummary[], f: MemoFilter): [string, NoteSummary[]][] {
  if (f.mode === 'tag') return [[f.tag, list]]
  const m = new Map<string, NoteSummary[]>()
  for (const d of list) {
    const g = d.tags[0] ?? NO_PROJECT
    m.set(g, [...(m.get(g) ?? []), d])
  }
  return [...m.entries()].sort((a, b) => (a[0] === NO_PROJECT ? 1 : b[0] === NO_PROJECT ? -1 : a[0].localeCompare(b[0], 'ko')))
}

export function MemoView({
  filter,
  list,
  today,
  pinned,
  selectedId,
  editor,
  recent,
  related,
  marks,
  holidays,
  splitter,
  onSelect,
  onNew,
  onPin,
  onSearchPick,
  onPickDate
}: {
  filter: MemoFilter
  list: NoteSummary[]
  today: string
  pinned: string[]
  selectedId: string | null
  editor: ReactNode
  recent: NoteSummary[]
  related: NoteSummary[]
  marks: Set<string>
  holidays: Map<string, Holiday[]>
  splitter: ReactNode
  onSelect: (n: NoteSummary) => void
  onNew: (tag?: string) => void
  onPin: (id: string) => void
  onSearchPick: (n: NoteSummary) => void
  onPickDate: (d: string) => void
}) {
  const gs = groups(list, filter)
  const selectedInList = list.some((d) => d.id === selectedId)
  return (
    <section className="memov">
      <div className="memov-main cardp">
        <header className="cardp-h memov-head">
          <div className="crumb">
            <span className="c0">개요</span>
            <b>{filterLabel(filter)}</b>
            <span className="c2">{list.length}개</span>
          </div>
          <span className="spacer" />
          <SearchBox onPick={onSearchPick} />
          <button
            className="round-add"
            aria-label="새 메모"
            title="새 메모 (Ctrl+N)"
            onClick={() => onNew(filter.mode === 'tag' ? filter.tag : undefined)}
          >
            <IconPlus size={18} />
          </button>
        </header>
        <div className="memov-scroll">
          {list.length === 0 && (
            <div className="memov-empty">
              {filter.mode === 'pinned'
                ? '진행 중인 메모가 없어요. 메모 왼쪽 동그라미를 누르면 여기에 올라와요.'
                : '아직 메모가 없어요. 오른쪽 위 + 로 새 메모를 만들어 보세요.'}
            </div>
          )}
          {!selectedInList && selectedId && editor && <div className="agenda-open solo">{editor}</div>}
          {gs.map(([name, docs]) => (
            <section className="agroup" key={name}>
              <h3>
                <span className="sq" /> {name}
                <span className="n">{docs.length}</span>
              </h3>
              {docs.map((d) =>
                d.id === selectedId && editor ? (
                  <div className="agenda-open" key={d.id}>
                    <button
                      className={`pin ${pinned.includes(d.id) ? 'on' : ''}`}
                      aria-label={pinned.includes(d.id) ? '진행 중에서 내리기' : '진행 중으로 올리기'}
                      onClick={() => onPin(d.id)}
                    />
                    {editor}
                  </div>
                ) : (
                  <div className="arow" key={d.id}>
                    <button
                      className={`pin ${pinned.includes(d.id) ? 'on' : ''}`}
                      aria-label={pinned.includes(d.id) ? '진행 중에서 내리기' : '진행 중으로 올리기'}
                      title={pinned.includes(d.id) ? '진행 중에서 내리기' : '진행 중으로 올리기'}
                      onClick={() => onPin(d.id)}
                    />
                    <button className="arow-b" onClick={() => onSelect(d)}>
                      <span className="at">{d.title || '제목 없음'}</span>
                      <span className="aw">{when(d.updated, today)}</span>
                      {d.preview && <span className="ap">{d.preview}</span>}
                      {d.tags.length > 1 && (
                        <span className="atags">
                          {d.tags.slice(1).map((t) => (
                            <i key={t}>#{t}</i>
                          ))}
                        </span>
                      )}
                    </button>
                  </div>
                )
              )}
            </section>
          ))}
        </div>
      </div>
      {splitter}
      <aside className="memov-side cardp">
        <div className="cardp-h side-h">
          <b>둘러보기</b>
        </div>
        <div className="side-body">
        <MiniMonth date={today} today={today} marks={marks} holidays={holidays} onPick={onPickDate} />
        <div className="side-sec">
          <h4>최근 수정한 메모</h4>
          {recent.length === 0 && <p className="muted small">아직 없어요</p>}
          {recent.map((n) => (
            <button key={n.id} className={`side-item ${n.id === selectedId ? 'on' : ''}`} onClick={() => onSelect(n)}>
              <i className={pinned.includes(n.id) ? 'dot on' : 'dot'} />
              <span>
                {n.title || '제목 없음'}
                <small>{n.tags[0] ?? NO_PROJECT}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="side-sec">
          <h4>관련 메모</h4>
          {!selectedId && <p className="muted small">메모를 고르면 연결된 메모와 같은 프로젝트 메모가 보여요</p>}
          {selectedId && related.length === 0 && <p className="muted small">연결된 메모가 없어요</p>}
          {related.map((n) => (
            <button key={n.id} className="side-item" onClick={() => onSelect(n)}>
              <i className="dot hollow" />
              <span>
                {n.title || '제목 없음'}
                <small>{n.kind === 'document' ? (n.tags[0] ?? NO_PROJECT) : `${n.kind === 'event' ? '일정' : '기록'} · ${n.date}`}</small>
              </span>
            </button>
          ))}
        </div>
        </div>
      </aside>
    </section>
  )
}
