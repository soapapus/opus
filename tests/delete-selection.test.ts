import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DiaryService } from '../src/main/diaryService'

describe('선택 삭제의 기록 보존', () => {
  it('선택한 문서만 .trash로 옮기고 다른 문서·연결된 일정은 보존한다', () => {
    const root = mkdtempSync(join(tmpdir(), 'opus-selected-delete-'))
    const service = new DiaryService(root)
    try {
      const first = service.create({ kind: 'document', date: '', title: '선택한 첫 메모', body: '복구할 첫 본문' })
      const second = service.create({ kind: 'document', date: '', title: '선택한 두 번째 메모', body: '복구할 두 번째 본문' })
      const keep = service.create({ kind: 'document', date: '', title: '남길 메모' })
      const event = service.create({ kind: 'event', date: '2026-11-06', title: '연결된 일정', links: [first.id] })
      service.remove(first.id)
      service.remove(second.id)
      expect(service.get(first.id)).toBeNull()
      expect(service.get(second.id)).toBeNull()
      expect(service.get(keep.id)?.title).toBe('남길 메모')
      expect(service.get(event.id)?.title).toBe('연결된 일정')
      const trash = join(root, 'personal', '.trash')
      const contents = readdirSync(trash).map(file => readFileSync(join(trash, file), 'utf8')).join('\n')
      expect(contents).toContain('복구할 첫 본문')
      expect(contents).toContain('복구할 두 번째 본문')
    } finally { service.close(); rmSync(root, { recursive: true, force: true }) }
  })

  it('보관 폴더로 옮기지 못한 메모는 목록과 검색에 그대로 남긴다', () => {
    const root = mkdtempSync(join(tmpdir(), 'opus-delete-failure-'))
    const service = new DiaryService(root)
    try {
      const note = service.create({ kind: 'document', date: '', title: '보존할 메모' })
      vi.spyOn(service.store, 'trash').mockImplementation(() => { throw new Error('파일 사용 중') })
      expect(() => service.remove(note.id)).toThrow('파일 사용 중')
      expect(service.documents().some(n => n.id === note.id)).toBe(true)
      expect(service.get(note.id)?.title).toBe('보존할 메모')
    } finally { vi.restoreAllMocks(); service.close(); rmSync(root, { recursive: true, force: true }) }
  })
})
