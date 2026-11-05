import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppInfo, HolidayStatus } from '../../../shared/types'
import { ACCENTS, DEFAULT_PREFS, MENU_DEFAULT, inkOn, isHex, type CalView, type MenuKey, type Prefs } from '../prefs'
import { CalendarConnections } from './CalendarConnections'
import { SETTING_SECTIONS } from './Shell'

function fmt(iso: string | null): string {
  if (!iso) return '아직 없음'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function Section({ id, title, desc, children }: { id: string; title: string; desc: ReactNode; children: ReactNode }) {
  const no = SETTING_SECTIONS.findIndex((s) => s.id === id) + 1
  return (
    <section className="set-sec" id={`set-${id}`} data-sec={id}>
      <div className="set-l">
        <span className="set-no">{String(no).padStart(2, '0')}</span>
        <h2>{title}</h2>
        <div className="set-desc">{desc}</div>
      </div>
      <div className="set-r">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="srow">
      <div className="srow-l">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </div>
      <div className="srow-r">{children}</div>
    </div>
  )
}

function Seg<T extends string | number>({ value, options, onPick }: { value: T; options: { v: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="seg2" role="group">
      {options.map((o) => (
        <button key={String(o.v)} className={value === o.v ? 'on' : ''} onClick={() => onPick(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ColorPick({ value, presets, onPick }: { value: string; presets: string[]; onPick: (v: string) => void }) {
  return (
    <div className="swatches">
      {presets.map((h) => (
        <button
          key={h}
          className={`sw ${value.toLowerCase() === h.toLowerCase() ? 'on' : ''}`}
          style={{ background: h, color: inkOn(h) }}
          aria-label={h}
          title={h}
          onClick={() => onPick(h)}
        >
          {value.toLowerCase() === h.toLowerCase() ? '✓' : ''}
        </button>
      ))}
      <label className="sw custom" title="직접 고르기">
        <input type="color" value={isHex(value) ? value : '#C7F12D'} onChange={(e) => onPick(e.target.value.toUpperCase())} />
        <span>직접</span>
      </label>
    </div>
  )
}

export function SettingsView({
  prefs,
  onPrefs,
  info,
  busy,
  jump,
  onSection,
  onChooseData,
  onChooseBackup,
  onOpenData,
  onBackup,
  onRebuild,
  onConnChanged,
  holidayStatus,
  onHolidayRefresh
}: {
  prefs: Prefs
  onPrefs: (patch: Partial<Prefs>) => void
  info: AppInfo | null
  busy: boolean
  jump: { id: string; n: number }
  onSection: (id: string) => void
  onChooseData: () => void
  onChooseBackup: () => void
  onOpenData: () => void
  onBackup: () => void
  onRebuild: () => void
  onConnChanged: () => void
  holidayStatus: HolidayStatus | null
  onHolidayRefresh: () => void
}) {
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceMessage, setWorkspaceMessage] = useState('')
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [workspaceList, setWorkspaceList] = useState(info?.workspaces ?? [])
  useEffect(() => setWorkspaceList(info?.workspaces ?? []), [info])
  const scroller = useRef<HTMLDivElement>(null)

  // 왼쪽 목록에서 고른 항목으로 이동
  useEffect(() => {
    if (jump.n === 0) return
    const el = document.getElementById(`set-${jump.id}`)
    if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - 24, behavior: jump.n > 1 ? 'smooth' : 'auto' })
  }, [jump])

  // 스크롤하면 지금 보고 있는 항목을 왼쪽에 표시
  useEffect(() => {
    const box = scroller.current
    if (!box) return
    const onScroll = () => {
      const secs = Array.from(box.querySelectorAll<HTMLElement>('.set-sec'))
      let cur = secs[0]?.dataset.sec ?? 'look'
      for (const s of secs) if (s.offsetTop - box.scrollTop < 140) cur = s.dataset.sec ?? cur
      onSection(cur)
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => box.removeEventListener('scroll', onScroll)
  }, [onSection])

  const names = (k: MenuKey) => (
    <input
      className="txt"
      maxLength={20}
      value={prefs.menuNames[k] ?? ''}
      placeholder={MENU_DEFAULT[k]}
      onChange={(e) => onPrefs({ menuNames: { ...prefs.menuNames, [k]: e.target.value } })}
    />
  )

  return (
    <div className="setv cardp">
    <div className="setv-scroll" ref={scroller}>
      <div className="setv-head">
        <span className="tagline">Settings</span>
        <h1>설정</h1>
        <p>Opus의 모든 설정은 이 화면 한곳에 모여 있어요. 바꾸면 바로 적용되고 자동으로 저장돼요.</p>
      </div>

      <Section id="workspace" title="워크스페이스" desc="메모·일정·빠른 메모와 백업을 각각 보관해요. 왼쪽 아래에서 전환할 수 있어요.">
        <Row label="등록된 워크스페이스"><span>{workspaceList.map(w => w.name).join(' · ')}</span></Row>
        <form onSubmit={async e => {
          e.preventDefault()
          if (creatingWorkspace) return
          setCreatingWorkspace(true)
          try {
            const result = await window.api.createWorkspace(workspaceName)
            setWorkspaceList(result.workspaces)
            setWorkspaceName('')
            setWorkspaceMessage('워크스페이스를 만들었어요')
            onConnChanged()
          } catch (error) { setWorkspaceMessage(error instanceof Error ? error.message : '만들지 못했어요') }
          finally { setCreatingWorkspace(false) }
        }}>
          <Row label="새 워크스페이스">
            <input className="txt" aria-label="새 워크스페이스 이름" maxLength={40} value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} placeholder="예: 업무" />
            <button className="btn" disabled={creatingWorkspace || !workspaceName.trim()}>만들기</button>
          </Row>
          <p role="status">{workspaceMessage}</p>
        </form>
      </Section>
      <Section id="look" title="화면 · 강조색" desc={<>바탕은 Paper, 패널은 Ivory, 글자는 Graphite예요. 강조색 하나만 골라서 버튼, 오늘 날짜, 선택 표시에 써요.</>}>
        <Row label="강조색" hint="기본 Lime #C7F12D">
          <div className="accent-grid">
            {ACCENTS.map((a) => (
              <button
                key={a.hex}
                className={`acc ${prefs.accent.toLowerCase() === a.hex.toLowerCase() ? 'on' : ''}`}
                onClick={() => onPrefs({ accent: a.hex })}
              >
                <span className="acc-sw" style={{ background: a.hex }} />
                <b>{a.name}</b>
                <small>{a.hex}</small>
              </button>
            ))}
            <label className={`acc ${ACCENTS.some((a) => a.hex.toLowerCase() === prefs.accent.toLowerCase()) ? '' : 'on'}`}>
              <input type="color" value={prefs.accent} onChange={(e) => onPrefs({ accent: e.target.value.toUpperCase() })} />
              <b>직접 고르기</b>
              <small>{prefs.accent}</small>
            </label>
          </div>
        </Row>
        <Row label="강조 세기" hint="진하게: 오늘 날짜·선택한 칸까지 강조색으로 채워요">
          <Seg
            value={prefs.accentMode}
            options={[
              { v: 'soft', label: '은은하게' },
              { v: 'bold', label: '진하게' }
            ]}
            onPick={(v) => onPrefs({ accentMode: v })}
          />
        </Row>
        <Row label="글자 크기">
          <Seg
            value={prefs.fontScale}
            options={[
              { v: 'sm', label: '작게' },
              { v: 'md', label: '보통' },
              { v: 'lg', label: '크게' }
            ]}
            onPick={(v) => onPrefs({ fontScale: v })}
          />
        </Row>
        <Row label="기본값으로">
          <button
            className="btn"
            onClick={() =>
              onPrefs({ accent: DEFAULT_PREFS.accent, accentMode: DEFAULT_PREFS.accentMode, fontScale: DEFAULT_PREFS.fontScale })
            }
          >
            화면 설정 되돌리기
          </button>
        </Row>
      </Section>

      <Section id="menu" title="메뉴 이름" desc="왼쪽 메뉴에 보이는 이름을 바꿔요. 20자까지이고, 비우면 기본 이름으로 돌아가요.">
        <Row label="캘린더">{names('calendar')}</Row>
        <Row label="메모">{names('memo')}</Row>
        <Row label="빠른 메모">{names('scratch')}</Row>
        <Row label="설정">{names('settings')}</Row>
        <Row label="날짜 패널 메모 칸" hint="캘린더 오른쪽 아래 메모 칸의 이름">
          <input
            className="txt"
            maxLength={20}
            value={prefs.dayMemoLabel}
            placeholder="회의 메모"
            onChange={(e) => onPrefs({ dayMemoLabel: e.target.value })}
          />
        </Row>
      </Section>

      <Section id="calendar" title="캘린더" desc="처음 열 때의 보기와 일정 칩 색을 정해요. 칩 색은 종류별로 하나씩이에요.">
        <Row label="기본 보기">
          <Seg<CalView>
            value={prefs.calDefaultView}
            options={[
              { v: 'month', label: '월' },
              { v: 'week', label: '주' },
              { v: 'day', label: '일' }
            ]}
            onPick={(v) => onPrefs({ calDefaultView: v })}
          />
        </Row>
        <Row label="한 칸에 보일 일정" hint="넘치면 'N개 더'로 줄여요">
          <Seg
            value={prefs.calChipsPerCell}
            options={[2, 3, 4, 5].map((n) => ({ v: n, label: `${n}개` }))}
            onPick={(v) => onPrefs({ calChipsPerCell: v })}
          />
        </Row>
        <Row label="Google 일정 보이기">
          <Seg
            value={prefs.showGoogle ? 'on' : 'off'}
            options={[
              { v: 'on', label: '보이기' },
              { v: 'off', label: '숨기기' }
            ]}
            onPick={(v) => onPrefs({ showGoogle: v === 'on' })}
          />
        </Row>
        <Row label="한국 공휴일" hint="대체공휴일·선거일 포함, 날짜 칸에 빨간 이름으로 표시">
          <Seg
            value={prefs.showHolidays ? 'on' : 'off'}
            options={[
              { v: 'on', label: '보이기' },
              { v: 'off', label: '숨기기' }
            ]}
            onPick={(v) => onPrefs({ showHolidays: v === 'on' })}
          />
        </Row>
        <Row label="기념일도 보이기" hint="어버이날·스승의날처럼 쉬지 않는 날 (Google 달력을 받을 때만)">
          <Seg
            value={prefs.showObservances ? 'on' : 'off'}
            options={[
              { v: 'on', label: '보이기' },
              { v: 'off', label: '숨기기' }
            ]}
            onPick={(v) => onPrefs({ showObservances: v === 'on' })}
          />
        </Row>
        <Row
          label="공휴일 받는 곳"
          hint={
            prefs.holidayOnline
              ? holidayStatus?.source === 'google'
                ? `Google 공개 한국 공휴일 달력 · ${holidayStatus.updated ? fmt(holidayStatus.updated) : ''} 받음 (로그인 필요 없음, 하루 한 번)`
                : `아직 받지 못해 앱에 넣어 둔 규칙(2024~2035)을 쓰는 중${holidayStatus?.error ? ` · ${holidayStatus.error}` : ''}`
              : '앱에 넣어 둔 규칙(2024~2035)만 써요. 밖으로 나가는 통신이 없어요'
          }
        >
          <Seg
            value={prefs.holidayOnline ? 'google' : 'local'}
            options={[
              { v: 'google', label: 'Google 공개 달력' },
              { v: 'local', label: '이 PC 안에서만' }
            ]}
            onPick={(v) => onPrefs({ holidayOnline: v === 'google' })}
          />
          {prefs.holidayOnline && (
            <button className="btn" onClick={onHolidayRefresh}>
              지금 받기
            </button>
          )}
        </Row>
        <Row label="내 일정 색">
          <ColorPick value={prefs.colorEvent} presets={['#C7F12D', '#8EE6B8', '#F6DD5C', '#FFB896']} onPick={(v) => onPrefs({ colorEvent: v })} />
        </Row>
        <Row label="기록 색">
          <ColorPick value={prefs.colorNote} presets={['#E9EAE5', '#D9DCCF', '#F1E9D2', '#E4DEF7']} onPick={(v) => onPrefs({ colorNote: v })} />
        </Row>
        <Row label="Google 일정 색">
          <ColorPick value={prefs.colorGoogle} presets={['#B9D7F2', '#C9B8FF', '#9ED3F7', '#D4D8CF']} onPick={(v) => onPrefs({ colorGoogle: v })} />
        </Row>
      </Section>

      <Section
        id="google"
        title="Google 캘린더"
        desc={
          <>
            Google 계정의 일정을 <b>읽어 오기만</b> 해요. Opus에서 고치거나 지울 수 없고, Google 쪽에도 아무것도 쓰지 않아요. 연결하지 않으면 밖으로 나가는 통신이
            없어요.
          </>
        }
      >
        <CalendarConnections onChanged={onConnChanged} />
      </Section>

      <Section id="memo" title="메모 보관 · 백업" desc="메모는 아래 폴더에 글 파일(.md)로 저장돼요. 이 폴더만 옮기면 다른 컴퓨터에서도 그대로 쓸 수 있어요.">
        {info && (
          <>
            <Row label="메모 보관 폴더" hint={info.dataDir}>
              <button className="btn" disabled={busy} onClick={onChooseData}>
                폴더 바꾸기
              </button>
              <button className="btn" onClick={onOpenData}>
                폴더 열기
              </button>
            </Row>
            <Row label="백업 폴더" hint={info.backupDir}>
              <button className="btn" disabled={busy} onClick={onChooseBackup}>
                폴더 바꾸기
              </button>
            </Row>
            <Row label="백업" hint={`하루 한 번 자동, 지우지 않고 모두 보관 · 마지막 ${fmt(info.lastBackup)}`}>
              <button className="btn-accent" disabled={busy} onClick={onBackup}>
                지금 백업
              </button>
            </Row>
            <Row label="검색 목록" hint={`전체 ${info.totalNotes}개 · 파일을 직접 고쳤다면 다시 만들어 주세요`}>
              <button className="btn" disabled={busy} onClick={onRebuild}>
                다시 만들기
              </button>
            </Row>
            <Row label="빠른 메모 단축키">
              <span className="muted">
                {info.scratchShortcut
                  ? 'Ctrl + Shift + Space — 어느 프로그램에서든 작은 메모창이 떠요'
                  : '다른 프로그램이 쓰고 있어 등록하지 못했어요. 왼쪽 메뉴에서 열 수 있어요'}
              </span>
            </Row>
          </>
        )}
      </Section>

      <Section id="about" title="정보" desc="나만 쓰는 개인 워크스페이스예요. 모든 데이터는 이 PC 안에 있어요.">
        <Row label="버전">
          <span className="mono">Opus {info?.appVersion ?? ''}</span>
        </Row>
        <Row label="메모 수">
          <span className="mono">
            전체 {info?.totalNotes ?? 0} · 메모장 {info?.documentCount ?? 0}
          </span>
        </Row>
      </Section>
      <div className="setv-end" />
    </div>
    </div>
  )
}
