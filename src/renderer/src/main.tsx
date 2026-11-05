import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts'
import './styles.css'
import './opus.css'
import { App } from './App'
import { FloatingScratchpad } from './components/FloatingScratchpad'

const isScratch = new URLSearchParams(window.location.search).has('scratch')

function render(): void {
  createRoot(document.getElementById('root')!).render(<StrictMode>{isScratch ? <FloatingScratchpad /> : <App />}</StrictMode>)
}

// 브라우저에서 화면만 볼 때(개발용)는 가짜 데이터로 띄운다. 설치본(Electron)에서는 쓰지 않는다.
if ((window as unknown as { api?: unknown }).api) render()
else void import('./mockApi').then((m) => (m.installMockApi(), render()))
