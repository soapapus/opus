// 지금 열려 있는 편집기를 바깥(앱)에서 다룰 수 있게 해 주는 연결 고리.
export interface EditorHandle {
  /** 저장하지 못한 글을 지금 저장 */
  flush(): Promise<void>
  /** 글 맨 아래에 체크리스트 한 줄을 추가 (일정을 끌어다 놓았을 때) */
  insertTask(text: string): void
}
export const editorHandle: { current: EditorHandle | null } = { current: null }
