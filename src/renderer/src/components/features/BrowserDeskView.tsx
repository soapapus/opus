import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserDeskState } from '../../../../shared/workspaceFeatures'
const fail = (e: unknown) => e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '브라우저 작업을 마치지 못했어요'

export function BrowserDeskView() {
  const [state, setState] = useState<BrowserDeskState | null>(null); const [address, setAddress] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  const host = useRef<HTMLDivElement>(null); const addressField = useRef<HTMLInputElement>(null)
  const active = state?.tabs.find(t => t.id === state.activeId)
  const apply = useCallback((s: BrowserDeskState) => { setState(s); if (document.activeElement !== addressField.current) setAddress(s.tabs.find(t => t.id === s.activeId)?.url.replace(/^about:blank$/, '') ?? '') }, [])
  useEffect(() => {
    let live = true; const read = () => void window.api.browserGet().then(s => { if (live) apply(s) }).catch(e => { if (live) setError(fail(e)) })
    const off = window.api.onBrowserChanged(read); const focus = window.api.onBrowserAddress(() => { addressField.current?.focus(); addressField.current?.select() }); read()
    return () => { live = false; off(); focus(); void window.api.browserBounds(null).catch(() => undefined) }
  }, [apply])
  useEffect(() => {
    if (!host.current) return
    let frame = 0; let live = true
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!live || !host.current) return
        const hidden = !!document.querySelector('[role="dialog"], [role="alertdialog"]')
        const rect = host.current.getBoundingClientRect()
        void window.api.browserBounds(hidden || !state?.embedded || !active || active.url === 'about:blank' || active.error ? null : { x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch(e => { if (live) setError(fail(e)) })
      })
    }
    const resize = new ResizeObserver(measure); resize.observe(host.current)
    const mutation = new MutationObserver(measure); mutation.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', measure); measure()
    return () => { live = false; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); window.removeEventListener('resize', measure); void window.api.browserBounds(null).catch(() => undefined) }
  }, [state?.embedded, active?.id, active?.url, active?.error])
  const run = async (fn: () => Promise<BrowserDeskState>) => { setBusy(true); setError(''); setMessage(''); try { apply(await fn()) } catch (e) { setError(fail(e)) } finally { setBusy(false) } }
  const navigate = () => { if (!active || !address.trim()) return; addressField.current?.blur(); void run(() => window.api.browserNavigate(active.id, address)) }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() === 'l') { e.preventDefault(); addressField.current?.focus(); addressField.current?.select() }
      if (e.key.toLowerCase() === 't') { e.preventDefault(); void run(() => window.api.browserNew()) }
      if (e.key.toLowerCase() === 'w' && active) { e.preventDefault(); void run(() => window.api.browserClose(active.id)) }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [active?.id])
  return <section className="browser-view feature-view cardp" aria-label="브라우저">
    <div className="browser-tabs" role="tablist" aria-label="브라우저 탭">{state?.tabs.map(t => <div key={t.id} className={`browser-tab ${state.activeId === t.id ? 'on' : ''}`}><button role="tab" aria-selected={state.activeId === t.id} title={t.url} onClick={() => { addressField.current?.blur(); void run(() => window.api.browserSelect(t.id)) }}>{t.loading ? '◌' : '◎'} {t.url === 'about:blank' ? '새 탭' : t.title}</button><button className="tab-close" aria-label={`${t.title} 탭 닫기`} onClick={() => void run(() => window.api.browserClose(t.id))}>×</button></div>)}<button className="btn sm" aria-label="새 브라우저 탭" disabled={busy || (state?.tabs.length ?? 0) >= 20} onClick={() => void run(() => window.api.browserNew())}>+</button></div>
    <div className="browser-address"><button className="btn" aria-label="브라우저 뒤로" disabled={!active?.back} onClick={() => active && void run(() => window.api.browserCommand(active.id, 'back'))}>←</button><button className="btn" aria-label="브라우저 앞으로" disabled={!active?.forward} onClick={() => active && void run(() => window.api.browserCommand(active.id, 'forward'))}>→</button><button className="btn" aria-label={active?.loading ? '페이지 로딩 중지' : '페이지 새로고침'} disabled={!active || active.url === 'about:blank'} onClick={() => active && void run(() => window.api.browserCommand(active.id, active.loading ? 'stop' : 'reload'))}>{active?.loading ? '×' : '↻'}</button><form onSubmit={e => { e.preventDefault(); navigate() }}><input ref={addressField} aria-label="브라우저 주소 또는 검색어" value={address} onChange={e => setAddress(e.target.value)} placeholder="주소 또는 검색어 입력 (Ctrl+L)" /><button className="btn" disabled={!address.trim() || !active}>이동</button></form><button className="btn" aria-label="현재 페이지 즐겨찾기" disabled={!active || active.url === 'about:blank'} onClick={() => active && void run(() => window.api.browserBookmark(active.url, active.title))}>☆</button><button className="btn-accent" disabled={!address.trim() && (!active || active.url === 'about:blank')} onClick={async () => { setError(''); try { await window.api.browserChrome(address || active?.url || ''); setMessage('현재 주소를 Chrome으로 전달했어요') } catch (e) { setError(fail(e)) } }}>Chrome에서 열기</button></div>
    <div className="browser-bookmarks" aria-label="즐겨찾기">{!state?.bookmarks.length && <span className="muted small">☆ 버튼으로 즐겨찾기를 추가하세요.</span>}{state?.bookmarks.map(b => <span key={b.id}><button title={b.url} onClick={() => active && void run(() => window.api.browserNavigate(active.id, b.url))}>☆ {b.title}</button><button aria-label={`${b.title} 즐겨찾기 제거`} onClick={() => void run(() => window.api.browserRemoveBookmark(b.id))}>×</button></span>)}</div>
    {(error || message) && <div className="feature-message">{error && <p role="alert" className="feature-error">{error}</p>}{message && <p role="status">{message}</p>}</div>}
    <div className="browser-page" ref={host}>
      {(!active || active.url === 'about:blank') && <div className="browser-start"><h1>새 탭</h1><form onSubmit={e => { e.preventDefault(); navigate() }}><input aria-label="새 탭 검색어" value={address} onChange={e => setAddress(e.target.value)} placeholder="주소나 검색어 입력 후 Enter" /><button className="btn-accent" disabled={!active || !address.trim()}>열기</button></form><p>웹페이지는 Opus 안에서 열고, 필요한 페이지는 Chrome으로 이어서 볼 수 있어요.</p><small className="muted">Chrome과 Opus의 로그인 세션은 별개예요. 로그인이 제한된 사이트는 Chrome에서 열어 주세요.</small></div>}
      {active?.error && <div className="browser-start"><h2>페이지를 열지 못했어요</h2><p role="alert">{active.error}</p><button className="btn" onClick={() => void run(() => window.api.browserCommand(active.id, 'reload'))}>다시 시도</button></div>}
      {active && active.url !== 'about:blank' && !active.error && !state?.embedded && <div className="browser-start"><h2>브라우저 미리보기</h2><p>{active.url}</p><p>실제 웹페이지는 Electron 앱에서 표시돼요.</p></div>}
    </div>
  </section>
}
