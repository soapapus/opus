import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ProjectBoard, ProjectCard, ProjectColumn, ProjectStatus } from '../../../../shared/workspaceFeatures'
import { inkOn } from '../../prefs'
import { FeatureDialog } from './FeatureDialog'
const uid = () => crypto.randomUUID()
const fail = (e: unknown) => e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '프로젝트를 저장하지 못했어요'

export function ProjectBoardView() {
  const [board, setBoard] = useState<ProjectBoard | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all'); const [archives, setArchives] = useState(false)
  const [card, setCard] = useState<ProjectCard | null>(null); const [comment, setComment] = useState(''); const [tags, setTags] = useState('')
  const [column, setColumn] = useState<ProjectColumn | null>(null); const [statuses, setStatuses] = useState<ProjectStatus[] | null>(null)
  useEffect(() => { let live = true; void window.api.projectGet().then(b => { if (live) setBoard(b) }).catch(e => setError(fail(e))); return () => { live = false } }, [])
  const save = async (next: ProjectBoard): Promise<boolean> => {
    if (busy) return false
    setBusy(true); setError('')
    try { setBoard(await window.api.projectSave(next)); return true }
    catch (e) { setError(fail(e)); return false }
    finally { setBusy(false) }
  }
  const startCard = (existing?: ProjectCard, columnId?: string) => {
    if (!board) return
    const now = new Date().toISOString()
    const c: ProjectCard = existing ? structuredClone(existing) : { id: uid(), number: 0, columnId: columnId ?? board.columns.find(c => !c.archived)!.id, title: '', body: '', tags: [], due: '', priority: 'normal', archived: false, created: now, updated: now, comments: [], attachments: [] }
    setCard(c); setTags(c.tags.join(', ')); setComment(''); setError('')
  }
  const moveCard = (id: string, columnId: string, beforeId?: string) => {
    if (!board || busy) return
    const c = board.cards.find(c => c.id === id); const target = board.columns.find(c => c.id === columnId)
    if (!c || !target || target.archived) return
    const remaining = board.cards.filter(c => c.id !== id); const at = beforeId ? remaining.findIndex(c => c.id === beforeId) : -1
    const next = { ...c, columnId, archived: false }; if (at < 0) remaining.push(next); else remaining.splice(at, 0, next)
    void save({ ...board, cards: remaining })
  }
  const moveColumn = (id: string, step: number) => {
    if (!board) return
    const columns = [...board.columns]; const i = columns.findIndex(c => c.id === id); const target = i + step
    if (target < 0 || target >= columns.length) return
    ;[columns[i], columns[target]] = [columns[target], columns[i]]
    void save({ ...board, columns })
  }
  const visible = useMemo(() => board?.cards.filter(c => {
    const col = board.columns.find(x => x.id === c.columnId)
    return (archives ? c.archived || col?.archived : !c.archived && !col?.archived) && (filter === 'all' || col?.statusId === filter) && `${c.number} ${c.title} ${c.body} ${c.tags.join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  }) ?? [], [board, archives, filter, query])
  if (!board) return <section className="feature-view cardp"><p className="feature-empty" role={error ? 'alert' : 'status'}>{error || '프로젝트를 읽고 있어요…'}</p></section>
  return <section className="project-view feature-view cardp" aria-label="개인 프로젝트">
    <header className="feature-head"><div><h1>개인 프로젝트</h1><p>컬럼을 직접 만들고 카드를 끌어 옮겨요. 기록은 PC에 저장돼요.</p></div><input className="project-search" aria-label="프로젝트 검색" placeholder="번호, 제목, 내용, 태그 검색" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="프로젝트 상태 필터" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">모든 상태</option>{board.statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button className="btn" disabled={busy} onClick={() => { setStatuses(structuredClone(board.statuses)); setError('') }}>상태 관리</button><button className="btn" disabled={busy} onClick={() => { setColumn({ id: uid(), name: '', statusId: board.statuses[0].id, archived: false }); setError('') }}>+ 컬럼 추가</button><button className="btn-accent" disabled={busy} onClick={() => startCard()}>+ 새 카드</button></header>
    <div className="project-tools"><button className={`btn ${archives ? 'primary' : ''}`} onClick={() => setArchives(v => !v)}>{archives ? '보드로 돌아가기' : '보관함'}</button><button className="btn" disabled={busy} onClick={() => { void window.api.projectGet().then(b => { setBoard(b); setError('') }).catch(e => setError(fail(e))) }}>최신 보드 다시 읽기</button><span className="muted small">{busy ? '저장 중…' : `저장됨 · 버전 ${board.revision}`} · {visible.length}개 카드</span></div>
    {error && !card && !column && !statuses && <p className="feature-error" role="alert">{error}</p>}
    <div className="project-columns" onDragOver={e => {
      if (!e.dataTransfer.types.includes('application/x-opus-card')) return
      e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect()
      if (e.clientX > rect.right - 55) e.currentTarget.scrollLeft += 35
      else if (e.clientX < rect.left + 55) e.currentTarget.scrollLeft -= 35
    }}>{board.columns.filter(c => !c.archived || archives).map((col, index) => {
      const status = board.statuses.find(s => s.id === col.statusId)!; const cards = visible.filter(c => c.columnId === col.id)
      return <section key={col.id} className={`project-column ${col.archived ? 'archived' : ''}`} aria-label={`${col.name} 컬럼`} style={{ '--status-color': status.color, '--status-ink': inkOn(status.color) } as CSSProperties} onDragOver={e => { if (!col.archived && e.dataTransfer.types.includes('application/x-opus-card')) e.preventDefault() }} onDrop={e => { e.preventDefault(); if (!col.archived) moveCard(e.dataTransfer.getData('application/x-opus-card'), col.id) }}>
        <header><button className="column-title" title="클릭해서 컬럼 이름 변경" onClick={() => { setColumn({ ...col }); setError('') }}>{col.name}</button><span className="column-count">{cards.length}</span><button className="btn sm" aria-label={`${col.name} 컬럼 왼쪽 이동`} disabled={busy || index === 0} onClick={() => moveColumn(col.id, -1)}>←</button><button className="btn sm" aria-label={`${col.name} 컬럼 오른쪽 이동`} disabled={busy || index === board.columns.length - 1} onClick={() => moveColumn(col.id, 1)}>→</button></header>
        <div className="column-status"><span>이 컬럼의 상태</span><select aria-label={`${col.name} 컬럼 상태`} value={col.statusId} disabled={busy} onChange={e => void save({ ...board, columns: board.columns.map(c => c.id === col.id ? { ...c, statusId: e.target.value } : c) })}>{board.statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="column-cards">{!cards.length && <p className="feature-empty">{archives ? '보관한 카드가 없어요' : query || filter !== 'all' ? '조건에 맞는 카드가 없어요' : '카드를 추가하거나 끌어 놓으세요'}</p>}{cards.map(c => <article key={c.id} className="project-card" draggable={!busy && !archives} onDragStart={e => { e.dataTransfer.setData('application/x-opus-card', c.id); e.dataTransfer.effectAllowed = 'move' }} onDragOver={e => { if (e.dataTransfer.types.includes('application/x-opus-card')) e.preventDefault() }} onDrop={e => { e.preventDefault(); e.stopPropagation(); moveCard(e.dataTransfer.getData('application/x-opus-card'), col.id, c.id) }}>
          <button className="card-open" onClick={() => startCard(c)}><small>카드 #{c.number}{c.priority === 'high' ? ' · 높은 우선순위' : ''}</small><strong>{c.title}</strong><p>{c.body.slice(0, 180)}</p></button><div className="card-meta"><span className="project-status">{status.name}</span>{c.attachments.length > 0 && <span>📎 {c.attachments.length}</span>}{c.comments.length > 0 && <span>댓글 {c.comments.length}</span>}{c.due && <span>기한 {c.due}</span>}</div>{!!c.tags.length && <div className="card-tags">{c.tags.map(t => <span key={t}>#{t}</span>)}</div>}<small className="muted">수정 {new Date(c.updated).toLocaleString('ko-KR')}</small>
          <select aria-label={`${c.title} 카드 이동`} value={c.columnId} disabled={busy} onChange={e => moveCard(c.id, e.target.value)}>{board.columns.filter(col => !col.archived || col.id === c.columnId).map(col => <option key={col.id} value={col.id}>{col.name}</option>)}</select>
        </article>)}</div>
        <footer>{col.archived ? <button className="btn" disabled={busy} onClick={() => void save({ ...board, columns: board.columns.map(c => c.id === col.id ? { ...c, archived: false } : c) })}>컬럼 복원</button> : <button className="btn" disabled={busy} onClick={() => startCard(undefined, col.id)}>+ 카드 추가</button>}</footer>
      </section>
    })}</div>
    {card && <FeatureDialog title={card.number ? `카드 #${card.number}` : '새 카드'} busy={busy} onClose={() => setCard(null)}><form onSubmit={async e => {
      e.preventDefault(); const next = { ...card, tags: [...new Set(tags.split(',').map(s => s.trim()).filter(Boolean))] }
      if (comment.trim()) next.comments = [...next.comments, { id: uid(), body: comment.trim(), created: new Date().toISOString() }]
      if (await save({ ...board, cards: board.cards.some(c => c.id === next.id) ? board.cards.map(c => c.id === next.id ? next : c) : [...board.cards, next] })) setCard(null)
    }}>
      <label>카드 제목<input autoFocus required maxLength={200} value={card.title} onChange={e => setCard({ ...card, title: e.target.value })} /></label><label>카드 내용<textarea rows={8} maxLength={200000} value={card.body} onChange={e => setCard({ ...card, body: e.target.value })} /></label><div className="feature-form-row"><label>컬럼<select value={card.columnId} onChange={e => setCard({ ...card, columnId: e.target.value })}>{board.columns.filter(c => !c.archived || c.id === card.columnId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>기한<input type="date" value={card.due} onChange={e => setCard({ ...card, due: e.target.value })} /></label><label>우선순위<select value={card.priority} onChange={e => setCard({ ...card, priority: e.target.value as ProjectCard['priority'] })}><option value="low">낮음</option><option value="normal">보통</option><option value="high">높음</option></select></label></div><label>태그 (쉼표로 구분)<input maxLength={1000} value={tags} onChange={e => setTags(e.target.value)} /></label>
      <div className="project-attachments"><button className="btn" type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const added = await window.api.projectAttach(); setCard(c => c ? { ...c, attachments: [...c.attachments, ...added] } : c) } catch (e) { setError(fail(e)) } finally { setBusy(false) } }}>파일 첨부</button><p className="muted small">선택한 파일의 사본을 Opus에 보관하고 백업에 포함해요.</p>{card.attachments.map(a => <div key={a.id}><button className="text-btn" type="button" onClick={() => void window.api.projectOpenAttachment(a.id).catch(e => setError(fail(e)))}>{a.name}</button><button className="btn sm" type="button" onClick={() => setCard({ ...card, attachments: card.attachments.filter(x => x.id !== a.id) })}>첨부 해제</button></div>)}</div>
      <div className="project-comments">{card.comments.map(m => <article key={m.id}><small>나 · {new Date(m.created).toLocaleString('ko-KR')}</small><p>{m.body}</p></article>)}</div><label>새 댓글<textarea rows={2} value={comment} maxLength={20000} onChange={e => setComment(e.target.value)} /></label>
      {error && <p role="alert" className="feature-error">{error}</p>}<div className="actions"><button type="button" className="btn" disabled={busy} onClick={() => setCard(null)}>취소</button>{card.number > 0 && <button type="button" className="btn" disabled={busy} onClick={async () => { if (await save({ ...board, cards: board.cards.map(c => c.id === card.id ? { ...c, archived: !c.archived } : c) })) setCard(null) }}>{card.archived ? '카드 복원' : '카드 보관'}</button>}<button className="btn-accent" disabled={busy || !card.title.trim()}>카드 저장</button></div>
    </form></FeatureDialog>}
    {column && <FeatureDialog title={board.columns.some(c => c.id === column.id) ? '컬럼 편집' : '컬럼 추가'} busy={busy} onClose={() => setColumn(null)}><form onSubmit={async e => { e.preventDefault(); if (await save({ ...board, columns: board.columns.some(c => c.id === column.id) ? board.columns.map(c => c.id === column.id ? column : c) : [...board.columns, column] })) setColumn(null) }}><label>컬럼 이름<input autoFocus required maxLength={80} value={column.name} onChange={e => setColumn({ ...column, name: e.target.value })} /></label><label>컬럼 상태<select value={column.statusId} onChange={e => setColumn({ ...column, statusId: e.target.value })}>{board.statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{error && <p role="alert" className="feature-error">{error}</p>}<p className="muted small">컬럼을 보관해도 카드와 첨부 파일은 남아요.</p><div className="actions"><button type="button" className="btn" disabled={busy} onClick={() => setColumn(null)}>취소</button>{board.columns.some(c => c.id === column.id) && <button type="button" className="btn" disabled={busy} onClick={async () => { if (await save({ ...board, columns: board.columns.map(c => c.id === column.id ? { ...c, archived: !c.archived } : c) })) setColumn(null) }}>{column.archived ? '컬럼 복원' : '컬럼 보관'}</button>}<button className="btn-accent" disabled={busy || !column.name.trim()}>컬럼 저장</button></div></form></FeatureDialog>}
    {statuses && <FeatureDialog title="상태 관리" busy={busy} onClose={() => setStatuses(null)}><form onSubmit={async e => { e.preventDefault(); if (await save({ ...board, statuses })) setStatuses(null) }}>{statuses.map((s, i) => <div className="feature-form-row" key={s.id}><label>상태 이름 {i + 1}<input value={s.name} maxLength={40} required onChange={e => setStatuses(statuses.map(x => x.id === s.id ? { ...x, name: e.target.value } : x))} /></label><label>상태 색상 {i + 1}<input type="color" value={s.color} onChange={e => setStatuses(statuses.map(x => x.id === s.id ? { ...x, color: e.target.value } : x))} /></label></div>)}<button type="button" className="btn" disabled={statuses.length >= 50} onClick={() => setStatuses([...statuses, { id: uid(), name: '새 상태', color: '#3d6aa8' }])}>+ 상태 추가</button>{error && <p role="alert" className="feature-error">{error}</p>}<div className="actions"><button type="button" className="btn" onClick={() => setStatuses(null)} disabled={busy}>취소</button><button className="btn-accent" disabled={busy}>상태 저장</button></div></form></FeatureDialog>}
  </section>
}
