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

/** 사진을 정사각형 96px로 줄여 data URL로 만든다 (설정 파일을 가볍게) */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const s = Math.min(img.naturalWidth, img.naturalHeight)
    const c = document.createElement('canvas')
    c.width = c.height = 96
    c.getContext('2d')!.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 96, 96)
    return c.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function ProfileEditor({ prefs, onPrefs, workspaceName }: { prefs: Prefs; onPrefs: (p: Partial<Prefs>) => void; workspaceName: string }) {
  const p = prefs.profile
  const set = (patch: Partial<Profile>) => onPrefs({ profile: { ...p, ...patch } })
  const file = useRef<HTMLInputElement>(null)
  const [more, setMore] = useState(false)
  const [preview, setPreview] = useState(false)
  const [msg, setMsg] = useState('')
  return (
    <div className="lst">
      <div className="prof-top">
        <Avatar prefs={prefs} size={48} />
        <div className="prof-fields">
          <label className="fld">
            <span>표시 이름</span>
            <input className="txt" maxLength={30} value={p.name} placeholder="나" onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="fld">
            <span>소속 · 직함</span>
            <input className="txt" maxLength={40} value={p.role} placeholder="예: 기획팀 · 매니저" onChange={(e) => set({ role: e.target.value })} />
          </label>
        </div>
      </div>
      <div className="lst-acts">
        <button className="btn sm" onClick={() => file.current?.click()}>
          사진 바꾸기
        </button>
        {p.photo && (
          <button className="btn sm" onClick={() => set({ photo: '' })}>
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
              setMsg('사진을 읽지 못했어요')
            }
          }}
        />
        <span className="spacer" />
        <button className="btn sm ghost" aria-expanded={more} onClick={() => setMore((v) => !v)}>
          {more ? '선택 정보 접기' : '소개 · 연락처 펼치기'}
        </button>
        <button className="btn sm ghost" aria-expanded={preview} onClick={() => setPreview((v) => !v)}>
          {preview ? '미리보기 닫기' : '미리보기'}
        </button>
      </div>
      {msg && <p className="lst-note" role="status">{msg}</p>}
      {more && (
        <div className="prof-more">
          <label className="fld wide">
            <span>소개</span>
            <textarea className="txt area" rows={2} maxLength={200} value={p.intro} placeholder="한 줄 소개" onChange={(e) => set({ intro: e.target.value })} />
          </label>
          <label className="fld">
            <span>이메일</span>
            <input className="txt" type="email" maxLength={80} value={p.email} placeholder="선택" onChange={(e) => set({ email: e.target.value })} />
          </label>
          <label className="fld">
            <span>연락처</span>
            <input className="txt" maxLength={30} value={p.phone} placeholder="선택" onChange={(e) => set({ phone: e.target.value })} />
          </label>
        </div>
      )}
      {preview && (
        <div className="prof-card" aria-label="프로필 미리보기">
          <Avatar prefs={prefs} size={32} />
          <div>
            <b>{p.name.trim() || '나'}</b>
            <small>{[p.role.trim(), p.intro.trim()].filter(Boolean).join(' · ') || '소속과 소개를 적으면 여기에 보여요'}</small>
          </div>
          {workspaceName && <span className="chip">{workspaceName}</span>}
        </div>
      )}
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
