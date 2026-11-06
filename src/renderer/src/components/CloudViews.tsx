import { useEffect, useState } from 'react'
import type { AiMessage, CloudState, DriveFile, MergeReport } from '../../../shared/types'

export function LibraryView({ onSettings }: { onSettings: () => void }) {
  const [files, setFiles] = useState<DriveFile[]>([])
  const [state, setState] = useState<CloudState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [merge, setMerge] = useState<MergeReport | null>(null)
  const [merged, setMerged] = useState(false)
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : '자료를 읽지 못했어요') }
    finally { setBusy(false) }
  }
  const refresh = async () => {
    const s = await window.api.cloudState(); setState(s)
    setFiles(s.driveConnected && s.folder ? await window.api.driveFiles() : [])
  }
  useEffect(() => { void run(refresh) }, [])
  return <section className="cloud-view cardp" aria-label="자료실">
    <header className="cardp-h"><h1>자료실</h1><button className="btn" disabled={busy} onClick={() => void run(refresh)}>새로고침</button></header>
    <div className="cloud-scroll">
      <p>Google Drive의 선택한 폴더에 있는 자료와 Opus 백업을 확인해요.</p>
      <p className="muted">{state?.driveConnected && state.folder ? `연결 폴더: ${state.folder.name}` : '설정에서 Google Drive를 연결하고 폴더를 선택해 주세요.'}</p>
      <button className="btn" onClick={onSettings}>Google 연동 설정</button>
      <label className="cloud-search">자료 검색<input value={query} onChange={e => setQuery(e.target.value)} placeholder="파일 이름" /></label>
      {busy && <p role="status">자료를 확인하고 있어요…</p>}
      {error && <p role="alert">{error}</p>}
      {merge && <div className="ai-message" role="region" aria-label="백업 병합 미리보기">
        <b>백업의 기록을 현재 워크스페이스와 합쳐요</b>
        <p>새 기록 {merge.added}개 · 이어서 갱신 {merge.updated}개 · 충돌 사본 {merge.conflicts}개 · 같은 기록 {merge.unchanged}개 · 보관 기록 {merge.archived}개</p>
        <p>추가 대화 {merge.aiMessages}개 메시지 · 별도로 보존할 대화 {merge.aiArchives}개</p>
        <p className="muted small">병합 전에 현재 기록을 백업해요. 원본 ZIP은 유지하고, 백업에 없는 기록도 지우지 않아요.</p>
        <div className="btns"><button className="btn-accent" disabled={busy} onClick={() => void run(async () => { await window.api.driveMergeApply(merge.token); setMerge(null); setMerged(true) })}>미리보기대로 기록 합치기</button><button className="btn" disabled={busy} onClick={() => setMerge(null)}>취소</button></div>
      </div>}
      {merged && <p role="status">기록을 합쳤어요. 메모와 AI 탭에서 확인할 수 있어요.</p>}
      {!busy && state?.driveConnected && state.folder && !files.length && <p>이 폴더에는 자료가 없어요. 설정에서 첫 Drive 백업을 만들 수 있어요.</p>}
      {!!files.length && !files.some(f => f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <p>검색한 자료가 없어요.</p>}
      <ul className="cloud-files">{files.filter(f => f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(f => <li key={f.id}>
        <span><b>{f.name}</b><small>{f.modifiedTime ? new Date(f.modifiedTime).toLocaleString('ko-KR') : ''}{f.size ? ` · ${Math.ceil(Number(f.size) / 1024).toLocaleString()} KB` : ''}</small></span>
        <button className="btn" disabled={busy} onClick={() => void run(() => window.api.driveOpen(f.id))}>자료 열기</button>
        {!f.mimeType.startsWith('application/vnd.google-apps.') && <button className="btn" disabled={busy} onClick={() => void run(() => window.api.driveDownload(f.id))}>내려받기</button>}
        {f.mimeType === 'application/zip' && <button className="btn" disabled={busy} onClick={() => void run(async () => { setMerged(false); setMerge(await window.api.driveMergePreview(f.id)) })}>기록 합치기 미리보기</button>}
      </li>)}</ul>
      <p className="muted small">백업 ZIP은 내려받아 별도 폴더에 풀어 기록을 확인할 수 있어요. 자료를 열거나 내려받아도 현재 메모는 바뀌지 않아요.</p>
    </div>
  </section>
}

export function AiView({ onSettings }: { onSettings: () => void }) {
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [state, setState] = useState<CloudState | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [archives, setArchives] = useState<{ id: string; messages: AiMessage[] }[]>([])
  const [archive, setArchive] = useState('')
  useEffect(() => {
    void Promise.all([window.api.aiMessages(), window.api.cloudState(), window.api.aiArchives()])
      .then(([m, s, a]) => { setMessages(m); setState(s); setArchives(a) })
      .catch(e => setError(String(e)))
  }, [])
  useEffect(() => window.api.onFilesChanged(() => {
    if (busy) return
    void Promise.all([window.api.aiMessages(), window.api.aiArchives()]).then(([m, a]) => { setMessages(m); setArchives(a) }).catch(e => setError(String(e)))
  }), [busy])
  const send = async () => {
    if (busy || !draft.trim()) return
    setBusy(true); setError('')
    try { setMessages(await window.api.aiSend(draft)); setDraft('') }
    catch (e) {
      setError(e instanceof Error ? e.message : '답변을 받지 못했어요')
      try { setMessages(await window.api.aiMessages()); setArchives(await window.api.aiArchives()) } catch { /* 원래 표시된 대화는 유지 */ }
    } finally { setBusy(false) }
  }
  return <section className="cloud-view cardp" aria-label="AI">
    <header className="cardp-h"><h1>AI · Gemini</h1><button className="btn" onClick={onSettings} disabled={busy}>Google 연동 설정</button></header>
    <div className="cloud-scroll">
      <p className="muted">질문과 최근 대화 최대 30개 메시지를 Gemini로 전송해요. 메모·자료실·회사 일정은 자동으로 보내지 않아요. API 사용 요금이 발생할 수 있어요.</p>
      {!state?.aiConfigured && <p>설정에서 Gemini API 키를 저장하면 대화를 시작할 수 있어요.</p>}
      <p className="muted small">대화는 현재 워크스페이스에 저장되며 Opus 백업에 포함돼요. 모델: {state?.aiModel ?? '확인 중'}</p>
      {!messages.length && <p>요약할 글이나 정리하고 싶은 생각을 직접 입력해 보세요.</p>}
      {!!archives.length && <label className="cloud-search">AI 대화 선택<select value={archive} onChange={e => setArchive(e.target.value)} disabled={busy}><option value="">내 대화</option>{archives.map(a => <option value={a.id} key={a.id}>다른 PC 대화 · {a.messages[0]?.text.slice(0, 40) || a.id.slice(0, 8)}</option>)}</select></label>}
      {archive && <p className="muted small">다른 PC에서 갈라진 대화예요. 내용을 그대로 보존하며, 새 질문은 내 대화에서 할 수 있어요.</p>}
      <div className="ai-messages" aria-live="polite">{(archive ? archives.find(a => a.id === archive)?.messages ?? [] : messages).map((m, i) => <article key={i} className={`ai-message ${m.role}`}><b>{m.role === 'user' ? '나' : 'Gemini'}</b><div>{m.text}</div></article>)}</div>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Gemini 답변을 기다리고 있어요…</p>}
      <form className="ai-compose" onSubmit={e => { e.preventDefault(); void send() }}>
        <label>Gemini에게 질문<textarea value={draft} maxLength={30000} onChange={e => setDraft(e.target.value)} disabled={busy || !!archive} rows={5} placeholder="질문이나 요약할 글을 입력하세요" /></label>
        <button className="btn-accent" disabled={busy || !!archive || !state?.aiConfigured || !draft.trim()}>Gemini에 전송</button>
      </form>
    </div>
  </section>
}
