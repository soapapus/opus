import { useEffect, useState, type ReactNode } from 'react'
import type { ConnectionsState, Provider, ProviderState } from '../../../shared/types'

function when(iso?: string): string {
  if (!iso) return '아직 없음'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function KeyForm({
  idLabel,
  secretLabel,
  busy,
  onSave
}: {
  idLabel: string
  secretLabel: string
  busy: boolean
  onSave: (id: string, secret: string) => void
}) {
  const [id, setId] = useState('')
  const [secret, setSecret] = useState('')
  return (
    <div className="keyform">
      <label>
        {idLabel}
        <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <label>
        {secretLabel}
        <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
      </label>
      <button className="btn primary" disabled={busy || !id.trim()} onClick={() => onSave(id, secret)}>
        키 저장
      </button>
      <p className="muted small">입력한 키는 이 PC에서 암호화되어 저장돼요. 데이터 폴더(백업 포함)에는 들어가지 않아요.</p>
    </div>
  )
}

function Card({ title, state, children }: { title: string; state: ProviderState; children?: ReactNode }) {
  return (
    <div className="card conn-card">
      <div className="conn-head">
        <h3>{title}</h3>
        <span className={`status ${state.connected ? 'on' : ''}`}>
          {state.connected ? `연결됨${state.account ? ` · ${state.account}` : ''}` : '연결 안 됨'}
        </span>
      </div>
      <ul className="caps">
        {state.capabilities.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {children}
      {state.message && <div className="conn-msg">{state.message}</div>}
    </div>
  )
}

export function CalendarConnections({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<ConnectionsState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.connections().then(setState)
  }, [])

  const run = async (fn: () => Promise<ConnectionsState>) => {
    setBusy(true)
    try {
      setState(await fn())
      onChanged()
    } finally {
      setBusy(false)
    }
  }
  const keys = (p: Provider) => (id: string, secret: string) => void run(() => window.api.saveKeys(p, id, secret))

  const g = state?.google
  return (
    <div className="conn">
      {g && (
        <div className="conn-grid">
          <Card title="Google 캘린더" state={g}>
            {!g.configured && (
              <>
                <details className="guide">
                  <summary>키 발급 방법 (처음 한 번)</summary>
                  <ol>
                    <li>console.cloud.google.com 에서 새 프로젝트를 만들어요.</li>
                    <li>“API 및 서비스”에서 <b>Google Calendar API</b>를 사용 설정해요.</li>
                    <li>“OAuth 동의 화면”을 만들고, 테스트 사용자에 내 Google 계정을 추가해요.</li>
                    <li>“사용자 인증 정보 → OAuth 클라이언트 ID”를 만들고 유형은 <b>데스크톱 앱</b>을 골라요.</li>
                    <li>나온 클라이언트 ID와 보안 비밀을 아래에 붙여넣어요.</li>
                  </ol>
                  <p className="muted small">회사 계정은 관리자가 외부 앱 연결을 막아 둘 수 있어요.</p>
                </details>
                <KeyForm idLabel="클라이언트 ID" secretLabel="클라이언트 보안 비밀" busy={busy} onSave={keys('google')} />
              </>
            )}
            {g.configured && !g.connected && (
              <div className="btns">
                <button className="btn primary" disabled={busy} onClick={() => void run(() => window.api.connect('google', false))}>
                  {busy ? '브라우저에서 허용해 주세요…' : 'Google 연결 (읽기만)'}
                </button>
              </div>
            )}
            {g.connected && (
              <>
                <div className="val">
                  마지막 동기화 {when(g.lastSync)} · 이 PC에 쌓인 외부 일정 {g.cachedEvents ?? 0}개
                </div>
                <div className="lab">가져올 캘린더</div>
                <div className="cal-checks">
                  {(g.calendars ?? []).map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={c.selected}
                        disabled={busy}
                        onChange={(e) => {
                          const ids = (g.calendars ?? [])
                            .filter((x) => (x.id === c.id ? e.target.checked : x.selected))
                            .map((x) => x.id)
                          void run(() => window.api.setCalendars(ids))
                        }}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
                <div className="btns">
                  <button className="btn" disabled={busy} onClick={() => void run(() => window.api.syncExternal())}>
                    지금 동기화
                  </button>
                  <button className="btn" disabled={busy} onClick={() => void run(() => window.api.disconnect('google'))}>
                    연결 해제
                  </button>
                </div>
                <p className="muted small">
                  읽기 권한만 있어요. 연결을 해제해도 가져온 일정은 이 PC에 남아요.
                </p>
              </>
            )}
            {g.configured && !g.connected && (g.cachedEvents ?? 0) > 0 && (
              <p className="muted small">이전에 가져온 일정 {g.cachedEvents}개는 계속 달력에 보여요.</p>
            )}
          </Card>

        </div>
      )}
    </div>
  )
}
