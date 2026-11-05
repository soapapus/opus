import { EventEmitter } from 'node:events'
import { describe, it, expect } from 'vitest'
import { requestFlush } from '../src/main/flush'

describe('종료 전 저장 확인', () => {
  it('다른 창의 응답은 무시하고 해당 편집기의 완료를 기다린다', async () => {
    const events = new EventEmitter()
    let sent = ''
    const pending = requestFlush({ webContents: { id: 1, send: channel => { sent = channel } } }, events)
    events.emit('app:flushed', { sender: { id: 2 } })
    expect(events.listenerCount('app:flushed')).toBe(1)
    events.emit('app:flushed', { sender: { id: 1 } })
    await pending
    expect(sent).toBe('app:flush')
    expect(events.listenerCount('app:flushed')).toBe(0)
  })
  it('실패 응답은 성공으로 처리하지 않는다', async () => {
    const events = new EventEmitter()
    const pending = requestFlush({ webContents: { id: 1, send: () => undefined } }, events)
    events.emit('app:flushed', { sender: { id: 1 } }, '디스크 저장 실패')
    await expect(pending).rejects.toThrow('디스크 저장 실패')
    expect(events.listenerCount('app:flushed')).toBe(0)
  })
  it('시간 초과도 실패이며 응답 수신기를 해제한다', async () => {
    const events = new EventEmitter()
    await expect(requestFlush({ webContents: { id: 1, send: () => undefined } }, events, 10)).rejects.toThrow('저장 응답')
    expect(events.listenerCount('app:flushed')).toBe(0)
  })
})
