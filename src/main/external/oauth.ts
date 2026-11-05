// OAuth 공통 도구: PKCE, 내 PC 안에서만 열리는 로그인 응답 수신기, 폼 전송.
import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export type FetchFn = typeof fetch

export const randomString = (bytes = 32): string => randomBytes(bytes).toString('base64url')

/** PKCE (RFC 7636): 인증 요청에는 challenge만, 토큰 교환에만 verifier를 보낸다 */
export function makePkce(verifier: string = randomString(48)): { verifier: string; challenge: string } {
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export interface Loopback {
  redirectUri: string
  /** 로그인 후 돌아온 code. 상태값이 다르거나 시간이 지나면 거절한다 */
  code: Promise<string>
  close(): void
}

const PAGE = (msg: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Opus</title><body style="font-family:sans-serif;padding:48px;line-height:1.7"><h2>${msg}</h2><p>이 창은 닫아도 돼요. Opus로 돌아가세요.</p></body>`

/** 127.0.0.1에서만 받는 임시 서버. 외부 네트워크에는 열리지 않는다. */
export function startLoopback(opts: { path: string; state: string; port?: number; timeoutMs?: number }): Promise<Loopback> {
  return new Promise((resolveStart, rejectStart) => {
    let settle: { ok: (c: string) => void; fail: (e: Error) => void }
    const code = new Promise<string>((ok, fail) => (settle = { ok, fail }))
    code.catch(() => undefined) // 아무도 기다리지 않아도 오류 로그가 나지 않게
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== opts.path) {
        res.writeHead(404).end()
        return
      }
      const err = url.searchParams.get('error')
      const got = url.searchParams.get('code')
      if (err) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('연결이 취소됐어요'))
        settle.fail(new Error(`연결이 취소됐어요 (${err})`))
      } else if (url.searchParams.get('state') !== opts.state || !got) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('올바르지 않은 요청이에요'))
        settle.fail(new Error('로그인 응답을 확인하지 못했어요 (state 불일치)'))
      } else {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('연결되었어요'))
        settle.ok(got)
      }
    })
    const timer = setTimeout(() => settle.fail(new Error('로그인 시간이 지났어요. 다시 시도해 주세요')), opts.timeoutMs ?? 180_000)
    const close = (): void => {
      clearTimeout(timer)
      server.close()
    }
    server.once('error', (e) => rejectStart(e))
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      code.finally(close).catch(() => undefined)
      resolveStart({ redirectUri: `http://127.0.0.1:${port}${opts.path}`, code, close })
    })
  })
}

export async function postForm(
  fetchFn: FetchFn,
  url: string,
  params: Record<string, string | undefined>,
  headers: Record<string, string> = {}
): Promise<unknown> {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, v)
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body
  })
  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  if (!res.ok) throw new Error(`요청 실패 (${res.status}) ${text.slice(0, 200)}`)
  return json
}
