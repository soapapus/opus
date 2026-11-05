import { IconClose, IconMax, IconMin } from '../icons'

export function TitleBar() {
  return (
    <div className="titlebar">
      <div className="winbtns">
        <button className="winbtn" aria-label="최소화" onClick={() => void window.api.windowControl('minimize')}>
          <IconMin size={16} />
        </button>
        <button className="winbtn" aria-label="최대화" onClick={() => void window.api.windowControl('maximize')}>
          <IconMax size={14} />
        </button>
        <button className="winbtn close" aria-label="닫기" onClick={() => void window.api.windowControl('close')}>
          <IconClose size={16} />
        </button>
      </div>
    </div>
  )
}
