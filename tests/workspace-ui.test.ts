import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Workspace } from '../src/renderer/src/components/Shell'
import { DEFAULT_PREFS } from '../src/renderer/src/prefs'

describe('사이드바 메뉴', () => {
  it('중복된 월·주·일 보기를 제거하고 워크스페이스 전환·프로필 편집을 제공한다', () => {
    const noop = () => undefined
    const html = renderToStaticMarkup(createElement(Workspace, {
      open: true, view: 'calendar', prefs: DEFAULT_PREFS, info: null, conn: null, tags: [],
      memoFilter: { mode: 'all' }, pinnedCount: 0, todayCount: 0, docCount: 0, settingsSection: 'workspace',
      onView: noop, onWorkspace: noop, onMemoFilter: noop, onNewMemo: noop, onScratch: noop, onSettings: noop, onProfile: noop
    }))
    expect(html).not.toMatch(/월 보기|주 보기|일 보기/)
    expect(html).toContain('워크스페이스 전환')
    // '워크스페이스 관리'는 맨 위 공간 이름을 눌러 여는 목록 안에 있다 (e2e에서 확인)
    expect(html).toContain('프로필 편집')
    expect(html).toContain('캘린더')
  })
})
