import type { EventEmitter } from 'node:events'

interface FlushTarget {
  webContents: { id: number; send(channel: string): void }
}

/** 다른 창의 응답을 저장 완료로 오인하지 않고, 실패·시간 초과 시 종료를 막는다. */
export function requestFlush(target: FlushTarget, events: EventEmitter, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (event: { sender: { id: number } }, error?: string) => {
      if (event.sender.id !== target.webContents.id) return
      clearTimeout(timer)
      events.removeListener('app:flushed', done)
      error ? reject(new Error(error)) : resolve()
    }
    const timer = setTimeout(() => {
      events.removeListener('app:flushed', done)
      reject(new Error('저장 응답을 기다리고 있어요. 잠시 후 다시 시도해 주세요'))
    }, timeoutMs)
    events.on('app:flushed', done)
    try { target.webContents.send('app:flush') } catch (error) {
      clearTimeout(timer)
      events.removeListener('app:flushed', done)
      reject(error)
    }
  })
}
