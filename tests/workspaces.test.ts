import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { AppState } from '../src/main/app'

let root: string
let state: AppState
const paths = () => ({ settingsFile: join(root, 'settings.json'), documents: root, version: '0.4.0' })
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'opus-workspaces-')); state = new AppState(paths()) })
afterEach(() => { state.close(); rmSync(root, { recursive: true, force: true }) })

describe('워크스페이스 분리', () => {
  it('기존 폴더와 백업 위치를 개인 워크스페이스로 유지한다', () => {
    state.close()
    writeFileSync(paths().settingsFile, JSON.stringify({ dataDir: join(root, 'legacy'), backupDir: join(root, 'old-backups'), prefs: { accent: '#222621' } }))
    state = new AppState(paths())
    expect(state.info().workspaceId).toBe('personal')
    expect(state.dataDir).toBe(join(root, 'legacy'))
    expect(state.backupDir).toBe(join(root, 'old-backups'))
    expect(state.settings.get().prefs).toEqual({ accent: '#222621' })
  })

  it('메모·일정·검색·태그·빠른 메모를 분리하고 재시작 후 선택을 유지한다', () => {
    const memo = state.service.create({ kind: 'document', date: '', title: '개인 기록', tags: ['개인'] })
    state.service.create({ kind: 'event', date: '2026-11-05', title: '개인 일정' })
    state.service.scratchSave('개인 빠른 메모')
    const info = state.createWorkspace('업무')
    const work = info.workspaces.find(w => w.name === '업무')!
    expect(state.info().workspaceId).toBe('personal')
    state.switchWorkspace(work.id)
    expect(state.service.get(memo.id)).toBeNull()
    expect(state.service.documents()).toEqual([])
    expect(state.service.byMonth('2026-11')).toEqual([])
    expect(state.service.search('개인')).toEqual([])
    expect(state.service.tags('document')).toEqual([])
    expect(state.service.scratch().body).toBe('')
    const workMemo = state.service.create({ kind: 'document', date: '', title: '업무 기록' })
    state.service.scratchSave('업무 빠른 메모')
    state.close()
    state = new AppState(paths())
    expect(state.info().workspaceId).toBe(work.id)
    expect(state.service.get(workMemo.id)?.title).toBe('업무 기록')
    state.switchWorkspace('personal')
    expect(state.service.get(memo.id)?.title).toBe('개인 기록')
    expect(state.service.get(workMemo.id)).toBeNull()
    expect(state.service.scratch().body).toBe('개인 빠른 메모')
    expect(state.service.byMonth('2026-11')).toHaveLength(1)
  })

  it('백업에는 현재 워크스페이스 기록만 담는다', () => {
    state.service.create({ date: '', kind: 'document', title: '개인 전용' })
    const personalBackupDir = state.backupDir
    const work = state.createWorkspace('업무').workspaces.find(w => w.name === '업무')!
    state.switchWorkspace(work.id)
    state.service.create({ date: '', kind: 'document', title: '업무 전용' })
    expect(state.backupDir).not.toBe(personalBackupDir)
    const zip = state.backupNow()!
    const text = Object.values(unzipSync(readFileSync(zip))).map(b => strFromU8(b)).join('\n')
    expect(text).toContain('업무 전용')
    expect(text).not.toContain('개인 전용')
  })

  it('잘못된 이름과 존재하지 않는 전환 요청은 현재 기록에 영향을 주지 않는다', () => {
    for (const name of ['', '  ', 'a'.repeat(41), '개인 워크스페이스']) expect(() => state.createWorkspace(name)).toThrow()
    const previous = state.dataDir
    expect(() => state.switchWorkspace('../other')).toThrow()
    expect(state.dataDir).toBe(previous)
    expect(state.info().workspaces).toHaveLength(1)
  })

  it('폴더 변경은 현재 워크스페이스에만 적용한다', () => {
    state.createWorkspace('업무')
    state.switchDataDir(join(root, 'moved-data'))
    state.setBackupDir(join(root, 'moved-backups'))
    const work = state.info().workspaces.find(w => w.name === '업무')!
    state.switchWorkspace(work.id)
    expect(state.dataDir).toBe(work.dataDir)
    expect(state.backupDir).toBe(work.backupDir)
    state.switchWorkspace('personal')
    expect(state.dataDir).toBe(join(root, 'moved-data'))
    expect(state.backupDir).toBe(join(root, 'moved-backups'))
  })

  it('다른 워크스페이스와 겹치는 보관·백업 폴더는 허용하지 않는다', () => {
    const work = state.createWorkspace('업무').workspaces.find(w => w.name === '업무')!
    expect(() => state.switchDataDir(work.dataDir)).toThrow()
    expect(() => state.switchDataDir(join(work.dataDir, 'nested'))).toThrow()
    expect(() => state.setBackupDir(work.backupDir)).toThrow()
    expect(state.info().workspaceId).toBe('personal')
  })
})

