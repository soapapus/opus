// 드래그 앤 드롭으로 주고받는 정보. 원본은 건드리지 않고 id와 겉모습 정보만 전달한다.
import type { DragEvent } from 'react'
import type { NoteKind, NoteSummary } from '../../shared/types'

export const DND_TYPE = 'application/x-limediary-item'

export interface DragPayload {
  id: string
  kind: NoteKind
  title: string
  date: string
  time: string | null
}

export function startDrag(e: DragEvent, n: NoteSummary): void {
  const payload: DragPayload = { id: n.id, kind: n.kind, title: n.title, date: n.date, time: n.time }
  e.dataTransfer.setData(DND_TYPE, JSON.stringify(payload))
  e.dataTransfer.setData('text/plain', n.title)
  e.dataTransfer.effectAllowed = 'copyLink'
}

export function hasLimeDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(DND_TYPE)
}

export function readDrag(e: DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DND_TYPE)
    return raw ? (JSON.parse(raw) as DragPayload) : null
  } catch {
    return null
  }
}
