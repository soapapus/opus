// 화면 설정 읽기: 프로필·숨긴 메뉴 값이 이상해도 앱이 안전하게 연다
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, initialOf, menuShown, mergePrefs, profileName, type Prefs } from '../src/renderer/src/prefs'

describe('프로필 · 메뉴 숨기기 설정', () => {
  it('예전 설정(프로필 없음)도 빈 프로필로 연다', () => {
    const p = mergePrefs({ accent: '#222621' })
    expect(p.profile).toEqual({ name: '', role: '', intro: '', email: '', phone: '', photo: '' })
    expect(p.menuHidden).toEqual([])
    expect(profileName(p)).toBe('나')
  })

  it('이상한 값은 버린다: 설정 메뉴 숨김, 사진이 아닌 주소, 문자열이 아닌 값', () => {
    const p = mergePrefs({
      menuHidden: ['settings', 'memo', 'zzz'],
      profile: { name: '민서', role: 3, photo: 'https://example.com/a.png' }
    })
    expect(p.menuHidden).toEqual(['memo'])
    expect(p.profile.name).toBe('민서')
    expect(p.profile.role).toBe('')
    expect(p.profile.photo).toBe('')
    expect(menuShown(p, 'memo')).toBe(false)
    expect(menuShown(p, 'settings')).toBe(true)
  })

  it('이름 첫 글자 (한글·영문·빈 값)', () => {
    expect(initialOf('민서')).toBe('민')
    expect(initialOf('Noah')).toBe('N')
    expect(initialOf('  ')).toBe('나')
    const p: Prefs = { ...DEFAULT_PREFS, profile: { ...DEFAULT_PREFS.profile, name: '  ' } }
    expect(profileName(p)).toBe('나')
  })
})
