import { useEffect, type ReactNode } from 'react'
export function FeatureDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [onClose, busy])
  return <div className="overlay"><section className="dialog feature-dialog" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="btn" aria-label="대화상자 닫기" disabled={busy} onClick={onClose}>×</button></header>{children}</section></div>
}
