// 설치본 화면의 보안 정책. 화면 테스트 서버(e2e/serve.mjs)도 같은 값을 써서, 설치본에서만 나는 오류를 테스트에서 잡는다.
export const APP_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; script-src 'self'"
