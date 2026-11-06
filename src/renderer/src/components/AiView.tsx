// AI 탭: 왼쪽 대화 목록 + 오른쪽 대화 (모델 선택, 서식 있는 답변, 아래 둥근 입력창)
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AiChat, AiChatSummary, CloudState } from '../../../shared/types'
import { parseMarkdown, type Block, type Inline } from '../../../shared/markdown'
import { IconPlus, IconSearch } from '../icons'

const pad = (n: number): string => String(n).padStart(2, '0')
const localDay = (iso: string): string => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 최근 대화를 오늘·어제·지난 7일·이전으로 묶는다 */
export function groupChats(list: AiChatSummary[], now = new Date()): { label: string; items: AiChatSummary[] }[] {
  const day = (offset: number): string => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset).toISOString())
  const today = day(0), yesterday = day(1), week = day(7)
  const groups = [
    { label: '오늘', items: [] as AiChatSummary[] },
    { label: '어제', items: [] as AiChatSummary[] },
    { label: '지난 7일', items: [] as AiChatSummary[] },
    { label: '이전', items: [] as AiChatSummary[] }
  ]
  for (const c of list) {
    const d = localDay(c.updated)
    groups[d === today ? 0 : d === yesterday ? 1 : d > week ? 2 : 3].items.push(c)
  }
  return groups.filter((g) => g.items.length)
}

function Inlines({ c }: { c: Inline[] }): ReactNode {
  return c.map((x, i) =>
    x.t === 'text' ? <Fragment key={i}>{x.v}</Fragment>
    : x.t === 'b' ? <strong key={i}><Inlines c={x.c} /></strong>
    : x.t === 'i' ? <em key={i}><Inlines c={x.c} /></em>
    : x.t === 'code' ? <code key={i}>{x.v}</code>
    : <a key={i} href={x.href} target="_blank" rel="noreferrer noopener"><Inlines c={x.c} /></a>
  )
}

function CodeBlock({ lang, v }: { lang: string; v: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="ai-code">
      <div className="ai-code-h">
        <span>{lang || '코드'}</span>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(v).then(() => { setDone(true); setTimeout(() => setDone(false), 1200) })}>
          {done ? '복사됨' : '복사'}
        </button>
      </div>
      <pre><code>{v}</code></pre>
    </div>
  )
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  const one = (b: Block, i: number): ReactNode => {
    switch (b.t) {
      case 'p': return <p key={i}><Inlines c={b.c} /></p>
      case 'h': return b.level <= 2 ? <h3 key={i}><Inlines c={b.c} /></h3> : <h4 key={i}><Inlines c={b.c} /></h4>
      case 'hr': return <hr key={i} />
      case 'quote': return <blockquote key={i}><Inlines c={b.c} /></blockquote>
      case 'code': return <CodeBlock key={i} lang={b.lang} v={b.v} />
      case 'list': {
        const items = b.items.map((it, j) => <li key={j}><Inlines c={it} /></li>)
        return b.ordered ? <ol key={i} start={b.start}>{items}</ol> : <ul key={i}>{items}</ul>
      }
      case 'table':
        return (
          <div className="ai-table" key={i}>
            <table>
              <thead><tr>{b.head.map((h, j) => <th key={j}><Inlines c={h} /></th>)}</tr></thead>
              <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Inlines c={c} /></td>)}</tr>)}</tbody>
            </table>
          </div>
        )
    }
  }
  return <div className="md">{blocks.map(one)}</div>
}

function ChatRow({ c, on, busy, onOpen, onRename }: { c: AiChatSummary; on: boolean; busy: boolean; onOpen: () => void; onRename: (t: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(c.title)
  if (editing)
    return (
      <form className="ai-chat-row editing" onSubmit={(e) => { e.preventDefault(); setEditing(false); if (name.trim() && name.trim() !== c.title) onRename(name) }}>
        <input autoFocus aria-label="대화 이름" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} />
      </form>
    )
  return (
    <div className={`ai-chat-row ${on ? 'on' : ''}`}>
      <button type="button" className="ai-chat-open" title={c.title} aria-current={on ? 'true' : undefined} onClick={onOpen}>{c.title}</button>
      <button type="button" className="ai-chat-edit" aria-label={`${c.title} 이름 바꾸기`} title="이름 바꾸기" disabled={busy} onClick={() => { setName(c.title); setEditing(true) }}>✎</button>
    </div>
  )
}

/** 다른 메뉴에 다녀와도 보던 대화를 다시 연다 (앱이 켜져 있는 동안만) */
let lastChatId: string | null = null
/** 대화별 마지막 실패 이유. 다른 메뉴에 다녀와도 답이 없는 질문 아래에 계속 보여 준다 */
const chatErrors = new Map<string, string>()
const clean = (e: unknown, fallback: string): string =>
  (e instanceof Error ? e.message : String(e || fallback)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || fallback

export function AiView({ onSettings }: { onSettings: () => void }) {
  const [list, setList] = useState<AiChatSummary[]>([])
  const [chat, setChat] = useState<AiChat | null>(null)
  const [state, setState] = useState<CloudState | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [keyError, setKeyError] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const current = useRef<string | null>(null)
  current.current = chat?.id ?? null
  useEffect(() => { if (chat) lastChatId = chat.id }, [chat])

  const refresh = useCallback(async () => {
    const [l, s] = await Promise.all([window.api.aiChats(), window.api.cloudState()])
    setList(l)
    setState(s)
    const id = current.current ?? lastChatId
    if (id && l.some((c) => c.id === id)) setChat(await window.api.aiChat(id))
  }, [])
  useEffect(() => { refresh().catch((e) => setError(e instanceof Error ? e.message : String(e))) }, [refresh])
  useEffect(() => window.api.onFilesChanged(() => { if (!busy) void refresh().catch(() => undefined) }), [busy, refresh])
  useEffect(() => {
    if (!state?.aiConfigured) return
    // 모델 목록을 받아 보면 키가 맞는지도 알 수 있다
    window.api.aiModels().then((m) => { setModels(m); setKeyError('') }).catch((e) => { setModels([]); setKeyError(clean(e, '키를 확인하지 못했어요')) })
  }, [state?.aiConfigured])
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }) }, [chat?.messages.length, pending, chat?.id])
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [draft])

  const open = async (id: string | null) => {
    if (busy) return
    setError('')
    if (!id) lastChatId = null
    setChat(id ? await window.api.aiChat(id).catch((e) => { setError(e instanceof Error ? e.message : String(e)); return null }) : null)
    input.current?.focus()
  }
  const run = async (work: () => Promise<AiChat>, question = '') => {
    setBusy(true); setError(''); setPending(question)
    const before = current.current
    let failed = ''
    try {
      const c = await work()
      chatErrors.delete(c.id)
      setChat(c)
    } catch (e) {
      failed = clean(e, '답변을 받지 못했어요')
      if (before) chatErrors.set(before, failed)
      setError(failed)
    } finally {
      setPending(''); setBusy(false)
      try {
        const [l, s] = await Promise.all([window.api.aiChats(), window.api.cloudState()])
        setList(l); setState(s)
        // 실패해도 질문은 저장되므로, 새 대화였다면 저장된 대화를 연다
        if (!current.current && l[0] && question) {
          if (failed) chatErrors.set(l[0].id, failed)
          setChat(await window.api.aiChat(l[0].id))
        } else if (current.current) setChat(await window.api.aiChat(current.current))
      } catch { /* 표시된 대화 유지 */ }
    }
  }
  const send = () => {
    const text = draft.trim()
    if (busy || !text || !state?.aiConfigured) return
    setDraft('')
    void run(() => window.api.aiSend(chat?.id ?? null, text), text)
  }
  const setModel = async (m: string) => {
    try { setState(await window.api.aiConfigure('', m)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const shown = list.filter((c) => !query.trim() || c.title.toLowerCase().includes(query.trim().toLowerCase()))
  const groups = groupChats(shown)
  const lastModel = chat ? chat.messages.map((m) => m.role).lastIndexOf('model') : -1
  // 마지막이 내 질문이면 답을 못 받은 것: 이유와 다시 보내기를 계속 보여 준다
  const unanswered = !!chat && !busy && chat.messages.at(-1)?.role === 'user'
  const reason = (chat && chatErrors.get(chat.id)) || error
  const modelOptions = [...new Set([state?.aiModel ?? '', ...models].filter(Boolean))]

  return (
    <div className="ai2">
      <aside className="ai-list cardp" aria-label="AI 대화 목록">
        <button type="button" className="ai-new" onClick={() => void open(null)} disabled={busy}><IconPlus size={15} /> 새 대화</button>
        <label className="ai-search"><IconSearch size={14} /><input aria-label="대화 검색" placeholder="대화 검색" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <div className="ai-groups">
          {!list.length && <p className="ai-list-empty">아직 대화가 없어요.</p>}
          {!!list.length && !shown.length && <p className="ai-list-empty">검색한 대화가 없어요.</p>}
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2>{g.label}</h2>
              {g.items.map((c) => (
                <ChatRow key={c.id} c={c} on={c.id === chat?.id} busy={busy} onOpen={() => void open(c.id)}
                  onRename={(t) => void window.api.aiRename(c.id, t).then((r) => { if (chat?.id === r.id) setChat(r); return refresh() }).catch((e) => setError(String(e)))} />
              ))}
            </section>
          ))}
        </div>
      </aside>

      <section className="cloud-view ai-main cardp" aria-label="AI">
        <header className="cardp-h ai-head">
          <h1 title={chat?.title}>{chat?.title ?? '새 대화'}</h1>
          <span className="spacer" />
          {state?.aiConfigured && (
            <label className="ai-model">
              <span>Gemini</span>
              <select aria-label="Gemini 모델" value={state.aiModel} disabled={busy} onChange={(e) => void setModel(e.target.value)}>
                {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          )}
          {state?.aiConfigured && <span className="ai-tokens" title="이 PC에서 이번 달 쓴 양">이번 달 {(state.aiTokensThisMonth ?? 0).toLocaleString('ko-KR')} 토큰</span>}
          <button className="btn sm" onClick={onSettings} disabled={busy}>설정</button>
        </header>

        <div className="ai-scroll" ref={scroll}>
          <div className="ai-thread" aria-live="polite">
            {state?.aiConfigured && keyError && (
              <div className="ai-keycheck" role="alert">
                <span>Gemini 키 확인 실패: {keyError}</span>
                <button className="btn sm" onClick={onSettings}>설정 열기</button>
              </div>
            )}
            {!chat && !pending && (
              <div className="ai-empty">
                <h2>무엇을 도와드릴까요?</h2>
                <p>질문과 이 대화의 최근 메시지 30개만 Gemini로 보내요. 메모·자료실·회사 일정은 자동으로 보내지 않아요.</p>
                {state && !state.aiConfigured && (
                  <p>먼저 설정에서 Gemini API 키를 저장해 주세요. <button className="btn sm" onClick={onSettings}>Google 연동 설정 열기</button></p>
                )}
              </div>
            )}
            {chat?.messages.map((m, i) =>
              m.role === 'user' ? (
                <article key={i} className="ai-message user"><div className="bubble">{m.text}</div></article>
              ) : (
                <article key={i} className="ai-message model">
                  <Markdown text={m.text} />
                  <div className="ai-actions">
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(m.text)}>복사</button>
                    {i === lastModel && i === chat.messages.length - 1 && (
                      <button type="button" disabled={busy} onClick={() => void run(() => window.api.aiRegenerate(chat.id))}>다시 생성</button>
                    )}
                  </div>
                </article>
              )
            )}
            {pending && <article className="ai-message user"><div className="bubble">{pending}</div></article>}
            {busy && <p className="ai-wait" role="status">Gemini 답변을 기다리고 있어요…</p>}
            {unanswered && (
              <div className="ai-unanswered">
                <p className="ai-error" role="alert">{reason || '이 질문에는 아직 답이 없어요. 다시 보내 보세요.'}</p>
                <button type="button" className="btn sm" disabled={!state?.aiConfigured} onClick={() => void run(() => window.api.aiRegenerate(chat!.id))}>다시 보내기</button>
              </div>
            )}
            {!unanswered && error && <p className="ai-error" role="alert">{error}</p>}
          </div>
        </div>

        <form className="ai-compose" onSubmit={(e) => { e.preventDefault(); send() }}>
          <div className="ai-box">
            <textarea
              ref={input}
              aria-label="Gemini에게 질문"
              rows={1}
              maxLength={30000}
              placeholder={state?.aiConfigured === false ? '설정에서 Gemini API 키를 먼저 저장해 주세요' : '무엇이든 물어보세요'}
              value={draft}
              disabled={busy || !state?.aiConfigured}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // 한글 조합 중 Enter는 글자 확정이므로 보내지 않는다
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
              }}
            />
            <button className="ai-send" aria-label="Gemini에 전송" title="보내기 (Enter)" disabled={busy || !state?.aiConfigured || !draft.trim()}>↑</button>
          </div>
          <p className="ai-hint">Enter 보내기 · Shift+Enter 줄바꿈 · AI의 답은 틀릴 수 있으니 중요한 내용은 확인하세요</p>
        </form>
      </section>
    </div>
  )
}
