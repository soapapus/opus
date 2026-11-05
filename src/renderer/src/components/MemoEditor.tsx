import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Markdown } from '@tiptap/markdown'
import type { Note, NoteKind, NoteSummary, Provider } from '../../../shared/types'
import { formatDateLabel, todayStr } from '../../../shared/calendar'
import { hasLimeDrag, readDrag, type DragPayload } from '../dnd'
import { timeOf } from '../../../shared/text'
import { editorHandle } from '../bridge'
import {
  IconBold,
  IconCheckList,
  IconItalic,
  IconLink,
  IconList,
  IconTrash
} from '../icons'

const SAVE_DELAY = 900

interface Props {
  note: Note
  autoFocusTitle: boolean
  /** 이 기록과 명시적으로 연결된 다른 기록 */
  linked: NoteSummary[]
  onSaved: (note: Note) => void
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
  const titleRef = useRef<HTMLTextAreaElement>(null)

  // 저장 시점에 항상 최신 값을 쓰기 위해 ref에도 둔다
  const latest = useRef({ title: note.title, tags: note.tags, body: note.body, time: note.time })
  const dirty = useRef(false)
  const timer = useRef<number | null>(null)
  const inflight = useRef<Promise<void>>(Promise.resolve())
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved

  const doSave = useCallback((): Promise<void> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (!dirty.current) return inflight.current
    dirty.current = false
    const { time: t, ...rest } = latest.current
    const snapshot = note.kind === 'event' ? { ...rest, time: t } : rest
    const run = inflight.current.then(async () => {
      try {
        const saved = await window.api.saveNote({ id: note.id, ...snapshot })
        onSavedRef.current(saved)
        if (!dirty.current) setStatus({ kind: 'saved', text: `저장됨 ${hhmm()}` })
      } catch {
        dirty.current = true
        setStatus({ kind: 'error', text: '저장하지 못했어요. 다시 시도할게요' })
      }
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
      Markdown
    ],
    content: note.body,
    contentType: 'markdown',
    editorProps: {
      attributes: { 'data-placeholder': '여기에 적으면 자동으로 저장돼요', spellcheck: 'false' },
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
      latest.current.body = ed.getMarkdown()
      markDirty()
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
      }
    }
    editorHandle.current = handle
    return () => {
      void doSave()
      if (editorHandle.current === handle) editorHandle.current = null
    }
  }, [doSave, editor])

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
      <textarea
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
          ? `${note.created.slice(0, 10)} 작성 · 날짜와 연결되지 않은 문서`
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

      <div className="toolbar" role="toolbar" aria-label="글 서식">
        <select
          aria-label="문단 모양"
          value={st?.block ?? 'p'}
          onChange={(e) => {
            const v = e.target.value
            const c = editor?.chain().focus()
            if (!c) return
            if (v === 'p') c.setParagraph().run()
            else c.setHeading({ level: v === 'h1' ? 1 : 2 }).run()
          }}
        >
          <option value="p">본문</option>
          <option value="h1">큰 제목</option>
          <option value="h2">작은 제목</option>
        </select>
        <button
          className={`tb-btn ${st?.bold ? 'on' : ''}`}
          title="굵게 (Ctrl+B)"
          aria-label="굵게"
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <IconBold />
        </button>
        <button
          className={`tb-btn ${st?.italic ? 'on' : ''}`}
          title="기울임 (Ctrl+I)"
          aria-label="기울임"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <IconItalic />
        </button>
        <span className="tb-sep" />
        <button
          className={`tb-btn ${st?.bullet ? 'on' : ''}`}
          title="목록"
          aria-label="목록"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <IconList />
        </button>
        <button
          className={`tb-btn ${st?.task ? 'on' : ''}`}
          title="체크리스트"
          aria-label="체크리스트"
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
        >
          <IconCheckList />
        </button>
        <button
          className={`tb-btn ${st?.link ? 'on' : ''}`}
          title="링크"
          aria-label="링크"
          onClick={openLink}
        >
          <IconLink />
        </button>
      </div>
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

      <div className="ed-body" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}>
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
        {note.kind === 'event' &&
          exportTargets.map((p) => (
            <button key={p} className="foot-btn" onClick={() => onExport(p)} title="내 일정을 외부 캘린더에 추가해요 (한 번만)">
              {p === 'google' ? 'Google로 내보내기' : '네이버로 내보내기'}
            </button>
          ))}
        {note.kind === 'document' && (
          <button className="foot-btn" onClick={() => setEventOpen((v) => !v)}>
            일정으로 만들기
          </button>
        )}
        {note.kind === 'note' && note.classified && (
          <button className="foot-btn" onClick={() => onKind('document')} title="날짜와의 연결이 풀리고 메모장 문서가 돼요">
            문서로 옮기기
          </button>
        )}
        {note.kind === 'document' && note.id !== 'scratchpad' && (
          <button className="foot-btn" onClick={() => onKind('note')} title="만든 날의 달력 기록이 돼요">
            달력 기록으로
          </button>
        )}
        <button className="del" onClick={onDelete}>
          <IconTrash size={16} /> 삭제
        </button>
      </div>
    </div>
  )
}
