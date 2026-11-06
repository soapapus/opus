// 화면(renderer)이 쓸 수 있는 기능만 골라서 안전하게 열어 주는 다리.
import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/types'

const call = (name: string, ...args: unknown[]) => ipcRenderer.invoke(`ld:${name}`, ...args)

const api: Api = {
  localRoots: () => call('localRoots'),
  localChooseRoot: () => call('localChooseRoot'),
  localRemoveRoot: (id) => call('localRemoveRoot', id),
  localRenameRoot: (id, name) => call('localRenameRoot', id, name),
  localList: (ref) => call('localList', ref),
  localResolveAddress: (address) => call('localResolveAddress', address),
  localOpen: (ref) => call('localOpen', ref),
  localReveal: (ref) => call('localReveal', ref),
  localCreateFolder: (ref, name) => call('localCreateFolder', ref, name),
  localRename: (ref, name) => call('localRename', ref, name),
  localTransfer: (refs, target, move) => call('localTransfer', refs, target, move),
  localTrash: (refs) => call('localTrash', refs),
  projectGet: () => call('projectGet'),
  projectSave: (board) => call('projectSave', board),
  projectAttach: () => call('projectAttach'),
  projectOpenAttachment: (id) => call('projectOpenAttachment', id),
  browserGet: () => call('browserGet'),
  browserNew: (url) => call('browserNew', url),
  browserClose: (id) => call('browserClose', id),
  browserSelect: (id) => call('browserSelect', id),
  browserNavigate: (id, url) => call('browserNavigate', id, url),
  browserCommand: (id, command) => call('browserCommand', id, command),
  browserBounds: (bounds) => call('browserBounds', bounds),
  browserChrome: (url) => call('browserChrome', url),
  browserBookmark: (url, title) => call('browserBookmark', url, title),
  browserRemoveBookmark: (id) => call('browserRemoveBookmark', id),
  onBrowserChanged: (handler) => { const fn = () => handler(); ipcRenderer.on('app:browser-changed', fn); return () => ipcRenderer.removeListener('app:browser-changed', fn) },
  onBrowserAddress: (handler) => { const fn = () => handler(); ipcRenderer.on('app:browser-address', fn); return () => ipcRenderer.removeListener('app:browser-address', fn) },
  cloudState: () => call('cloudState'),
  cloudSaveKeys: (id, secret) => call('cloudSaveKeys', id, secret),
  driveConnect: (write) => call('driveConnect', write),
  driveDisconnect: () => call('driveDisconnect'),
  driveFolders: () => call('driveFolders'),
  driveSelectFolder: (id) => call('driveSelectFolder', id),
  driveFiles: () => call('driveFiles'),
  driveBackup: () => call('driveBackup'),
  driveAutoBackup: (on) => call('driveAutoBackup', on),
  driveOpen: (id) => call('driveOpen', id),
  driveDownload: (id) => call('driveDownload', id),
  driveMergePreview: (id) => call('driveMergePreview', id),
  driveMergeApply: (token) => call('driveMergeApply', token),
  driveAutoMerge: (on) => call('driveAutoMerge', on),
  aiConfigure: (key, model) => call('aiConfigure', key, model),
  aiMessages: () => call('aiMessages'),
  aiArchives: () => call('aiArchives'),
  aiSend: (text) => call('aiSend', text),
  info: () => call('info'),
  createWorkspace: (name) => call('createWorkspace', name),
  switchWorkspace: (id) => call('switchWorkspace', id),
  renameWorkspace: (id, name) => call('renameWorkspace', id, name),
  setWorkspaceEnabled: (id, enabled) => call('setWorkspaceEnabled', id, enabled),
  holidays: (y) => call('holidays', y),
  holidayStatus: () => call('holidayStatus'),
  refreshHolidays: (f) => call('refreshHolidays', f),
  useBuiltinHolidays: () => call('useBuiltinHolidays'),
  prefsGet: () => call('prefsGet'),
  prefsSet: (patch) => call('prefsSet', patch),
  notesByMonth: (m) => call('notesByMonth', m),
  notesByDate: (d) => call('notesByDate', d),
  documents: (tag) => call('documents', tag),
  getNote: (id) => call('getNote', id),
  createNote: (input) => call('createNote', input),
  saveNote: (input) => call('saveNote', input),
  deleteNote: (id) => call('deleteNote', id),
  discardIfEmpty: (id) => call('discardIfEmpty', id),
  search: (q) => call('search', q),
  tags: () => call('tags'),
  setKind: (id, kind) => call('setKind', id, kind),
  link: (a, b) => call('link', a, b),
  unlink: (a, b) => call('unlink', a, b),
  linksOf: (id) => call('linksOf', id),
  scratchGet: () => call('scratchGet'),
  scratchSave: (body) => call('scratchSave', body),
  scratchToDocument: () => call('scratchToDocument'),
  scratchHide: () => call('scratchHide'),
  scratchOpen: () => call('scratchOpen'),
  connections: () => call('connections'),
  externalByMonth: (m) => call('externalByMonth', m),
  saveKeys: (p, id, secret) => call('saveKeys', p, id, secret),
  connect: (p, write) => call('connect', p, write),
  disconnect: (p) => call('disconnect', p),
  setCalendars: (ids) => call('setCalendars', ids),
  syncExternal: () => call('syncExternal'),
  exportEvent: (id, p) => call('exportEvent', id, p),
  chooseDataDir: () => call('chooseDataDir'),
  chooseBackupDir: () => call('chooseBackupDir'),
  runBackup: () => call('runBackup'),
  rebuildIndex: () => call('rebuildIndex'),
  openDataDir: () => call('openDataDir'),
  windowControl: (a) => call('windowControl', a),
  onFlushRequest(handler) {
    const listener = async (): Promise<void> => {
      try {
        await handler()
        ipcRenderer.send('app:flushed')
      } catch {
        ipcRenderer.send('app:flushed', '편집 내용을 저장하지 못했어요')
      }
    }
    ipcRenderer.on('app:flush', listener)
    return () => ipcRenderer.removeListener('app:flush', listener)
  },
  onFilesChanged(handler) {
    const listener = (): void => handler()
    ipcRenderer.on('app:files-changed', listener)
    return () => ipcRenderer.removeListener('app:files-changed', listener)
  },
  onInfoChanged(handler) {
    const listener = (): void => handler()
    ipcRenderer.on('app:info-changed', listener)
    return () => ipcRenderer.removeListener('app:info-changed', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
