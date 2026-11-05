import { useCallback, useEffect, useRef, useState } from 'react'

/** 전역 단축키로 뜨는 작은 빠른 메모 창. 쓰는 대로 저장된다. */
export function FloatingScratchpad() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState('불러오는 중…')
  const [loaded, setLoaded] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const latest = useRef('')
  const dirty = useRef(false)
  const timer = useRef<number | null>(null)

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (!dirty.current) return
    dirty.current = false
    try {
      await window.api.scratchSave(latest.current)
      setStatus('저장됨')
    } catch {
      dirty.current = true
      setStatus('저장하지 못했어요')
    }
  }, [])

  useEffect(() => {
    void window.api.scratchGet().then((n) => {
      setText(n.body)
      latest.current = n.body
      setLoaded(true)
      setStatus('저장됨')
      area.current?.focus()
      area.current?.setSelectionRange(n.body.length, n.body.length)
    })
  }, [])

  useEffect(() => window.api.onFlushRequest(flush), [flush])
  useEffect(() => {
    const onBlur = () => void flush()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [flush])

  const change = (v: string) => {
    setText(v)
    latest.current = v
    dirty.current = true
    setStatus('저장 중…')
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), 500)
  }

  const hide = async () => {
    await flush()
    await window.api.scratchHide()
  }

  return (
    <div
      className="scratch"
      onKeyDown={(e) => {
        if (e.key === 'Escape') void hide()
      }}
    >
      <div className="scratch-head">
        <b>빠른 메모</b>
        <span className="muted">{status}</span>
        <span className="spacer" />
        <button
          className="btn sm"
          disabled={!text.trim()}
          onClick={async () => {
            await flush()
            const doc = await window.api.scratchToDocument()
            setText('')
            latest.current = ''
            setStatus(doc ? `문서로 보냈어요: ${doc.title}` : '저장됨')
            area.current?.focus()
          }}
          title="이 내용을 새 문서로 만들고 빠른 메모는 비워요"
        >
          문서로 보내기
        </button>
        <button className="btn sm" onClick={() => void hide()} aria-label="닫기 (Esc)">
          닫기
        </button>
      </div>
      <textarea
        ref={area}
        value={text}
        disabled={!loaded}
        placeholder="생각나는 대로 적으세요. 자동으로 저장돼요. (Esc로 닫기)"
        onChange={(e) => change(e.target.value)}
      />
    </div>
  )
}
