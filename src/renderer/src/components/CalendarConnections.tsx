import { useEffect, useState } from 'react'
import type { CloudState, ConnectionsState, DriveFile } from '../../../shared/types'
import { Toggle } from './SettingsLists'

export function CalendarConnections({ onChanged }: { onChanged: () => void }) {
  const [conn, setConn] = useState<ConnectionsState | null>(null)
  const [cloud, setCloud] = useState<CloudState | null>(null)
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('gemini-flash-latest')
  const [write, setWrite] = useState(false)
  const [drive, setDrive] = useState(false)
  const [folders, setFolders] = useState<DriveFile[]>([])
  const [folderId, setFolderId] = useState('')
  const [naverId, setNaverId] = useState('')
  const [naverSecret, setNaverSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const load = async () => {
    const [c, s] = await Promise.all([window.api.connections(), window.api.cloudState()])
    setConn(c); setCloud(s); setModel(s.aiModel)
    return { c, s }
  }
  useEffect(() => {
    void load().then(({ c, s }) => { setWrite(!!c.google.writeEnabled); setDrive(s.driveConnected); setFolderId(s.folder?.id ?? '') }).catch(e => setMessage(String(e)))
  }, [])
  const run = async (work: () => Promise<unknown>, done = '') => {
    setBusy(true); setMessage('')
    try { await work(); await load(); onChanged(); setMessage(done) }
    catch (e) { setMessage(e instanceof Error ? e.message : '처리하지 못했어요') }
    finally { setBusy(false) }
  }
  const g = conn?.google
  const n = conn?.naver
  return <div className="cloud-settings">
    <details className="guide">
      <summary>Google Cloud 설정 방법 (처음 한 번)</summary>
      <ol>
        <li>console.cloud.google.com에서 같은 프로젝트에 Google Calendar API, Google Drive API, Generative Language API를 사용 설정해요.</li>
        <li>Google Auth Platform에서 동의 화면과 테스트 사용자를 설정하고, OAuth 클라이언트 유형은 데스크톱 앱으로 만들어요.</li>
        <li>클라이언트 ID와 보안 비밀을 아래에 저장한 뒤, 사용할 권한을 선택하고 Google 연결을 눌러요.</li>
        <li>Gemini는 별도의 API 키가 필요해요. 해당 프로젝트에서 키를 만들고 Generative Language API로 사용 범위를 제한해요. 모델 사용 가능 여부와 요금은 프로젝트 설정을 따라요.</li>
      </ol>
      <p>회사 계정은 관리자가 앱 연결을 허용해야 할 수 있어요. Google Cloud의 API 사용 설정 자체는 콘솔에서 해야 해요.</p>
    </details>
    <form className="keyform" onSubmit={e => {
      e.preventDefault()
      void run(async () => {
        if (clientId.trim()) await window.api.cloudSaveKeys(clientId, secret)
        await window.api.aiConfigure(apiKey, model)
        setSecret(''); setApiKey(''); setClientId('')
      }, '설정을 이 PC에 저장했어요')
    }}>
      <label>Google 클라이언트 ID<input value={clientId} onChange={e => setClientId(e.target.value)} autoComplete="off" placeholder={g?.configured ? '저장됨 · 바꿀 때만 입력' : '데스크톱 앱 클라이언트 ID'} /></label>
      <label>Google 클라이언트 보안 비밀<input type="password" value={secret} onChange={e => setSecret(e.target.value)} autoComplete="off" /></label>
      <label>Gemini API 키<input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" placeholder={cloud?.aiConfigured ? '저장됨 · 바꿀 때만 입력' : 'Gemini를 사용할 때 입력'} /></label>
      <label>Gemini 모델<input value={model} onChange={e => setModel(e.target.value)} required maxLength={100} spellCheck={false} /></label>
      <button className="btn-accent" disabled={busy || !model.trim()}>Google 설정 저장</button>
      <p className="muted small">키와 토큰은 이 PC에서 암호화해 보관하며 백업에 포함하지 않아요. API 키는 Google 계정 연결과 별개예요.</p>
    </form>
    <div className="cloud-row"><span>캘린더 읽기 <small>기본 권한</small></span><span>항상 요청</span></div>
    <div className="cloud-row"><span>캘린더 쓰기 <small>선택한 내 일정을 Google에 추가</small></span><Toggle on={write} disabled={busy} label="Google 캘린더 쓰기 권한" onChange={setWrite} /></div>
    <div className="cloud-row"><span>Drive 읽기·쓰기 <small>내 드라이브·공유 드라이브 조회와 백업 업로드</small></span><Toggle on={drive} disabled={busy} label="Google Drive 읽기·쓰기 권한" onChange={setDrive} /></div>
    <p className="muted small">권한 변경은 다시 연결한 뒤 적용돼요. Drive는 계정의 파일 조회·수정 권한을 요청하지만, Opus는 선택한 폴더에서 조회·다운로드·새 백업 추가만 해요.</p>
    <div className="btns">
      <button className="btn-accent" disabled={busy || !g?.configured} onClick={() => void run(async () => {
        if (drive) await window.api.driveConnect(write)
        else { const r = await window.api.connect('google', write); if (r.google.message) throw new Error(r.google.message) }
      }, 'Google 연결 상태를 확인했어요')}>{busy ? '처리 중…' : g?.connected ? '선택한 권한으로 다시 연결' : '선택한 권한으로 Google 연결'}</button>
      {g?.connected && <button className="btn" disabled={busy} onClick={() => void run(() => window.api.driveDisconnect(), 'Google 연결을 해제했어요. 기록과 백업은 그대로예요')}>Google 연결 해제</button>}
    </div>
    <p className="cloud-status">캘린더 {g?.connected ? '연결됨' : '연결 안 됨'} · 쓰기 {g?.writeEnabled ? '허용됨' : '꺼짐'} · Drive {cloud?.driveConnected ? '연결됨' : '연결 안 됨'} · Gemini {cloud?.aiConfigured ? '키 저장됨' : '키 없음'}{g?.account ? ` · ${g.account}` : ''}</p>
    {g?.connected && <>
      <div className="lab">표시할 Google 캘린더</div>
      <div className="cal-checks">{g.calendars?.map(c => <label key={c.id}><input type="checkbox" checked={c.selected} disabled={busy} onChange={e => void run(() => window.api.setCalendars((g.calendars ?? []).filter(x => x.id === c.id ? e.target.checked : x.selected).map(x => x.id)))} />{c.name}</label>)}</div>
      <button className="btn" disabled={busy} onClick={() => void run(() => window.api.syncExternal(), '캘린더를 새로 받았어요')}>캘린더 새로고침</button>
    </>}
    <h3>Drive 백업 · 자료실</h3>
    <p className="muted small">선택한 폴더의 자료를 자료실에서 볼 수 있어요. 내 기록과 AI 대화만 백업하고, 외부 캘린더 일정과 인증 키는 제외해요. 자료실에서 백업 병합을 미리 확인하거나 아래에서 자동 병합을 켤 수 있어요.</p>
    <div className="btns">
      <button className="btn" disabled={busy || !cloud?.driveConnected} onClick={() => void run(async () => setFolders(await window.api.driveFolders()))}>Drive 폴더 조회</button>
      <select aria-label="Drive 백업 폴더" value={folderId} disabled={busy || !cloud?.driveConnected} onChange={e => setFolderId(e.target.value)}>
        <option value="">폴더 선택</option>
        {cloud?.folder && !folders.some(f => f.id === cloud.folder?.id) && <option value={cloud.folder.id}>{cloud.folder.name}</option>}
        {folders.map(f => <option key={f.id} value={f.id}>{f.driveId ? '[공유 드라이브] ' : ''}{f.name} · {f.id.slice(-6)}</option>)}
      </select>
      <button className="btn" disabled={busy || !folderId || !cloud?.driveConnected} onClick={() => void run(() => window.api.driveSelectFolder(folderId), '백업 폴더를 선택했어요. 자동 백업은 따로 켜 주세요')}>백업 폴더 적용</button>
    </div>
    <div className="cloud-row"><span>Drive 자동 백업 <small>앱 실행 중 1시간마다, 실패한 전송은 5분마다 재시도</small></span><Toggle on={!!cloud?.autoBackup} disabled={busy || !cloud?.driveConnected || !cloud.folder} label="Drive 자동 백업" onChange={on => void run(() => window.api.driveAutoBackup(on))} /></div>
    <div className="cloud-row"><span>다른 PC 백업 자동 병합 <small>5분마다 장치별 최신 백업을 확인해요. 충돌은 사본으로 보존하며 자동 백업도 함께 켜져요.</small></span><Toggle on={!!cloud?.autoMerge} disabled={busy || !cloud?.driveConnected || !cloud.folder} label="다른 PC 백업 자동 병합" onChange={on => void run(() => window.api.driveAutoMerge(on))} /></div>
    <p className="muted small">마지막 병합 {cloud?.lastMerge ? new Date(cloud.lastMerge).toLocaleString('ko-KR') : '없음'} · 같은 폴더에 연결한 같은 워크스페이스의 새 형식 백업만 자동 병합해요.</p>
    <div className="btns"><button className="btn-accent" disabled={busy || !cloud?.folder || !cloud.driveConnected} onClick={() => void run(async () => {
      const s = await window.api.driveBackup(); if (s.error) throw new Error(s.error)
    }, 'Drive 백업을 완료했어요')}>지금 Drive 백업</button><span className="muted small">전송 대기 {cloud?.pendingBackups ?? 0}개 · 마지막 완료 {cloud?.lastBackup ? new Date(cloud.lastBackup).toLocaleString('ko-KR') : '없음'}</span></div>
    {cloud?.error && <p role="alert">{cloud.error}</p>}
    <details className="guide"><summary>네이버 캘린더 연결</summary>
      <p>공식 API는 일정 추가만 지원해요. 조회·수정·양방향 동기화는 지원하지 않아요. 내 일정 편집 메뉴에서 선택한 일정만 내보낼 수 있어요.</p>
      <p className="muted small">네이버 개발자센터에서 로그인·캘린더 API를 설정하고 콜백을 http://127.0.0.1:53682/naver/callback 으로 등록해 주세요.</p>
      <div className="keyform"><label>네이버 Client ID<input value={naverId} onChange={e => setNaverId(e.target.value)} autoComplete="off" /></label><label>네이버 Client Secret<input type="password" value={naverSecret} onChange={e => setNaverSecret(e.target.value)} autoComplete="off" /></label>
      <button className="btn" disabled={busy || !naverId.trim() || !naverSecret.trim()} onClick={() => void run(async () => { await window.api.saveKeys('naver', naverId, naverSecret); setNaverSecret('') }, '네이버 키를 저장했어요')}>네이버 키 저장</button></div>
      <div className="btns"><button className="btn" disabled={busy || !n?.configured} onClick={() => void run(async () => { const r = await window.api.connect('naver'); if (r.naver.message) throw new Error(r.naver.message) }, '네이버 연결 상태를 확인했어요')}>네이버 연결</button>{n?.connected && <button className="btn" disabled={busy} onClick={() => void run(() => window.api.disconnect('naver'))}>네이버 연결 해제</button>}</div>
      <p>{n?.connected ? '연결됨 · 일정 내보내기 가능' : '연결 안 됨'}</p>
    </details>
    <p role="status" className="conn-msg">{message}</p>
  </div>
}
