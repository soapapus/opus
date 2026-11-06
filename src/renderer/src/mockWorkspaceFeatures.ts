// 브라우저 QA 전용. 실제 PC 파일·Chrome에는 접근하지 않는다.
import type { BrowserDeskState, FileRef, LocalEntry, LocalRoot, ProjectBoard, WorkspaceFeaturesApi } from '../../shared/workspaceFeatures'
import { emptyBoard, validateBoard } from '../../shared/projects'
import { browserAddress } from '../../shared/browser'
type Preview = { roots: LocalRoot[]; entries: Record<string, LocalEntry[]>; board: ProjectBoard; browser: BrowserDeskState }
export function mockWorkspaceFeatures(workspace: () => string): WorkspaceFeaturesApi {
  const stores = new Map<string, Preview>()
  const history = new Map<string, { urls: string[]; index: number }>()
  const get = (): Preview => {
    const id = workspace()
    if (!stores.has(id)) {
      let saved: Preview | null = null
      try { saved = JSON.parse(sessionStorage.getItem(`opus-features-${id}`) ?? 'null') } catch { /* 새 미리보기 */ }
      stores.set(id, saved ?? { roots: [], entries: {}, board: emptyBoard(), browser: { tabs: [{ id: 'tab-1', title: '새 탭', url: 'about:blank', loading: false, back: false, forward: false }], activeId: 'tab-1', bookmarks: [], embedded: false } })
    }
    return stores.get(id)!
  }
  const persist = () => sessionStorage.setItem(`opus-features-${workspace()}`, JSON.stringify(get()))
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\/|\/$/g, '')
  const key = (r: FileRef) => `${r.rootId}:${norm(r.relativePath)}`
  const root = (r: FileRef) => { const found = get().roots.find(x => x.id === r.rootId); if (!found) throw new Error('먼저 PC 폴더를 등록해 주세요'); return found }
  const parent = (r: FileRef) => ({ ...r, relativePath: norm(r.relativePath).split('/').slice(0, -1).join('/') })
  const entry = (r: FileRef) => get().entries[key(parent(r))]?.find(e => e.relativePath === norm(r.relativePath))
  const date = '2026-11-05T10:00:00+09:00'
  const sample = (name: string, directory = false): LocalEntry => ({ name, relativePath: name, directory, symbolicLink: false, size: directory ? 0 : 2048, modified: date })
  const browser = () => structuredClone(get().browser)
  const tab = (id: string) => { const t = get().browser.tabs.find(t => t.id === id); if (!t) throw new Error('탭을 찾을 수 없어요'); return t }
  return {
    localRoots: async () => structuredClone(get().roots),
    localChooseRoot: async () => {
      const i = get().roots.length; const r = { id: `root-${i + 1}`, name: i ? '보관 자료' : '내 자료', path: i ? 'G:\\보관 자료' : 'C:\\Opus\\자료' }
      get().roots.push(r); get().entries[`${r.id}:`] = i ? [] : [sample('문서', true), sample('계획.md'), sample('사진.png')]; get().entries[`${r.id}:문서`] = []
      persist(); return structuredClone(get().roots)
    },
    localRemoveRoot: async id => { get().roots = get().roots.filter(r => r.id !== id); persist(); return structuredClone(get().roots) },
    localRenameRoot: async (id, name) => { const r = get().roots.find(r => r.id === id)!; r.name = name; persist(); return structuredClone(get().roots) },
    localList: async ref => { const r = root(ref); const entries = get().entries[key(ref)]; if (!entries) throw new Error('폴더를 찾을 수 없어요'); return { root: r, relativePath: norm(ref.relativePath), absolutePath: `${r.path}${ref.relativePath ? '\\' + norm(ref.relativePath).replace(/\//g, '\\') : ''}`, entries: structuredClone(entries) } },
    localResolveAddress: async address => { const r = get().roots.find(r => address.toLowerCase().startsWith(r.path.toLowerCase())); if (!r) throw new Error('먼저 폴더를 등록해 주세요'); return { rootId: r.id, relativePath: norm(address.slice(r.path.length)) } },
    localOpen: async () => undefined, localReveal: async () => undefined,
    localCreateFolder: async (ref, name) => { const items = get().entries[key(ref)]; if (items.some(e => e.name === name)) throw new Error('같은 이름의 항목이 있어요'); const path = [norm(ref.relativePath), name].filter(Boolean).join('/'); items.push({ ...sample(name, true), relativePath: path }); get().entries[`${ref.rootId}:${path}`] = []; persist() },
    localRename: async (ref, name) => {
      const item = entry(ref); if (!item) throw new Error('파일이 없어요'); const items = get().entries[key(parent(ref))]; if (items.some(e => e.name === name)) throw new Error('같은 이름의 항목이 있어요')
      const old = item.relativePath; item.name = name; item.relativePath = [parent(ref).relativePath, name].filter(Boolean).join('/')
      for (const k of Object.keys(get().entries)) if (k === `${ref.rootId}:${old}` || k.startsWith(`${ref.rootId}:${old}/`)) { const next = `${ref.rootId}:${item.relativePath}${k.slice(`${ref.rootId}:${old}`.length)}`; get().entries[next] = get().entries[k].map(e => ({ ...e, relativePath: e.relativePath.replace(old, item.relativePath) })); delete get().entries[k] }
      persist()
    },
    localTransfer: async (refs, dest, move) => {
      const items = get().entries[key(dest)]; if (!items) throw new Error('대상 폴더가 없어요')
      const found = refs.map(ref => ({ ref, item: entry(ref) })); if (found.some(x => !x.item || items.some(e => e.name === x.item!.name))) throw new Error('대상에 같은 이름의 항목이 있어요')
      const results = found.map(({ ref, item }) => { const relativePath = [norm(dest.relativePath), item!.name].filter(Boolean).join('/'); items.push({ ...item!, relativePath }); if (item!.directory) get().entries[`${dest.rootId}:${relativePath}`] = []; if (move) get().entries[key(parent(ref))] = get().entries[key(parent(ref))].filter(e => e.relativePath !== ref.relativePath); return { source: ref.relativePath, destination: relativePath, ok: true } }); persist(); return results
    },
    localTrash: async refs => { const results = refs.map(ref => { get().entries[key(parent(ref))] = get().entries[key(parent(ref))].filter(e => e.relativePath !== ref.relativePath); return { source: ref.relativePath, ok: true } }); persist(); return results },
    projectGet: async () => structuredClone(get().board),
    projectSave: async b => { validateBoard(b); if (b.revision !== get().board.revision) throw new Error('다른 창에서 보드가 바뀌었어요'); const next = structuredClone(b); next.revision++; for (const c of next.cards) { if (!c.number) c.number = next.nextNumber++; c.updated = new Date().toISOString() } get().board = next; persist(); return structuredClone(next) },
    projectAttach: async () => [{ id: crypto.randomUUID(), name: '예제 첨부.txt', size: 42 }], projectOpenAttachment: async () => undefined,
    browserGet: async () => browser(),
    browserNew: async address => { const id = crypto.randomUUID(); const url = browserAddress(address ?? ''); get().browser.tabs.push({ id, title: url === 'about:blank' ? '새 탭' : url, url, loading: false, back: false, forward: false }); get().browser.activeId = id; persist(); return browser() },
    browserClose: async id => { get().browser.tabs = get().browser.tabs.filter(t => t.id !== id); if (!get().browser.tabs.length) get().browser.tabs.push({ id: crypto.randomUUID(), title: '새 탭', url: 'about:blank', loading: false, back: false, forward: false }); if (!get().browser.tabs.some(t => t.id === get().browser.activeId)) get().browser.activeId = get().browser.tabs.at(-1)!.id; persist(); return browser() },
    browserSelect: async id => { tab(id); get().browser.activeId = id; persist(); return browser() },
    browserNavigate: async (id, address) => { const t = tab(id), url = browserAddress(address); const h = history.get(id) ?? { urls: [t.url], index: 0 }; h.urls = [...h.urls.slice(0, h.index + 1), url]; h.index++; history.set(id, h); Object.assign(t, { url, title: url, back: h.index > 0, forward: false }); persist(); return browser() },
    browserCommand: async (id, command) => { const t = tab(id), h = history.get(id); if (h) { if (command === 'back' && h.index > 0) h.index--; if (command === 'forward' && h.index < h.urls.length - 1) h.index++; Object.assign(t, { url: h.urls[h.index], title: h.urls[h.index], back: h.index > 0, forward: h.index < h.urls.length - 1 }) } persist(); return browser() },
    browserBounds: async () => undefined,
    browserChrome: async url => { (window as unknown as { __lastChromeUrl: string }).__lastChromeUrl = browserAddress(url) },
    browserBookmark: async (url, title) => { const address = browserAddress(url); if (!get().browser.bookmarks.some(b => b.url === address)) get().browser.bookmarks.push({ id: crypto.randomUUID(), title, url: address }); persist(); return browser() },
    browserRemoveBookmark: async id => { get().browser.bookmarks = get().browser.bookmarks.filter(b => b.id !== id); persist(); return browser() },
    onBrowserChanged: () => () => undefined, onBrowserAddress: () => () => undefined
  }
}
