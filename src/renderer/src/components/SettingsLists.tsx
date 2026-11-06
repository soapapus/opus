// 설정 화면의 행(row) 목록들: 프로필 · 워크스페이스 · 메뉴.
// 큰 카드 대신 한 줄에 이름·상태·버튼·스위치를 두는 간결한 목록으로 만든다.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppInfo } from '../../../shared/types'
import { IconBolt, IconCalendar, IconGear, IconNotes } from '../icons'
import { HIDEABLE_MENUS, MENU_DEFAULT, type MenuKey, type Prefs, type Profile } from '../prefs'
import { Avatar } from './Shell'

/** 켜기·끄기 스위치. 클릭 영역은 32px 높이 */
export function Toggle({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`tgl ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="tgl-k" />
    </button>
  )
}

/** 파일을 data URL로 읽는다. 설치본의 보안 정책(CSP)은 blob: 이미지를 막으므로 data: 로만 연다 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result))
    r.onerror = () => fail(r.error ?? new Error('read'))
    r.readAsDataURL(file)
  })
}

/** 사진을 정사각형 96px로 줄여 data URL로 만든다 (설정 파일을 가볍게) */
async function shrinkPhoto(file: File): Promise<string> {
  const img = new Image()
  img.src = await readAsDataUrl(file)
  await img.decode()
  const s = Math.min(img.naturalWidth, img.naturalHeight)
  const c = document.createElement('canvas')
  c.width = c.height = 96
  c.getContext('2d')!.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 96, 96)
  return c.toDataURL('image/jpeg', 0.85)
}

/** 왼쪽 아래 이름 카드를 누르면 뜨는 프로필 팝업. 저장을 눌러야 바뀐다 */
export function ProfileDialog({ prefs, onSave, onClose }: { prefs: Prefs; onSave: (p: Profile) => void; onClose: () => void }) {
  const [p, setP] = useState<Profile>(prefs.profile)
  const set = (patch: Partial<Profile>) => setP((cur) => ({ ...cur, ...patch }))
  const file = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const contact = [p.name.trim(), p.role.trim(), p.phone.trim(), p.email.trim()].filter(Boolean).join(' · ')
  return (
    <div className="overlay" onMouseDown={onClose}>
      <form
        className="dialog prof-dlg"
        role="dialog"
        aria-label="프로필"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ ...p, name: p.name.trim(), role: p.role.trim(), email: p.email.trim(), phone: p.phone.trim(), intro: p.intro.trim() })
        }}
      >
        <h2>프로필</h2>
        <div className="pf-photo">
          <Avatar prefs={{ ...prefs, profile: p }} size={48} />
          <button type="button" className="btn sm" onClick={() => file.current?.click()}>
            사진 변경
          </button>
          {p.photo && (
            <button type="button" className="btn sm ghost" onClick={() => set({ photo: '' })}>
              사진 빼기
            </button>
          )}
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              try {
                set({ photo: await shrinkPhoto(f) })
                setMsg('')
              } catch {
                setMsg('사진을 읽지 못했어요. JPG·PNG 파일을 골라 주세요')
              }
            }}
          />
        </div>
        <label className="pf">
          <span>이름</span>
          <input className="txt" autoFocus maxLength={30} value={p.name} placeholder="나" onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="pf">
          <span>소속 · 직함</span>
          <input className="txt" maxLength={40} value={p.role} placeholder="예: 기획팀 · 매니저" onChange={(e) => set({ role: e.target.value })} />
        </label>
        <div className="pf-row">
          <label className="pf">
            <span>연락처</span>
            <input className="txt" maxLength={30} value={p.phone} placeholder="010-0000-0000" onChange={(e) => set({ phone: e.target.value })} />
          </label>
          <label className="pf">
            <span>이메일</span>
            <input className="txt" type="email" maxLength={80} value={p.email} placeholder="name@example.com" onChange={(e) => set({ email: e.target.value })} />
          </label>
        </div>
        <label className="pf">
          <span>소개</span>
          <textarea className="txt area" rows={3} maxLength={200} value={p.intro} placeholder="하는 일, 관심 분야 등" onChange={(e) => set({ intro: e.target.value })} />
        </label>
        <p className="pf-note" role="status">
          {msg || '이 PC에만 저장하고 밖으로 보내지 않아요.'}
        </p>
        <div className="pf-acts">
          <button
            type="button"
            className="btn sm"
            disabled={!contact}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(contact)
                setMsg('연락처를 복사했어요')
              } catch {
                setMsg('복사하지 못했어요')
              }
            }}
          >
            연락처 복사
          </button>
          <span className="spacer" />
          <button type="button" className="btn sm" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn-accent sm">
            저장
          </button>
        </div>
      </form>
    </div>
  )
}

export function WorkspaceList({ info, onChanged, onSwitch }: { info: AppInfo | null; onChanged: () => void; onSwitch: (id: string) => void }) {
  const [list, setList] = useState(info?.workspaces ?? [])
  const [current, setCurrent] = useState(info?.workspaceId ?? '')
  useEffect(() => {
    setList(info?.workspaces ?? [])
    setCurrent(info?.workspaceId ?? '')
  }, [info])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [newName, setNewName] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<AppInfo>, ok: string) => {
    if (busy) return false
    setBusy(true)
    try {
      const r = await fn()
      setList(r.workspaces)
      setCurrent(r.workspaceId)
      setMsg(ok)
      onChanged()
      return true
    } catch (e) {
      setMsg(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '하지 못했어요')
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lst">
      <ul className="rows" aria-label="워크스페이스 목록">
        {list.map((w) => {
          const on = w.enabled !== false
          const isCur = w.id === current
          return (
            <li key={w.id} className={`row ${isCur ? 'cur' : ''} ${on ? '' : 'off'}`} data-ws={w.name}>
              <span className="row-mark" aria-hidden="true">
                {w.name.slice(0, 1)}
              </span>
              {editing === w.id ? (
                <form
                  className="row-edit"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (await run(() => window.api.renameWorkspace(w.id, draft), '이름을 바꿨어요')) setEditing(null)
                  }}
                >
                  <input className="txt" aria-label="새 이름" autoFocus maxLength={40} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
                  <button className="btn sm" disabled={busy || !draft.trim()}>
                    저장
                  </button>
                  <button type="button" className="btn sm ghost" onClick={() => setEditing(null)}>
                    취소
                  </button>
                </form>
              ) : (
                <span className="row-t">
                  <b>{w.name}</b>
                  <small>{isCur ? '지금 쓰는 공간' : on ? '켜져 있어요' : '꺼져 있어요 · 기록은 보관 중'}</small>
                </span>
              )}
              {editing !== w.id && (
                <button
                  className="btn sm"
                  onClick={() => {
                    setEditing(w.id)
                    setDraft(w.name)
                    setMsg('')
                  }}
                >
                  이름 변경
                </button>
              )}
              {isCur ? (
                <span className="chip cur">현재 공간</span>
              ) : (
                <button className="btn sm" disabled={!on || busy} title={on ? '' : '켜야 전환할 수 있어요'} onClick={() => onSwitch(w.id)}>
                  전환
                </button>
              )}
              <Toggle
                on={on}
                label={`${w.name} 켜기`}
                disabled={isCur || busy}
                onChange={(v) => void run(() => window.api.setWorkspaceEnabled(w.id, v), v ? `${w.name}을(를) 켰어요` : `${w.name}을(를) 껐어요. 기록은 그대로 있어요`)}
              />
            </li>
          )
        })}
      </ul>
      <form
        className="lst-add"
        onSubmit={async (e) => {
          e.preventDefault()
          if (await run(() => window.api.createWorkspace(newName), '워크스페이스를 만들었어요')) setNewName('')
        }}
      >
        <input className="txt" aria-label="새 워크스페이스 이름" maxLength={40} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="새 공간 이름 (예: 업무)" />
        <button className="btn sm" disabled={busy || !newName.trim()}>
          + 새 공간
        </button>
      </form>
      <p className="lst-note" role="status">
        {msg || '지금 쓰는 공간은 끌 수 없어요. 공간을 꺼도 메모와 파일은 그대로 남아요.'}
      </p>
    </div>
  )
}

const MENU_ICON: Record<MenuKey, ReactNode> = {
  calendar: <IconCalendar size={16} />,
  memo: <IconNotes size={16} />,
  library: <IconNotes size={16} />,
  ai: <IconBolt size={16} />,
  scratch: <IconBolt size={16} />,
  settings: <IconGear size={16} />
}

export function MenuList({ prefs, onPrefs }: { prefs: Prefs; onPrefs: (p: Partial<Prefs>) => void }) {
  const keys: MenuKey[] = [...HIDEABLE_MENUS, 'settings']
  return (
    <ul className="rows" aria-label="메뉴 목록">
      {keys.map((k) => {
        const fixed = k === 'settings'
        const on = fixed || !prefs.menuHidden.includes(k)
        return (
          <li key={k} className={`row ${on ? '' : 'off'}`}>
            <span className="row-ic" aria-hidden="true">
              {MENU_ICON[k]}
            </span>
            <input
              className="txt bare"
              aria-label={`${MENU_DEFAULT[k]} 메뉴 이름`}
              maxLength={20}
              value={prefs.menuNames[k] ?? ''}
              placeholder={MENU_DEFAULT[k]}
              onChange={(e) => onPrefs({ menuNames: { ...prefs.menuNames, [k]: e.target.value } })}
            />
            {fixed && <small className="row-hint">항상 보여요</small>}
            <Toggle
              on={on}
              disabled={fixed}
              label={`${MENU_DEFAULT[k]} 메뉴 보이기`}
              onChange={(v) => onPrefs({ menuHidden: v ? prefs.menuHidden.filter((x) => x !== k) : [...prefs.menuHidden, k] })}
            />
          </li>
        )
      })}
    </ul>
  )
}
