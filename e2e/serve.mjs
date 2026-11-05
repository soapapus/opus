// 화면 테스트용 정적 서버: out/renderer 를 그대로 띄운다 (window.api 가 없어서 mockApi.ts 가짜 데이터로 동작)
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = join(process.cwd(), 'out', 'renderer')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' }
const port = Number(process.env.PORT ?? 4173)

createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0])
  const path = normalize(join(root, url === '/' ? 'index.html' : url))
  if (!path.startsWith(root)) return void res.writeHead(403).end()
  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(port, '127.0.0.1')
