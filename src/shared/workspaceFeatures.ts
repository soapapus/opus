export interface LocalRoot { id: string; name: string; path: string }
export interface LocalEntry { name: string; relativePath: string; directory: boolean; symbolicLink: boolean; size: number; modified: string }
export interface LocalListing { root: LocalRoot; relativePath: string; absolutePath: string; entries: LocalEntry[] }
export interface FileRef { rootId: string; relativePath: string }
export interface FileResult { source: string; destination?: string; ok: boolean; error?: string }
export interface ProjectStatus { id: string; name: string; color: string }
export interface ProjectColumn { id: string; name: string; statusId: string; archived: boolean }
export interface ProjectAttachment { id: string; name: string; size: number }
export interface ProjectComment { id: string; body: string; created: string }
export interface ProjectCard {
  id: string; number: number; columnId: string; title: string; body: string; tags: string[]
  due: string; priority: 'low' | 'normal' | 'high'; archived: boolean
  created: string; updated: string; comments: ProjectComment[]; attachments: ProjectAttachment[]
}
export interface ProjectBoard { revision: number; nextNumber: number; statuses: ProjectStatus[]; columns: ProjectColumn[]; cards: ProjectCard[] }
export interface BrowserTabState { id: string; title: string; url: string; loading: boolean; error?: string; back: boolean; forward: boolean }
export interface BrowserBookmark { id: string; title: string; url: string }
export interface BrowserDeskState { tabs: BrowserTabState[]; activeId: string; bookmarks: BrowserBookmark[]; embedded: boolean }
export interface BrowserBounds { x: number; y: number; width: number; height: number }
export interface WorkspaceFeaturesApi {
  localRoots(): Promise<LocalRoot[]>
  localChooseRoot(): Promise<LocalRoot[] | null>
  localRemoveRoot(id: string): Promise<LocalRoot[]>
  localRenameRoot(id: string, name: string): Promise<LocalRoot[]>
  localList(ref: FileRef): Promise<LocalListing>
  localResolveAddress(address: string): Promise<FileRef>
  localOpen(ref: FileRef): Promise<void>
  localReveal(ref: FileRef): Promise<void>
  localCreateFolder(parent: FileRef, name: string): Promise<void>
  localRename(ref: FileRef, name: string): Promise<void>
  localTransfer(sources: FileRef[], destination: FileRef, move: boolean): Promise<FileResult[]>
  localTrash(sources: FileRef[]): Promise<FileResult[]>
  projectGet(): Promise<ProjectBoard>
  projectSave(board: ProjectBoard): Promise<ProjectBoard>
  projectAttach(): Promise<ProjectAttachment[]>
  projectOpenAttachment(id: string): Promise<void>
  browserGet(): Promise<BrowserDeskState>
  browserNew(url?: string): Promise<BrowserDeskState>
  browserClose(id: string): Promise<BrowserDeskState>
  browserSelect(id: string): Promise<BrowserDeskState>
  browserNavigate(id: string, address: string): Promise<BrowserDeskState>
  browserCommand(id: string, command: 'back' | 'forward' | 'reload' | 'stop'): Promise<BrowserDeskState>
  browserBounds(bounds: BrowserBounds | null): Promise<void>
  browserChrome(url: string): Promise<void>
  browserBookmark(url: string, title: string): Promise<BrowserDeskState>
  browserRemoveBookmark(id: string): Promise<BrowserDeskState>
  onBrowserChanged(handler: () => void): () => void
  onBrowserAddress(handler: () => void): () => void
}
