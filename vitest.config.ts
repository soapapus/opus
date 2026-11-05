import { defineConfig } from 'vitest/config'

// 날짜 테스트는 한국 시간 기준이라, 어느 PC·CI에서 돌려도 같은 결과가 나오게 고정한다
process.env.TZ = 'Asia/Seoul'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: { TZ: 'Asia/Seoul' }
  }
})
