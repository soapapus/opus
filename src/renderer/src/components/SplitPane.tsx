import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

const MIN = 0.15
const MAX = 0.85

/** 화면 비율을 기억하는 상태 (기억 장소를 못 쓰는 환경에서도 동작) */
export function useSplitRatio(key: string, fallback: number): [number, (r: number) => void] {
  const [ratio, setRatio] = useState(() => {
    try {
      const v = Number(window.localStorage.getItem(`ld.split.${key}`))
      return v >= MIN && v <= MAX ? v : fallback
    } catch {
      return fallback
    }
  })
  const set = useCallback(
    (r: number) => {
      const next = Math.min(MAX, Math.max(MIN, r))
      setRatio(next)
      try {
        window.localStorage.setItem(`ld.split.${key}`, String(next))
      } catch {
        /* 저장하지 못해도 화면은 정상 동작 */
      }
    },
    [key]
  )
  return [ratio, set]
}

export const PRESETS: { label: string; left: number }[] = [
  { label: '70:30', left: 0.7 },
  { label: '50:50', left: 0.5 },
  { label: '20:80', left: 0.2 }
]

export function LayoutPresets({ ratio, onPick }: { ratio: number; onPick: (r: number) => void }) {
  return (
    <div className="presets" role="group" aria-label="화면 비율">
      {PRESETS.map((p) => (
        <button
          key={p.label}
          className={`preset ${Math.abs(ratio - p.left) < 0.015 ? 'on' : ''}`}
          onClick={() => onPick(p.left)}
          title={`왼쪽 ${p.label.split(':')[0]}% : 오른쪽 ${p.label.split(':')[1]}%`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

interface Props {
  ratio: number
  defaultRatio: number
  onRatio: (r: number) => void
  left: ReactNode
  right: ReactNode
}

/** 좌우로 나뉜 화면. 가운데 손잡이를 끌거나 방향키로 비율을 바꾼다. */
export function SplitPane({ ratio, defaultRatio, onRatio, left, right }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const move = useCallback(
    (clientX: number) => {
      const el = box.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      onRatio((clientX - rect.left) / rect.width)
    },
    [onRatio]
  )

  useEffect(() => {
    if (!dragging) return
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging])

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') onRatio(ratio - 0.03)
    else if (e.key === 'ArrowRight') onRatio(ratio + 0.03)
    else if (e.key === 'Home') onRatio(defaultRatio)
    else return
    e.preventDefault()
  }

  return (
    <div
      className="split"
      ref={box}
      style={{ gridTemplateColumns: `minmax(0, ${ratio}fr) 14px minmax(0, ${1 - ratio}fr)` }}
    >
      <div className="split-pane">{left}</div>
      <div
        className={`split-handle ${dragging ? 'drag' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(ratio * 100)}
        aria-label="화면 크기 조절 (끌거나 좌우 방향키, 더블클릭하면 처음 비율)"
        tabIndex={0}
        onKeyDown={onKey}
        onDoubleClick={() => onRatio(defaultRatio)}
        onPointerDown={(e: PointerEvent) => {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          setDragging(true)
          move(e.clientX)
        }}
        onPointerMove={(e: PointerEvent) => dragging && move(e.clientX)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <span className="grip" />
      </div>
      <div className="split-pane">{right}</div>
    </div>
  )
}
