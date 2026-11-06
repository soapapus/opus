import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { APP_CSP } from '../src/shared/csp'

it('화면 테스트 서버는 설치본과 같은 CSP로 띄운다', () => {
  expect(readFileSync('e2e/serve.mjs', 'utf8')).toContain(`const CSP = "${APP_CSP}"`)
})
