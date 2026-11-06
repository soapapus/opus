/** 주소 또는 검색어를 HTTP(S) 주소로 바꾼다. 실행 가능한 스킴·자격 증명은 받지 않는다. */
export function browserAddress(input: string): string {
  const value = input.trim()
  if (!value || value === 'about:blank') return 'about:blank'
  if (value.length > 8192 || /[\x00-\x1f]/.test(value)) throw new Error('주소가 너무 길거나 올바르지 않아요')
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:/i.test(value) && !/^[\w.-]+:\d+(?:\/|$)/.test(value)) throw new Error('http 또는 https 주소만 열 수 있어요')
  const looksLikeHost = /^(?:localhost|(?:[\w-]+\.)+[\w-]+)(?::\d+)?(?:[/?#]|$)/i.test(value)
  const url = new URL(/^https?:\/\//i.test(value) ? value : looksLikeHost ? `${/^localhost(?::|\/|$)/i.test(value) ? 'http' : 'https'}://${value}` : `https://www.google.com/search?q=${encodeURIComponent(value)}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('로그인 정보가 들어 있지 않은 http 또는 https 주소를 입력해 주세요')
  return url.href
}
export const isWebAddress = (url: string): boolean => { try { return url !== 'about:blank' && browserAddress(url) === new URL(url).href } catch { return false } }
