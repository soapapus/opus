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
