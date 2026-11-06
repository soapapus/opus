import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CloudService, DEFAULT_MODEL, geminiError, isRetiredModel, type CloudDeps } from '../src/main/external/cloud'
import { GoogleClient, SCOPE_DRIVE, SCOPE_READ, SCOPE_WRITE } from '../src/main/external/google'
import { createBackup, listBackups } from '../src/main/backup/backup'
import { unzipSync } from 'fflate'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'opus-cloud-'))
  const data = join(root, 'data'); mkdirSync(data)
  const backups = join(root, 'backups')
  writeFileSync(join(data, 'record.md'), '보존할 기록')
  const calls: { url: string; init?: RequestInit }[] = []
  let offline = false
  let account = 'person@example.test'
  let failAi = false
  const deps: CloudDeps = {
    localDir: join(root, 'local'), dataDir: data,
    vault: { available: () => true, encrypt: s => Buffer.from(s).reverse(), decrypt: b => Buffer.from(b).reverse().toString() },
    configured: () => true, connected: () => true, account: () => account,
    token: async () => 'test-token', snapshot: () => createBackup(data, backups),
    fetch: (async (input, init) => {
      const url = String(input); calls.push({ url, init })
      if (offline) throw new Error('offline')
      if (url.includes('generativelanguage')) return Response.json(failAi ? { error: 'do-not-display-secret' } : { candidates: [{ content: { parts: [{ text: '답변' }] } }] }, { status: failAi ? 429 : 200 })
      if (url.includes('/upload/')) return Response.json({ id: 'uploaded' })
      if (url.includes('/drives?')) return Response.json({ drives: [{ id: 'shared', name: '공유 자료' }] })
      if (url.includes('/files/folder?')) return Response.json({ id: 'folder', name: 'Opus', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } })
      if (url.includes('/files?')) return Response.json({ files: [{ id: 'file', name: '문서.zip', mimeType: 'application/zip' }] })
      throw new Error('unexpected URL')
    }) as typeof fetch
  }
  return { root, data, calls, deps, service: new CloudService(deps), setOffline: (x: boolean) => { offline = x }, setAccount: (x: string) => { account = x }, failAi: () => { failAi = true } }
}

describe('Google 통합 권한', () => {
  it('선택한 캘린더 쓰기와 Drive 권한만 OAuth 요청에 포함한다', () => {
    const client = new GoogleClient({ clientId: 'test' })
    const base = { redirectUri: 'http://127.0.0.1/cb', state: 's', challenge: 'c', write: false }
    expect(new URL(client.buildAuthUrl(base)).searchParams.get('scope')).toBe(SCOPE_READ)
    const combined = new URL(client.buildAuthUrl({ ...base, write: true, drive: true }))
    expect(combined.searchParams.get('scope')?.split(' ')).toEqual([SCOPE_READ, SCOPE_WRITE, SCOPE_DRIVE])
    expect(combined.searchParams.get('prompt')).toContain('select_account')
  })
})

describe('Drive 백업 보존', () => {
  it('상태 조회와 꺼진 자동 백업은 통신하지 않는다', async () => {
    const t = setup(); t.service.state(); await t.service.backup(true)
    expect(t.calls).toHaveLength(0)
  })
  it('업로드 실패 후 재시작해도 zip과 대기 항목을 보존하고 다시 전송한다', async () => {
    const t = setup(); await t.service.selectFolder('folder'); t.service.setAutoBackup(true)
    t.setOffline(true)
    expect((await t.service.backup()).pendingBackups).toBe(1)
    const config = JSON.parse(readFileSync(join(t.root, 'local', 'cloud.json'), 'utf8'))
    expect(new TextDecoder().decode(unzipSync(readFileSync(config.pending[0].path))['record.md'])).toBe('보존할 기록')
    const restarted = new CloudService(t.deps)
    expect(restarted.state().pendingBackups).toBe(1)
    t.setOffline(false); await restarted.backup(true)
    expect(restarted.state().pendingBackups).toBe(0)
    expect(restarted.state().lastBackup).toBeTruthy()
    expect(readFileSync(config.pending[0].path).length).toBeGreaterThan(0)
    const upload = t.calls.find(c => c.url.includes('/upload/') && c.init?.method === 'POST')!
    expect(upload.url).toContain('supportsAllDrives=true')
    expect(String(upload.init?.body)).toContain('"parents":["folder"]')
    expect(t.calls.some(c => ['PATCH', 'DELETE'].includes(c.init?.method ?? ''))).toBe(false)
  })
  it('계정 변경 후 이전 계정의 백업을 자동 전송하지 않는다', async () => {
    const t = setup(); await t.service.selectFolder('folder'); t.service.setAutoBackup(true)
    t.setAccount('other@example.test')
    await expect(t.service.backup(true)).rejects.toThrow('계정이 바뀌었어요')
    expect(t.calls.some(c => c.url.includes('/upload/'))).toBe(false)
  })
  it('공유 드라이브 목록과 내부 폴더를 조회하고 폴더 밖 파일은 열지 않는다', async () => {
    const t = setup()
    expect(await t.service.folders()).toContainEqual(expect.objectContaining({ id: 'shared', driveId: 'shared' }))
    expect(t.calls.some(c => c.url.includes('corpora=drive') && c.url.includes('driveId=shared'))).toBe(true)
    await t.service.selectFolder('folder')
    await expect(t.service.file('outside')).rejects.toThrow('찾을 수 없어요')
  })
  it('같은 초에 만든 로컬 백업도 기존 백업을 덮어쓰지 않는다', () => {
    const t = setup(); const dir = join(t.root, 'backups'); const now = new Date()
    const first = createBackup(t.data, dir, now)!
    writeFileSync(join(t.data, 'record.md'), '새 기록')
    const second = createBackup(t.data, dir, now)!
    expect(second).not.toBe(first)
    expect(new TextDecoder().decode(unzipSync(readFileSync(first))['record.md'])).toBe('보존할 기록')
    expect(listBackups(dir)).toHaveLength(2)
  })
})

describe('Gemini와 대화 보존', () => {
  it('키를 암호화하고 직접 입력한 대화만 전송하며 대화를 백업한다', async () => {
    const t = setup(); t.service.configureAi('private-api-key', 'gemini-flash-latest')
    expect(readFileSync(join(t.root, 'local', 'gemini.bin'), 'utf8')).not.toContain('private-api-key')
    expect(JSON.stringify(t.service.state())).not.toContain('private-api-key')
    const chat = await t.service.send(null, '직접 쓴 질문')
    expect(chat.messages).toHaveLength(2)
    const request = t.calls.find(c => c.url.includes('generativelanguage'))!
    expect(String(request.init?.body)).toContain('직접 쓴 질문')
    expect(String(request.init?.body)).not.toContain('보존할 기록')
    expect(request.url).not.toContain('private-api-key')
    const zip = createBackup(t.data, join(t.root, 'backups'))!
    const files = unzipSync(readFileSync(zip))
    expect(files[`personal/ai/chats/${chat.id}.json`]).toBeTruthy()
    expect(Object.keys(files).some(f => f.includes('.bin'))).toBe(false)
    expect(new CloudService(t.deps).chat(chat.id).messages).toHaveLength(2)
  })
  it('요청 실패 때도 사용자가 작성한 질문을 저장하며 서버 응답의 비밀을 노출하지 않는다', async () => {
    const t = setup(); t.service.configureAi('key', 'gemini-flash-latest'); t.failAi()
    await expect(t.service.send(null, '잃으면 안 되는 질문')).rejects.toThrow('429')
    const [only] = new CloudService(t.deps).chatList()
    expect(new CloudService(t.deps).chat(only.id).messages).toEqual([expect.objectContaining({ text: '잃으면 안 되는 질문', role: 'user' })])
  })
  it('손상된 대화 파일을 빈 대화로 덮어쓰지 않는다', async () => {
    const t = setup(); t.service.configureAi('key', 'gemini-flash-latest')
    const path = join(t.data, 'personal', 'ai', 'chats', 'broken.json'); mkdirSync(join(t.data, 'personal', 'ai', 'chats'), { recursive: true }); writeFileSync(path, 'broken')
    expect(t.service.chatList()).toEqual([])
    await expect(t.service.send('broken', '질문')).rejects.toThrow()
    expect(readFileSync(path, 'utf8')).toBe('broken')
  })
})

it('두 PC가 Drive 백업을 왕복 병합하고 재시작 후 같은 장치 버전은 다시 가져오지 않는다', async () => {
  const a = setup(), b = setup()
  const { NoteStore } = await import('../src/main/storage/noteStore')
  const remote: { file: import('../src/shared/types').DriveFile; zip: Uint8Array }[] = []
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('/upload/')) {
      const body = Buffer.from(init!.body as Buffer)
      const text = body.toString('utf8'); const start = text.indexOf('\r\n\r\n') + 4; const end = text.indexOf('\r\n--', start)
      const meta = JSON.parse(text.slice(start, end)); const marker = Buffer.from('Content-Type: application/zip\r\n\r\n')
      const zipStart = body.indexOf(marker) + marker.length; const zipEnd = body.lastIndexOf(Buffer.from('\r\n--'))
      const id = `backup-${remote.length + 1}`
      remote.push({ file: { id, name: meta.name, mimeType: 'application/zip', appProperties: meta.appProperties }, zip: body.subarray(zipStart, zipEnd) })
      return Response.json({ id })
    }
    if (url.includes('/files/folder?')) return Response.json({ id: 'folder', name: 'Opus', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } })
    if (url.includes('/files?')) return Response.json({ files: remote.map(r => r.file) })
    if (url.includes('alt=media')) { const id = new URL(url).pathname.split('/').at(-1); return new Response(remote.find(r => r.file.id === id)!.zip as BodyInit) }
    throw new Error(`unexpected ${url}`)
  }
  a.deps.fetch = fetchFn; b.deps.fetch = fetchFn
  await a.service.selectFolder('folder'); await b.service.selectFolder('folder')
  a.service.setAutoMerge(true); b.service.setAutoMerge(true)
  const as = new NoteStore(a.data), bs = new NoteStore(b.data)
  const original = as.build({ id: 'shared-note', kind: 'document', date: '', title: '공통', body: '집에서 작성' })
  as.write(original)
  await a.service.backup()
  await b.service.mergeAutomatic()
  expect(bs.read(bs.listFiles()[0].path).body).toBe('집에서 작성')
  bs.write({ ...bs.read(bs.listFiles()[0].path), body: '회사에서 이어서 수정' })
  await b.service.backup()
  await a.service.mergeAutomatic()
  expect(as.read(as.listFiles()[0].path).body).toBe('회사에서 이어서 수정')
  const before = JSON.stringify(as.listFiles())
  const restored = new CloudService(a.deps)
  await restored.mergeAutomatic()
  expect(JSON.stringify(as.listFiles())).toBe(before)
  expect(as.listFiles()).toHaveLength(1)
  expect(remote).toHaveLength(2) // 병합이 원격 원본 ZIP을 수정·삭제하지 않는다.
})

it('Gemini 응답 도중 대화 파일이 바뀌어도 양쪽 대화와 새 답변을 보존한다', async () => {
  const t = setup(); t.service.configureAi('key', 'gemini-flash-latest')
  let resolve!: (r: Response) => void
  t.deps.fetch = async () => new Promise<Response>(r => { resolve = r })
  const pending = t.service.send(null, '진행 중 질문')
  await expect(t.service.previewMerge('file')).rejects.toThrow('AI 답변')
  const [started] = t.service.chatList()
  writeFileSync(join(t.data, 'personal/ai/chats', `${started.id}.json`), JSON.stringify({ created: '2026-11-06T10:00:00Z', messages: [{ role: 'user', text: '다른 PC의 대화', created: '2026-11-06T10:00:00Z' }] }))
  resolve(Response.json({ candidates: [{ content: { parts: [{ text: '늦게 도착한 답변' }] } }] }))
  await expect(pending).rejects.toThrow('갈라진 대화')
  expect(t.service.chat(started.id).messages[0].text).toBe('다른 PC의 대화')
  const fork = t.service.chatList().find(c => c.id !== started.id)!
  expect(t.service.chat(fork.id).messages.map(m => m.text)).toEqual(['진행 중 질문', '늦게 도착한 답변'])
})

describe('종료된 Gemini 모델', () => {
  it('gemini-1.5-flash 같은 옛 모델은 현재 기본 모델로 바꿔 요청한다', async () => {
    const t = setup()
    mkdirSync(join(t.root, 'local'), { recursive: true })
    writeFileSync(join(t.root, 'local', 'cloud.json'), JSON.stringify({ autoBackup: false, pending: [], model: 'gemini-1.5-flash', deviceId: 'd', sequence: 0 }))
    t.service.configureAi('key', 'gemini-1.5-flash')
    expect(t.service.state().aiModel).toBe(DEFAULT_MODEL)
    await t.service.send(null, '질문')
    expect(t.calls.at(-1)!.url).toContain(`/models/${DEFAULT_MODEL}:generateContent`)
    expect(isRetiredModel('gemini-2.5-flash')).toBe(false)
  })
  it('404·키 오류는 고칠 방법을 알려 준다', () => {
    expect(geminiError(404, 'gemini-x')).toContain('찾을 수 없어요')
    expect(geminiError(403, 'm')).toContain('API 키')
  })
})

describe('여러 AI 대화', () => {
  it('대화를 따로 저장하고, 이어 쓰면 그 대화에만 붙으며 최근 대화가 위에 온다', async () => {
    const t = setup(); t.service.configureAi('key', 'gemini-flash-latest')
    const a = await t.service.send(null, '첫 대화 질문')
    const b = await t.service.send(null, '둘째 대화 질문')
    await t.service.send(a.id, '첫 대화 이어서')
    const list = t.service.chatList()
    expect(list.map(c => c.id)).toEqual([a.id, b.id])
    expect(list[0]).toMatchObject({ title: '첫 대화 질문', count: 4 })
    const body = JSON.parse(String(t.calls.at(-1)!.init?.body))
    expect(JSON.stringify(body)).toContain('첫 대화 질문')
    expect(JSON.stringify(body)).not.toContain('둘째 대화 질문')
  })
  it('다시 생성은 마지막 질문까지만 보내고 예전 답도 남긴다', async () => {
    const t = setup(); t.service.configureAi('key', 'gemini-flash-latest')
    const a = await t.service.send(null, '질문')
    const again = await t.service.regenerate(a.id)
    expect(again.messages.map(m => m.role)).toEqual(['user', 'model', 'model'])
    const body = JSON.parse(String(t.calls.at(-1)!.init?.body)) as { contents: { role: string }[] }
    expect(body.contents.map(c => c.role)).toEqual(['user'])
  })
  it('예전 한 줄 대화와 갈라진 대화는 원본을 두고 목록으로 한 번만 복사한다', () => {
    const t = setup()
    const ai = join(t.data, 'personal', 'ai'); mkdirSync(join(ai, 'imports'), { recursive: true })
    const old = [{ role: 'user', text: '예전 질문', created: '2026-11-05T10:00:00Z' }, { role: 'model', text: '예전 답', created: '2026-11-05T10:00:01Z' }]
    writeFileSync(join(ai, 'conversation.json'), JSON.stringify(old))
    writeFileSync(join(ai, 'imports', `${'a'.repeat(64)}.json`), JSON.stringify([{ role: 'user', text: '다른 PC 질문', created: '2026-11-04T10:00:00Z' }]))
    const list = t.service.chatList()
    expect(list.map(c => c.title)).toEqual(['예전 질문', '다른 PC 질문 (다른 PC)'])
    expect(t.service.chatList()).toHaveLength(2)
    expect(JSON.parse(readFileSync(join(ai, 'conversation.json'), 'utf8'))).toEqual(old)
  })
  it('대화 이름을 바꾸고, 이번 달 토큰을 센다', async () => {
    const t = setup(); t.service.configureAi('key', 'gemini-flash-latest')
    t.deps.fetch = (async () => Response.json({ candidates: [{ content: { parts: [{ text: '답' }] } }], usageMetadata: { totalTokenCount: 321 } })) as typeof fetch
    const a = await t.service.send(null, '질문')
    expect(t.service.renameChat(a.id, '  새 이름  ').title).toBe('새 이름')
    expect(t.service.chatList()[0].title).toBe('새 이름')
    expect(t.service.state().aiTokensThisMonth).toBe(321)
    expect(() => t.service.chat('../outside')).toThrow('대화를 찾을 수 없어요')
  })
  it('쓸 수 있는 모델 목록은 대화가 되는 Gemini 모델만, 종료된 모델은 뺀다', async () => {
    const t = setup(); t.service.configureAi('key', 'gemini-flash-latest')
    t.deps.fetch = (async () => Response.json({ models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }
    ] })) as typeof fetch
    expect(await t.service.models()).toEqual([DEFAULT_MODEL, 'gemini-2.5-flash'])
  })
})
