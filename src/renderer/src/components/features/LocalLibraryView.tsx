import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileRef, FileResult, LocalEntry, LocalListing, LocalRoot } from '../../../../shared/workspaceFeatures'
import { FeatureDialog } from './FeatureDialog'
const norm = (p: string) => p.replace(/\\/g, '/')
const same = (a: FileRef | null, b: FileRef | null) => !!a && !!b && a.rootId === b.rootId && norm(a.relativePath) === norm(b.relativePath)
const up = (p: string) => norm(p).split('/').filter(Boolean).slice(0, -1).join('/')
const errorText = (e: unknown) => e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '파일 작업을 마치지 못했어요'
const size = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`

function FolderTree({ root, path = '', name, depth = 0, refresh, onOpen }: { root: LocalRoot; path?: string; name: string; depth?: number; refresh: number; onOpen: (ref: FileRef) => void }) {
  const [expanded, setExpanded] = useState(false); const [children, setChildren] = useState<LocalEntry[]>([]); const [error, setError] = useState('')
  useEffect(() => {
    if (!expanded) return
    let live = true
    void window.api.localList({ rootId: root.id, relativePath: path }).then(r => { if (live) { setChildren(r.entries.filter(e => e.directory && !e.symbolicLink)); setError('') } }).catch(e => { if (live) setError(errorText(e)) })
    return () => { live = false }
  }, [expanded, root.id, path, refresh])
  return <div className="folder-node">
    <div className="folder-node-row" style={{ paddingLeft: depth * 12 }}><button className="tree-toggle" aria-label={`${name} 하위 폴더`} aria-expanded={expanded} onClick={() => setExpanded(v => !v)} disabled={depth >= 30}>{expanded ? '▾' : '▸'}</button><button title={path ? `${root.path}/${path}` : root.path} onClick={() => onOpen({ rootId: root.id, relativePath: path })}>📁 {name}</button></div>
    {expanded && <div className="folder-children">{error && <p className="feature-error small">{error}</p>}{!error && !children.length && <small className="muted">하위 폴더 없음</small>}{children.map(e => <FolderTree key={e.relativePath} root={root} path={e.relativePath} name={e.name} depth={depth + 1} refresh={refresh} onOpen={onOpen} />)}</div>}
  </div>
}

function FilePane({ index, location, roots, selected, active, globalBusy, refresh, onLocation, onSelection, onActive, onTransfer, onClose }: {
  index: number; location: FileRef | null; roots: LocalRoot[]; selected: string[]; active: boolean; globalBusy: boolean; refresh: number
  onLocation: (ref: FileRef) => void; onSelection: (paths: string[]) => void; onActive: () => void; onTransfer: (refs: FileRef[], dest: FileRef, move: boolean) => void; onClose?: () => void
}) {
  const [listing, setListing] = useState<LocalListing | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  const [address, setAddress] = useState(''); const [query, setQuery] = useState(''); const [grid, setGrid] = useState(false)
  const [sort, setSort] = useState<'name' | 'modified' | 'size'>('name'); const [descending, setDescending] = useState(false)
  const history = useRef<{ items: FileRef[]; index: number }>({ items: [], index: -1 }); const anchor = useRef(0)
  const rootId = location?.rootId; const path = norm(location?.relativePath ?? '')
  useEffect(() => {
    if (!location) { setListing(null); onSelection([]); return }
    let live = true; setLoading(true); setError(''); setListing(null); onSelection([])
    const h = history.current
    if (!same(h.items[h.index] ?? null, location)) { h.items = [...h.items.slice(0, h.index + 1), location].slice(-100); h.index = h.items.length - 1 }
    void window.api.localList(location).then(r => { if (live) { setListing(r); setAddress(r.absolutePath) } }).catch(e => { if (live) setError(errorText(e)) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // location is identified by rootId/path; selection callbacks do not start another listing.
  }, [rootId, path, refresh])
  const entries = useMemo(() => [...(listing?.entries ?? [])].filter(e => e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => Number(b.directory) - Number(a.directory) || (descending ? -1 : 1) * (sort === 'name' ? a.name.localeCompare(b.name, 'ko', { numeric: true }) : sort === 'modified' ? a.modified.localeCompare(b.modified) : a.size - b.size)), [listing, query, sort, descending])
  const goHistory = (step: number) => { const h = history.current; if (!h.items[h.index + step]) return; h.index += step; onLocation(h.items[h.index]) }
  const open = async (entry: LocalEntry) => {
    if (!listing || entry.symbolicLink || globalBusy) return
    const ref = { rootId: listing.root.id, relativePath: entry.relativePath }
    if (entry.directory) { setQuery(''); onLocation(ref) }
    else try { await window.api.localOpen(ref) } catch (e) { setError(errorText(e)) }
  }
  const toggle = (entry: LocalEntry, i: number, extend: boolean, range: boolean) => {
    onActive()
    if (range) { const block = entries.slice(Math.min(anchor.current, i), Math.max(anchor.current, i) + 1).map(e => e.relativePath); onSelection(extend ? [...new Set([...selected, ...block])] : block) }
    else { anchor.current = i; onSelection(extend ? selected.includes(entry.relativePath) ? selected.filter(p => p !== entry.relativePath) : [...selected, entry.relativePath] : [entry.relativePath]) }
  }
  const busy = globalBusy || loading
  return <section className={`file-pane ${active ? 'active' : ''}`} aria-label={`탐색창 ${index + 1}`} onPointerDown={onActive} onDragOver={e => { if (e.dataTransfer.types.includes('application/x-opus-files')) e.preventDefault() }} onDrop={e => {
    e.preventDefault(); if (!listing || busy) return
    try { const refs = JSON.parse(e.dataTransfer.getData('application/x-opus-files')); if (Array.isArray(refs)) onTransfer(refs, { rootId: listing.root.id, relativePath: listing.relativePath }, e.shiftKey) } catch { setError('끌어온 항목을 확인하지 못했어요') }
  }}>
    <div className="file-pane-head"><b>탐색창 {index + 1}</b><select aria-label={`탐색창 ${index + 1} 등록 폴더`} value={rootId ?? ''} disabled={busy} onChange={e => onLocation({ rootId: e.target.value, relativePath: '' })}><option value="">등록 폴더 선택</option>{roots.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>{onClose && <button className="btn sm" aria-label={`탐색창 ${index + 1} 닫기`} onClick={onClose}>×</button>}</div>
    <div className="file-address"><button className="btn sm" aria-label="뒤로" disabled={busy || history.current.index <= 0} onClick={() => goHistory(-1)}>←</button><button className="btn sm" aria-label="앞으로" disabled={busy || history.current.index >= history.current.items.length - 1} onClick={() => goHistory(1)}>→</button><button className="btn sm" aria-label="상위 폴더" disabled={busy || !path || !rootId} onClick={() => onLocation({ rootId: rootId!, relativePath: up(path) })}>↑</button>
      <form onSubmit={e => { e.preventDefault(); void window.api.localResolveAddress(address).then(onLocation).catch(e => setError(errorText(e))) }}><input aria-label={`탐색창 ${index + 1} 주소`} value={address} disabled={busy} onChange={e => setAddress(e.target.value)} placeholder="등록한 PC 폴더 안의 경로" /><button className="btn sm" disabled={busy || !address.trim()}>이동</button></form>
    </div>
    <div className="file-filter"><input aria-label={`탐색창 ${index + 1} 파일 검색`} value={query} onChange={e => setQuery(e.target.value)} placeholder="이 폴더에서 검색" /><select aria-label={`탐색창 ${index + 1} 정렬`} value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="name">이름</option><option value="modified">수정 날짜</option><option value="size">크기</option></select><button className="btn sm" aria-label="정렬 방향" onClick={() => setDescending(v => !v)}>{descending ? '↓' : '↑'}</button><button className="btn sm" onClick={() => setGrid(v => !v)}>{grid ? '목록 보기' : '아이콘 보기'}</button></div>
    {error && <p role="alert" className="feature-error">{error}</p>}
    <div className={`file-content ${grid ? 'icons' : ''}`} role="listbox" aria-label={`탐색창 ${index + 1} 파일 목록`} aria-multiselectable="true" tabIndex={0} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); onSelection(entries.map(x => x.relativePath)) } if (e.key === 'Enter' && selected.length === 1) { const item = entries.find(x => x.relativePath === selected[0]); if (item) void open(item) } }}>
      {loading && <p role="status">폴더를 읽고 있어요…</p>}{!location && <p className="feature-empty">왼쪽에서 PC 폴더를 등록하거나 선택해 주세요.</p>}{!loading && listing && !entries.length && <p className="feature-empty">{query ? '검색한 항목이 없어요.' : '이 폴더는 비어 있어요.'}</p>}
      {!grid && !!entries.length && <div className="file-table-head"><span>이름</span><span>수정 날짜</span><span>유형</span><span>크기</span></div>}
      {entries.map((entry, i) => <div key={entry.relativePath} className={`file-entry ${selected.includes(entry.relativePath) ? 'selected' : ''}`} role="option" tabIndex={-1} aria-selected={selected.includes(entry.relativePath)} aria-label={entry.name} draggable={!entry.symbolicLink && !busy} onDragStart={e => { const paths = selected.includes(entry.relativePath) ? selected : [entry.relativePath]; e.dataTransfer.setData('application/x-opus-files', JSON.stringify(paths.map(relativePath => ({ rootId, relativePath })))); e.dataTransfer.effectAllowed = 'copyMove' }} onClick={e => { e.currentTarget.focus(); toggle(entry, i, e.ctrlKey || e.metaKey, e.shiftKey) }} onDoubleClick={() => void open(entry)}>
        <span className="file-name"><input type="checkbox" aria-label={`${entry.name} 선택`} checked={selected.includes(entry.relativePath)} disabled={busy} onClick={e => e.stopPropagation()} onChange={() => toggle(entry, i, true, false)} /><span className="file-glyph" aria-hidden="true">{entry.symbolicLink ? '↗' : entry.directory ? '📁' : '📄'}</span><span title={entry.name}>{entry.name}</span></span><span className="file-date">{new Date(entry.modified).toLocaleString('ko-KR')}</span><span className="file-type">{entry.symbolicLink ? '연결' : entry.directory ? '폴더' : entry.name.split('.').length > 1 ? entry.name.split('.').at(-1)?.toUpperCase() : '파일'}</span><span className="file-size">{entry.directory ? '' : size(entry.size)}</span>
      </div>)}
    </div><footer>{entries.length}개 항목 · {selected.length}개 선택 {selected.length ? '· Ctrl/Shift로 여러 개 선택' : ''}</footer>
  </section>
}

export function LocalLibraryView() {
  const [roots, setRoots] = useState<LocalRoot[]>([]); const [locations, setLocations] = useState<(FileRef | null)[]>([null, null]); const [selections, setSelections] = useState<string[][]>([[], []]); const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0); const [error, setError] = useState(''); const [message, setMessage] = useState('')
  const [dialog, setDialog] = useState<{ type: 'folder' | 'rename' | 'root' | 'trash'; root?: LocalRoot } | null>(null); const [name, setName] = useState('')
  const [clipboard, setClipboard] = useState<{ refs: FileRef[]; move: boolean } | null>(null)
  useEffect(() => { void window.api.localRoots().then(r => { setRoots(r); setLocations([r[0] ? { rootId: r[0].id, relativePath: '' } : null, r[1] || r[0] ? { rootId: (r[1] || r[0]).id, relativePath: '' } : null]) }).catch(e => setError(errorText(e))) }, [])
  const run = async (fn: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); setMessage(''); try { await fn() } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }
  const location = locations[active]; const refs = (selections[active] ?? []).map(relativePath => ({ rootId: location?.rootId ?? '', relativePath }))
  const navigate = (i: number, ref: FileRef) => { setLocations(v => v.map((x, n) => n === i ? ref : x)); setSelections(v => v.map((x, n) => n === i ? [] : x)) }
  const report = (results: FileResult[]) => { const failed = results.filter(r => !r.ok); setMessage(`${results.length - failed.length}개 완료${failed.length ? ` · ${failed.length}개 실패` : ''}`); if (failed.length) setError(failed.map(r => `${r.source}: ${r.error}`).join('\n')); setRefresh(n => n + 1) }
  const transfer = (sources: FileRef[], target: FileRef, move: boolean) => void run(async () => report(await window.api.localTransfer(sources, target, move)))
  const add = () => void run(async () => { const r = await window.api.localChooseRoot(); if (!r) return; setRoots(r); const newest = r.at(-1); if (newest) navigate(active, { rootId: newest.id, relativePath: '' }) })
  const start = (type: 'folder' | 'rename' | 'root', root?: LocalRoot) => { setName(type === 'root' ? root?.name ?? '' : type === 'rename' ? norm(refs[0]?.relativePath ?? '').split('/').at(-1) ?? '' : '새 폴더'); setError(''); setDialog({ type, root }) }
  const submit = () => void run(async () => {
    if (dialog?.type === 'folder' && location) await window.api.localCreateFolder(location, name)
    if (dialog?.type === 'rename' && refs[0]) await window.api.localRename(refs[0], name)
    if (dialog?.type === 'root' && dialog.root) setRoots(await window.api.localRenameRoot(dialog.root.id, name))
    if (dialog?.type === 'trash') report(await window.api.localTrash(refs))
    setDialog(null); setRefresh(n => n + 1)
  })
  const copy = (move: boolean) => { setClipboard({ refs, move }); setMessage(`${refs.length}개 항목 ${move ? '잘라내기' : '복사'} 준비됨 · 대상 탐색창에서 붙여넣기를 누르세요`) }
  const paste = () => { if (clipboard && location) { transfer(clipboard.refs, location, clipboard.move); if (clipboard.move) setClipboard(null) } }
  return <section className="local-library feature-view cardp" aria-label="PC 자료실" onKeyDown={e => {
    if (busy || dialog || (e.target as HTMLElement).closest('input:not([type=checkbox]),textarea,select')) return
    const ctrl = e.ctrlKey || e.metaKey; const key = e.key.toLowerCase()
    if (ctrl && key === 'c' && refs.length) { e.preventDefault(); copy(false) }
    if (ctrl && key === 'x' && refs.length) { e.preventDefault(); copy(true) }
    if (ctrl && key === 'v' && clipboard && location) { e.preventDefault(); paste() }
    if (key === 'f2' && refs.length === 1) { e.preventDefault(); start('rename') }
    if (key === 'delete' && refs.length) { e.preventDefault(); setDialog({ type: 'trash' }) }
    if (key === 'f5') { e.preventDefault(); setRefresh(n => n + 1) }
  }}>
    <header className="feature-head"><div><h1>자료실</h1><p>PC 폴더를 등록하고 파일을 탐색·관리해요.</p></div><button className="btn-accent" disabled={busy} onClick={add}>+ PC 폴더 등록</button><button className="btn" disabled={locations.length >= 4 || busy} onClick={() => { setLocations(v => [...v, location]); setSelections(v => [...v, []]) }}>+ 탐색창</button></header>
    <div className="file-toolbar"><button className="btn" disabled={busy || !location} onClick={() => start('folder')}>새 폴더</button><button className="btn" disabled={busy || refs.length !== 1} onClick={() => start('rename')}>이름 변경</button><button className="btn" disabled={busy || !refs.length || locations.length < 2 || !locations[(active + 1) % locations.length]} onClick={() => transfer(refs, locations[(active + 1) % locations.length]!, false)}>다음 탐색창으로 복사</button><button className="btn" disabled={busy || !refs.length || locations.length < 2 || !locations[(active + 1) % locations.length]} onClick={() => transfer(refs, locations[(active + 1) % locations.length]!, true)}>다음 탐색창으로 이동</button><button className="btn" disabled={busy || !refs.length} onClick={() => { setError(''); setDialog({ type: 'trash' }) }}>휴지통으로</button><button className="btn" disabled={busy || !location} onClick={() => void run(async () => window.api.localReveal(refs[0] ?? location!))}>탐색기에서 보기</button><button className="btn" disabled={busy} onClick={() => setRefresh(n => n + 1)}>새로고침</button></div>
    <div className="file-clipboard"><button className="btn sm" disabled={busy || !refs.length} onClick={() => copy(false)}>복사</button><button className="btn sm" disabled={busy || !refs.length} onClick={() => copy(true)}>잘라내기</button><button className="btn sm" disabled={busy || !clipboard || !location} onClick={paste}>여기에 붙여넣기</button><span className="muted small">Ctrl+C / Ctrl+X / Ctrl+V · F2 이름 변경 · 다른 탐색창으로 끌면 복사, Shift와 함께 끌면 이동</span></div>
    {(error || message || busy) && <div className="feature-message">{error && <p role="alert" className="feature-error">{error}</p>}{message && <p role="status">{message}</p>}{busy && <p role="status">파일 작업 중…</p>}</div>}
    <div className="file-layout"><aside className="file-roots" aria-label="등록한 PC 폴더">{!roots.length && <p className="feature-empty">등록한 폴더가 없어요. 계정이나 API 키 없이 PC 폴더를 선택하면 돼요.</p>}{roots.map(root => <div key={root.id} className="registered-folder"><FolderTree root={root} name={root.name} refresh={refresh} onOpen={ref => navigate(active, ref)} /><div className="root-actions"><button onClick={() => start('root', root)} disabled={busy}>표시 이름</button><button disabled={busy} onClick={() => void run(async () => { const r = await window.api.localRemoveRoot(root.id); setRoots(r); setLocations(v => v.map(x => x?.rootId === root.id ? null : x)); setMessage('등록만 해제했어요. PC 파일은 그대로예요') })}>등록 해제</button></div></div>)}</aside>
      <div className={`file-panes panes-${locations.length}`}>{locations.map((ref, i) => <FilePane key={i} index={i} location={ref} roots={roots} selected={selections[i] ?? []} active={active === i} globalBusy={busy} refresh={refresh} onLocation={next => navigate(i, next)} onSelection={paths => setSelections(v => v.map((x, n) => n === i ? paths : x))} onActive={() => setActive(i)} onTransfer={transfer} onClose={locations.length > 1 ? () => { setLocations(v => v.filter((_, n) => n !== i)); setSelections(v => v.filter((_, n) => n !== i)); setActive(0) } : undefined} />)}</div>
    </div>
    {dialog && <FeatureDialog title={dialog.type === 'trash' ? '선택한 항목을 휴지통으로 보낼까요?' : dialog.type === 'folder' ? '새 폴더' : dialog.type === 'root' ? '등록 폴더 표시 이름' : '이름 변경'} busy={busy} onClose={() => setDialog(null)}><form onSubmit={e => { e.preventDefault(); submit() }}>{dialog.type === 'trash' ? <p>{refs.length}개 항목을 OS 휴지통으로 보냅니다. 휴지통을 지원하지 않으면 원본을 남기고 실패를 알려요.</p> : <label>이름<input autoFocus value={name} maxLength={180} onChange={e => setName(e.target.value)} /></label>}{error && <p role="alert" className="feature-error">{error}</p>}<div className="actions"><button type="button" className="btn" disabled={busy} onClick={() => setDialog(null)}>취소</button><button className="btn-accent" disabled={busy || (dialog.type !== 'trash' && !name.trim())}>{dialog.type === 'trash' ? '휴지통으로 보내기' : '저장'}</button></div></form></FeatureDialog>}
  </section>
}
