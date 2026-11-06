import { isDateStr } from './calendar'
import type { ProjectBoard } from './workspaceFeatures'

export function emptyBoard(): ProjectBoard {
  return { revision: 0, nextNumber: 1,
    statuses: [{ id: 'open', name: '진행 전', color: '#3d6aa8' }, { id: 'pending', name: '보류', color: '#8a6a28' }, { id: 'closed', name: '완료', color: '#378359' }],
    columns: [
      { id: 'todo', name: '할 일', statusId: 'open', archived: false },
      { id: 'pending', name: '보류', statusId: 'pending', archived: false },
      { id: 'review', name: '검토 중', statusId: 'open', archived: false },
      { id: 'doing', name: '진행 중', statusId: 'open', archived: false },
      { id: 'done', name: '완료', statusId: 'closed', archived: false }
    ], cards: [] }
}
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v)
const text = (v: unknown, max: number, empty = false): v is string => typeof v === 'string' && v.length <= max && (empty || !!v.trim())
export function validateBoard(value: unknown): asserts value is ProjectBoard {
  const b = value as ProjectBoard
  if (!b || !Number.isSafeInteger(b.revision) || b.revision < 0 || !Number.isSafeInteger(b.nextNumber) || b.nextNumber < 1 || !Array.isArray(b.statuses) || !Array.isArray(b.columns) || !Array.isArray(b.cards) || !b.statuses.length || b.statuses.length > 50 || !b.columns.length || b.columns.length > 100 || b.cards.length > 10000) throw new Error('프로젝트 보드 형식이나 항목 수를 확인해 주세요')
  const unique = (ids: string[]) => new Set(ids).size === ids.length
  if (!unique(b.statuses.map(s => s.id)) || !unique(b.columns.map(c => c.id)) || !unique(b.cards.map(c => c.id))) throw new Error('같은 ID의 항목이 둘 이상 있어요')
  for (const s of b.statuses) if (!id(s.id) || !text(s.name, 40) || !/^#[a-fA-F0-9]{6}$/.test(s.color)) throw new Error('상태 이름과 색상을 확인해 주세요')
  for (const c of b.columns) if (!id(c.id) || !text(c.name, 80) || !b.statuses.some(s => s.id === c.statusId) || typeof c.archived !== 'boolean') throw new Error('컬럼 이름과 상태를 확인해 주세요')
  for (const c of b.cards) {
    if (!id(c.id) || !text(c.title, 200) || !text(c.body, 200000, true) || !b.columns.some(col => col.id === c.columnId) || !['low', 'normal', 'high'].includes(c.priority) || typeof c.archived !== 'boolean' || !Array.isArray(c.tags) || c.tags.length > 30 || c.tags.some(t => !text(t, 40)) || !text(c.due, 10, true) || (c.due && !isDateStr(c.due)) || !Array.isArray(c.comments) || c.comments.length > 1000 || !Array.isArray(c.attachments) || c.attachments.length > 100) throw new Error('카드 제목·내용·컬럼을 확인해 주세요')
    for (const m of c.comments) if (!id(m.id) || !text(m.body, 20000) || !Number.isFinite(Date.parse(m.created))) throw new Error('댓글 내용을 확인해 주세요')
    for (const a of c.attachments) if (!id(a.id) || !text(a.name, 255) || !Number.isSafeInteger(a.size) || a.size < 0) throw new Error('첨부 파일 정보를 확인해 주세요')
  }
}
