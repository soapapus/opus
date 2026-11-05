// 집·회사 두 PC가 Google Drive 같은 동기화 폴더로 메모를 함께 쓸 때 필요한 순수 함수들.

/** 데이터 폴더가 Google Drive·OneDrive·Dropbox 같은 동기화 폴더 안에 있는지 (경로 이름으로 짐작) */
export function isCloudSyncedPath(path: string): boolean {
  return /(^|[\\/])(내 드라이브|My Drive|Google Drive|GoogleDrive|공유 드라이브|Shared drives|OneDrive[^\\/]*|Dropbox)([\\/]|$)/i.test(path)
}

/** 다른 PC에서 고친 내용을 남기는 사본의 제목 */
export function conflictTitle(title: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${p(now.getMonth() + 1)}/${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`
  return `${title.trim() || '제목 없음'} (다른 PC에서 고친 내용 ${stamp})`
}

/** 편집기가 읽은 뒤에 파일이 바뀌었는지 */
export function changedSince(baseUpdated: string | undefined, currentUpdated: string): boolean {
  return !!baseUpdated && baseUpdated !== currentUpdated
}
