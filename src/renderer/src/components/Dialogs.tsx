import { useEffect } from 'react'
import type { AppInfo } from '../../../shared/types'

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel
}: {
  title: string
  message: string
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => !busy && e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, busy])
  return (
    <div className="overlay" onMouseDown={() => !busy && onCancel()}>
      <div className="dialog" role="alertdialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="actions">
          <button className="btn" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button className="btn danger" autoFocus disabled={busy} onClick={onConfirm}>
            {busy ? '처리 중…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function fmt(iso: string | null): string {
  if (!iso) return '아직 없음'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function SettingsDialog({
  info,
  busy,
  onChooseData,
  onChooseBackup,
  onOpenData,
  onBackup,
  onRebuild,
  onClose
}: {
  info: AppInfo
  busy: boolean
  onChooseData: () => void
  onChooseBackup: () => void
  onOpenData: () => void
  onBackup: () => void
  onRebuild: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label="설정" onMouseDown={(e) => e.stopPropagation()}>
        <h2>설정</h2>
        <p>메모는 아래 폴더에 글 파일(.md)로 저장돼요. 이 폴더만 옮기면 다른 컴퓨터에서도 그대로 쓸 수 있어요.</p>

        <div className="set-row">
          <div className="lab">메모 보관 폴더</div>
          <div className="val">{info.dataDir}</div>
          <div className="btns">
            <button className="btn" disabled={busy} onClick={onChooseData}>
              폴더 바꾸기
            </button>
            <button className="btn" onClick={onOpenData}>
              폴더 열기
            </button>
          </div>
        </div>
        <div className="set-row">
          <div className="lab">백업 폴더</div>
          <div className="val">{info.backupDir}</div>
          <div className="btns">
            <button className="btn" disabled={busy} onClick={onChooseBackup}>
              폴더 바꾸기
            </button>
          </div>
        </div>
        <div className="set-row">
          <div className="lab">백업</div>
          <div className="val">
            하루에 한 번 자동으로 백업하고 지우지 않고 모두 보관해요. 마지막 백업: {fmt(info.lastBackup)}
          </div>
          <div className="btns">
            <button className="btn primary" disabled={busy} onClick={onBackup}>
              지금 백업
            </button>
          </div>
        </div>
        <div className="set-row">
          <div className="lab">검색 목록</div>
          <div className="val">메모 {info.totalNotes}개. 파일을 직접 고쳤다면 다시 만들어 주세요.</div>
          <div className="btns">
            <button className="btn" disabled={busy} onClick={onRebuild}>
              검색 목록 다시 만들기
            </button>
          </div>
        </div>
        <div className="set-row">
          <div className="lab">빠른 메모 단축키</div>
          <div className="val">
            {info.scratchShortcut
              ? 'Ctrl + Shift + Space 를 누르면 어느 프로그램에서든 작은 메모창이 떠요.'
              : '다른 프로그램이 이미 쓰고 있어서 단축키를 등록하지 못했어요. 왼쪽 메뉴의 “빠른 메모”로 열 수 있어요.'}
          </div>
        </div>
        <div className="set-row">
          <div className="lab">버전</div>
          <div className="val">라임 다이어리 {info.appVersion}</div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
