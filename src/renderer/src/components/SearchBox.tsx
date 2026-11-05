import { useEffect, useRef, useState } from 'react'
import { formatDateLabel } from '../../../shared/calendar'
import type { NoteSummary } from '../../../shared/types'
import { IconSearch } from '../icons'

export function SearchBox({ onPick }: { onPick: (n: NoteSummary) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<NoteSummary[]>([])
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    const query = q.trim()
    if (!query) {
      setResults([])
      return
    }
    const mine = ++seq.current
    const t = window.setTimeout(async () => {
      const r = await window.api.search(query)
      if (mine === seq.current) {
        setResults(r)
        setHl(0)
      }
    }, 150)
    return () => window.clearTimeout(t)
  }, [q])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (n: NoteSummary) => {
    setOpen(false)
    setQ('')
    onPick(n)
  }

  return (
    <div className="search" ref={box}>
      <span className="s-icon">
        <IconSearch size={17} />
      </span>
      <input
        id="search-input"
        value={q}
        placeholder="메모 검색"
        aria-label="메모 검색"
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            e.currentTarget.blur()
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHl((h) => Math.min(h + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHl((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && results[hl]) {
            pick(results[hl])
          }
        }}
      />
      <kbd>Ctrl K</kbd>
      {open && q.trim() && (
        <div className="search-pop">
          {results.length === 0 && <div className="empty">찾는 메모가 없어요</div>}
          {results.map((n, i) => (
            <button key={n.id} className={`sr-item ${i === hl ? 'hl' : ''}`} onClick={() => pick(n)}>
              <div className="t">
                <span className={`kind-chip ${n.kind}`}>{n.kind === 'document' ? '문서' : n.kind === 'event' ? '일정' : '기록'}</span>{' '}
                {n.title || '제목 없음'}
              </div>
              <div className="d">
                {n.kind === 'document' ? '메모장' : formatDateLabel(n.date)} · {n.preview}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
