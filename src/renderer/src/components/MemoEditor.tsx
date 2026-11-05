import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Markdown } from '@tiptap/markdown'
import type { Note, NoteKind, NoteSummary, Provider, SavedNote } from '../../../shared/types'
import { formatDateLabel, todayStr } from '../../../shared/calendar'
import { hasLimeDrag, readDrag, type DragPayload } from '../dnd'
import { timeOf } from '../../../shared/text'
import { editorHandle } from '../bridge'
import {
  IconBold,
  IconItalic,
  IconLink,
  IconTrash
} from '../icons'

import { BLOCK_COMMANDS, runBlockCommand, taskHandles } from './EditorCommands'

const SAVE_DELAY = 600

interface Props {
  note: Note
  autoFocusTitle: boolean
  /** 이 기록과 명시적으로 연결된 다른 기록 */
  linked: NoteSummary[]
  onSaved: (note: SavedNote) => void
  onDelete: () => void
  onOpenLinked: (id: string) => void
  onUnlink: (id: string) => void
  onKind: (kind: NoteKind) => void
  /** 문서를 날짜의 일정으로 만든다 (연결도 함께) */
  onMakeEvent: (date: string) => void
  /** 문서 편집기에 일정/기록을 끌어다 놓았을 때 */
  onDropItem: (payload: DragPayload) => void
  /** 일정을 내보낼 수 있는 연결된 외부 캘린더 */
  exportTargets: Provider[]
  onExport: (provider: Provider) => void
}

const KIND_LABEL: Record<NoteKind, string> = { note: '기록', event: '일정', document: '문서' }

function hhmm(d = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function MemoEditor({
  note,
  autoFocusTitle,
  linked,
  onSaved,
  onDelete,
  onOpenLinked,
  onUnlink,
  onKind,
  onMakeEvent,
  onDropItem,
  exportTargets,
  onExport
}: Props) {
  const [title, setTitle] = useState(note.title)
  const [tags, setTags] = useState<string[]>(note.tags)
  const [tagDraft, setTagDraft] = useState('')
  const [status, setStatus] = useState<{ kind: 'saved' | 'pending' | 'error'; text: string }>({
    kind: 'saved',
    text: `저장됨 ${timeOf(note.updated)}`
  })
  const [time, setTime] = useState(note.time ?? '')
  const [eventOpen, setEventOpen] = useState(false)
  const [eventDate, setEventDate] = useState(todayStr())
  const [dropOver, setDropOver] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [slash, setSlash] = useState<{ from: number; to: number; query: string; x: number; y: number } | null>(null)
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null)
  const [commandIndex, setCommandIndex] = useState(0)
  const slashRef = useRef(slash)
  const commandRef = useRef(commandIndex)
  slashRef.current = slash
  commandRef.current = commandIndex
  const menuRoot = useRef<HTMLDivElement>(null)
  const saving = useRef(0)
  const serializationFailed = useRef(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  // 저장 시점에 항상 최신 값을 쓰기 위해 ref에도 둔다
  const latest = useRef({ title: note.title, tags: note.tags, body: note.body, time: note.time })
  const dirty = useRef(false)
  // 다른 PC에서 같은 메모를 고쳤는지 알아보려고, 마지막으로 읽거나 저장한 updated 값을 기억한다
  const base = useRef(note.updated)
  const timer = useRef<number | null>(null)
  const inflight = useRef<Promise<void>>(Promise.resolve())
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved

  const doSave = useCallback((): Promise<void> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (serializationFailed.current || !dirty.current) return inflight.current
    dirty.current = false
    const { time: t, ...rest } = latest.current
    const snapshot = note.kind === 'event' ? { ...rest, time: t } : rest
    saving.current++
    const run = inflight.current.then(async () => {
      try {
        const saved = await window.api.saveNote({ id: note.id, ...snapshot, baseUpdated: base.current })
        base.current = saved.updated
        onSavedRef.current(saved)
        if (!dirty.current && saving.current === 1) setStatus({ kind: 'saved', text: `저장됨 ${hhmm()}` })
      } catch (error) {
        dirty.current = true
        setStatus({ kind: 'error', text: `저장하지 못했어요${error instanceof Error ? `: ${error.message}` : ''}` })
      } finally { saving.current-- }
    })
    inflight.current = run
    return run
  }, [note.id, note.kind])

  const markDirty = useCallback(() => {
    dirty.current = true
    setStatus({ kind: 'pending', text: '저장 중…' })
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void doSave(), SAVE_DELAY)
  }, [doSave])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        link: { openOnClick: false, autolink: true }
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown,
      taskHandles(note.id)
    ],
    content: note.body,
    contentType: 'markdown',
    onBlur: () => { setBubble(null); setSlash(null) },
    editorProps: {
      attributes: { 'data-placeholder': '여기에 적으면 자동으로 저장돼요', spellcheck: 'false' },
      handleKeyDown: (view, event) => {
        if (event.isComposing || view.composing || !slashRef.current) return false
        const s = slashRef.current
        const commands = BLOCK_COMMANDS.filter(c => (c.label + c.hint + c.id).toLowerCase().includes(s.query.toLowerCase()))
        if (event.key === 'Escape') { setSlash(null); return true }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          setCommandIndex(i => (i + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, commands.length)) % Math.max(1, commands.length))
          return true
        }
        if (event.key === 'Enter' && commands.length) {
          event.preventDefault()
          runBlockCommand(editor!, commands[Math.min(commandRef.current, commands.length - 1)].id, s.from, s.to)
          setSlash(null)
          return true
        }
        return false
      },
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest('a')
        if (a && (event.ctrlKey || event.metaKey)) {
          window.open(a.getAttribute('href') ?? '', '_blank')
          return true
        }
        return false
      }
    },
    onUpdate: ({ editor: ed }) => {
      try {
        latest.current.body = ed.getMarkdown()
        serializationFailed.current = false
        markDirty()
      } catch {
        serializationFailed.current = true
        dirty.current = true
        setStatus({ kind: 'error', text: '본문을 저장 형식으로 바꾸지 못했어요. 내용을 복사해 보관해 주세요' })
      }
    },
    onTransaction: ({ editor: ed }) => {
      const { selection } = ed.state
      const root = menuRoot.current?.getBoundingClientRect()
      if (!root) return
      const coords = ed.view.coordsAtPos(selection.from)
      if (!selection.empty && ed.isFocused) {
        setBubble({ x: Math.max(8, Math.min(root.width - 210, coords.left - root.left)), y: Math.max(4, coords.top - root.top - 42) })
      } else setBubble(null)
      const parent = selection.$from.parent
      const text = parent.textBetween(0, selection.$from.parentOffset, '', '')
      if (selection.empty && parent.isTextblock && /^\/[^\/]*$/.test(text) && parent.textContent === text) {
        setSlash({ from: selection.from - text.length, to: selection.from, query: text.slice(1),
          x: Math.max(8, Math.min(root.width - 240, coords.left - root.left)),
          y: Math.max(4, Math.min(root.height - 290, coords.bottom - root.top + 6)) })
        setCommandIndex(0)
      } else setSlash(null)
    }
  })

  // 열려 있는 동안 "지금 저장" 요청을 받을 수 있게 등록
  useEffect(() => {
    const handle = {
      flush: async () => {
        await doSave()
        if (dirty.current) throw new Error('메모를 저장하지 못했어요')
      },
      insertTask: (text: string) => {
        if (!editor) return
        editor
          .chain()
          .focus('end')
          .insertContent({
            type: 'taskList',
            content: [
              { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
            ]
          })
          .run()
      },
      isDirty: () => dirty.current || timer.current !== null || saving.current > 0,
      baseUpdated: () => base.current
    }
    editorHandle.current = handle
    return () => {
      void doSave()
      if (editorHandle.current === handle) editorHandle.current = null
    }
  }, [doSave, editor])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void doSave() }
      if (e.key === 'Escape') { setMoreOpen(false); setSlash(null); setBubble(null) }
    }
    const blur = () => void doSave()
    const outside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.editor-more')) setMoreOpen(false)
    }
    window.addEventListener('keydown', key)
    window.addEventListener('blur', blur)
    document.addEventListener('mousedown', outside)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('blur', blur); document.removeEventListener('mousedown', outside) }
  }, [doSave])

  useEffect(() => {
    if (autoFocusTitle) titleRef.current?.focus()
  }, [autoFocusTitle])

  // 긴 제목은 잘라 내지 않고 줄바꿈해서 보여 준다
  useLayoutEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [title])

  const st = useEditorState({
    editor,
    selector: (ctx) => {
      const e = ctx.editor
      if (!e) return null
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        bullet: e.isActive('bulletList'),
        task: e.isActive('taskList'),
        link: e.isActive('link'),
        block: e.isActive('heading', { level: 1 })
          ? 'h1'
          : e.isActive('heading', { level: 2 })
            ? 'h2'
            : 'p'
      }
    }
  })

  const changeTime = (v: string) => {
    setTime(v)
    latest.current.time = v || null
    markDirty()
  }
  const changeTitle = (v: string) => {
    setTitle(v)
    latest.current.title = v
    markDirty()
  }
  const commitTags = (next: string[]) => {
    setTags(next)
    latest.current.tags = next
    markDirty()
  }
  const addTag = () => {
    const t = tagDraft.replace(/^#+/, '').trim()
    setTagDraft('')
    if (!t || tags.includes(t)) return
    commitTags([...tags, t])
  }

  const openLink = () => {
    if (!editor) return
    setLinkValue((editor.getAttributes('link').href as string | undefined) ?? '')
    setLinkOpen(true)
  }
  const applyLink = () => {
    if (!editor) return
    let href = linkValue.trim()
    if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) href = `https://${href}`
    const chain = editor.chain().focus().extendMarkRange('link')
    if (href) chain.setLink({ href }).run()
    else chain.unsetLink().run()
    setLinkOpen(false)
  }

  return (
    <div
      ref={menuRoot}
      className={`card editor ${dropOver ? 'drop' : ''}`}
      onDragOver={(e) => {
        if (note.kind !== 'document' || !hasLimeDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver(false)
      }}
      onDrop={(e) => {
        setDropOver(false)
        if (note.kind !== 'document') return
        const payload = readDrag(e)
        if (!payload || payload.kind === 'document') return
        e.preventDefault()
        onDropItem(payload)
      }}
    >
      {!note.classified && (
        <div className="banner">
          예전에 만든 기록이라 종류가 정해지지 않았어요. 지금은 달력 기록으로 보여 드려요.
          <span className="banner-btns">
            <button className="btn sm" onClick={() => onKind('note')}>
              달력 기록으로 확정
            </button>
            <button className="btn sm" onClick={() => onKind('document')}>
              문서로 옮기기
            </button>
          </span>
        </div>
      )}
      <div className="editor-more">
        <button className="icon-btn" aria-label="메모 더보기" aria-expanded={moreOpen} onClick={() => setMoreOpen(v => !v)}>···</button>
        {moreOpen && <div className="editor-actions" role="menu" aria-label="메모 작업">
          <button role="menuitem" onClick={() => { void doSave(); setMoreOpen(false) }}>지금 저장 (Ctrl+S)</button>
          {note.kind === 'document' && <button role="menuitem" onClick={() => { setEventOpen(true); setMoreOpen(false) }}>일정으로 만들기</button>}
          {note.kind === 'document' && note.id !== 'scratchpad' && <button role="menuitem" onClick={() => { onKind('note'); setMoreOpen(false) }}>달력 기록으로</button>}
          {note.kind === 'note' && <button role="menuitem" onClick={() => { onKind('document'); setMoreOpen(false) }}>문서로 옮기기</button>}
          {exportTargets.map(p => <button role="menuitem" key={p} onClick={() => onExport(p)}>{p === 'google' ? 'Google로 내보내기' : '네이버로 내보내기'}</button>)}
          <button role="menuitem" className="del" onClick={onDelete}><IconTrash size={14} /> 삭제</button>
        </div>}
      </div>
      <textarea
        aria-label="메모 제목"
        ref={titleRef}
        className="ed-title"
        rows={1}
        spellCheck={false}
        value={title}
        placeholder="제목 없음"
        onChange={(e) => changeTitle(e.target.value.replace(/\s*\n+\s*/g, ' '))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            editor?.commands.focus('start')
          }
        }}
      />
      <div className="ed-meta">
        <span className={`kind-chip ${note.kind}`}>{KIND_LABEL[note.kind]}</span>{' '}
        {note.kind === 'document'
          ? `${note.created.slice(0, 10)} 작성`
          : `${formatDateLabel(note.date)} · ${timeOf(note.created)} 작성`}
        {note.kind === 'event' && (
          <label className="time-field">
            시간
            <input type="time" value={time} onChange={(e) => changeTime(e.target.value)} />
          </label>
        )}
      </div>
      {linked.length > 0 && (
        <div className="linked">
          <span className="muted">연결</span>
          {linked.map((l) => (
            <span className="chip link" key={l.id}>
              <button className="open" onClick={() => onOpenLinked(l.id)} title="열기">
                {KIND_LABEL[l.kind]} · {l.title || '제목 없음'}
                {l.date ? ` (${Number(l.date.slice(5, 7))}/${Number(l.date.slice(8, 10))})` : ''}
              </button>
              <button className="x" aria-label="연결 끊기 (원본은 그대로 남아요)" onClick={() => onUnlink(l.id)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="ed-tags">
        {tags.map((t) => (
          <span className="chip" key={t}>
            #{t}
            <button aria-label={`${t} 태그 지우기`} onClick={() => commitTags(tags.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <input
          value={tagDraft}
          placeholder="+ 태그"
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              addTag()
            } else if (e.key === 'Backspace' && !tagDraft && tags.length) {
              commitTags(tags.slice(0, -1))
            }
          }}
          onBlur={addTag}
        />
      </div>

      {bubble && <div className="format-bubble" role="toolbar" aria-label="선택한 글 서식" style={{ left: bubble.x, top: bubble.y }} onMouseDown={e => e.preventDefault()}>
        <button aria-label="굵게" aria-pressed={st?.bold ?? false} onClick={() => editor?.chain().focus().toggleBold().run()}><IconBold /></button>
        <button aria-label="기울임" aria-pressed={st?.italic ?? false} onClick={() => editor?.chain().focus().toggleItalic().run()}><IconItalic /></button>
        <button aria-label="밑줄" aria-pressed={st?.underline ?? false} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button>
        <button aria-label="링크" onClick={openLink}><IconLink /></button>
      </div>}
      {slash && <div className="slash-menu" role="listbox" aria-label="블록 추가" style={{ left: slash.x, top: slash.y }}>
        {BLOCK_COMMANDS.filter(c => (c.label + c.hint + c.id).toLowerCase().includes(slash.query.toLowerCase())).map((c, i) => (
          <button role="option" aria-selected={i === commandIndex} key={c.id} onMouseDown={e => e.preventDefault()} onClick={() => { if (editor) runBlockCommand(editor, c.id, slash.from, slash.to); setSlash(null) }}>
            <b>{c.label}</b><small>{c.hint}</small>
          </button>
        ))}
      </div>}
      {linkOpen && (
        <div className="link-row">
          <input
            autoFocus
            value={linkValue}
            placeholder="주소를 붙여넣고 Enter (비우면 링크 해제)"
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyLink()
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setLinkOpen(false)
                editor?.commands.focus()
              }
            }}
          />
          <button className="btn primary" onClick={applyLink}>
            적용
          </button>
        </div>
      )}

      <div className="ed-body" onScroll={() => { setBubble(null); setSlash(null) }} onClick={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}>
        <EditorContent editor={editor} />
      </div>

      {eventOpen && note.kind === 'document' && (
        <div className="link-row">
          <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          <button
            className="btn primary"
            onClick={() => {
              if (!eventDate) return
              onMakeEvent(eventDate)
              setEventOpen(false)
            }}
          >
            이 날짜에 일정 만들기
          </button>
        </div>
      )}
      <div className="ed-foot">
        <span>
          <span className={`dot-saved ${status.kind === 'saved' ? '' : 'pending'}`} />
          {status.text}
        </span>
        <span className="spacer" />
        {status.kind === 'error' && <button className="foot-btn retry-save" onClick={() => void doSave()}>다시 저장</button>}
        <span className="editor-hint">빈 줄에서 / 로 블록 추가</span>
      </div>
    </div>
  )
}
