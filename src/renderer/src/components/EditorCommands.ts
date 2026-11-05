import { Extension, type Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const TASK_DRAG_TYPE = 'application/x-opus-task'

export const BLOCK_COMMANDS = [
  { id: 'text', label: '본문', hint: '일반 문단' },
  { id: 'h1', label: '큰 제목', hint: '제목 1' },
  { id: 'h2', label: '작은 제목', hint: '제목 2' },
  { id: 'task', label: '체크리스트', hint: '할 일' },
  { id: 'bullet', label: '글머리 목록', hint: '순서 없는 목록' },
  { id: 'ordered', label: '번호 목록', hint: '순서 있는 목록' },
  { id: 'rule', label: '구분선', hint: '내용 나누기' },
  { id: 'callout', label: '콜아웃', hint: '강조하는 인용 상자' }
] as const

export function runBlockCommand(editor: Editor, id: string, from: number, to: number): void {
  const chain = editor.chain().focus().deleteRange({ from, to })
  switch (id) {
    case 'h1': chain.setHeading({ level: 1 }).run(); break
    case 'h2': chain.setHeading({ level: 2 }).run(); break
    case 'task': chain.toggleTaskList().run(); break
    case 'bullet': chain.toggleBulletList().run(); break
    case 'ordered': chain.toggleOrderedList().run(); break
    case 'rule': chain.setHorizontalRule().run(); break
    case 'callout': chain.setBlockquote().run(); break
    default: chain.setParagraph().run()
  }
}

/** 장식 핸들이므로 마크다운 원문에는 핸들 글자나 일정 데이터가 들어가지 않는다. */
export function taskHandles(noteId: string) {
  return Extension.create({
    name: 'taskHandles',
    addProseMirrorPlugins() {
      return [new Plugin({ props: {
        decorations(state) {
          const handles: Decoration[] = []
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'taskItem') return
            const text = node.firstChild?.textContent.trim() ?? ''
            if (!text) return
            handles.push(Decoration.widget(pos + 1, () => {
              const handle = document.createElement('span')
              handle.className = 'task-drag'
              handle.textContent = '⠿'
              handle.draggable = true
              handle.contentEditable = 'false'
              handle.setAttribute('role', 'button')
              handle.setAttribute('aria-label', `${text} 일정으로 끌기`)
              handle.title = '캘린더 날짜로 끌어 일정 만들기'
              handle.addEventListener('dragstart', event => {
                event.stopPropagation()
                event.dataTransfer?.setData(TASK_DRAG_TYPE, JSON.stringify({ noteId, title: text }))
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
              })
              return handle
            }, { side: -1, key: `${pos}:${text}`, stopEvent: () => true }))
          })
          return DecorationSet.create(state.doc, handles)
        }
      } })]
    }
  })
}
