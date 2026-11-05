import { useRef } from 'react'

/**
 * 카드 사이 여백에 있는 투명한 손잡이. 끌면 패널 너비가 바뀌고, 두 번 누르면 기본 너비로 돌아간다.
 * dir: 오른쪽으로 끌 때 너비가 커지면 1(왼쪽 패널), 작아지면 -1(오른쪽 패널)
 */
export function Splitter({
  value,
  min,
  max,
  def,
  dir,
  label,
  onLive,
  onCommit
}: {
  value: number
  min: number
  max: number
  def: number
  dir: 1 | -1
  label: string
  onLive: (v: number) => void
  onCommit: (v: number) => void
}) {
  const start = useRef<{ x: number; v: number } | null>(null)
  const last = useRef(value)
  const clampV = (v: number) => Math.min(max, Math.max(min, Math.round(v)))
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} · 끌어서 너비 조절, 두 번 누르면 기본값`}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, v: value }
        last.current = value
        document.body.classList.add('resizing')
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const v = clampV(start.current.v + dir * (e.clientX - start.current.x))
        if (v !== last.current) {
          last.current = v
          onLive(v)
        }
      }}
      onPointerUp={() => {
        if (!start.current) return
        start.current = null
        document.body.classList.remove('resizing')
        onCommit(last.current)
      }}
      onDoubleClick={() => onCommit(def)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10
        if (e.key === 'ArrowLeft') onCommit(clampV(value - dir * step))
        else if (e.key === 'ArrowRight') onCommit(clampV(value + dir * step))
      }}
    >
      <span className="grip" />
    </div>
  )
}
