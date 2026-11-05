// 메모 파일(마크다운) 맨 위의 정보 칸(front matter)을 읽고 쓴다.
// 값은 JSON 문자열로 적어서 따옴표·콜론이 들어간 제목도 안전하다.

export interface NoteMeta {
  id: string
  title: string
  /** 기록 종류. 예전 파일에는 없다 */
  kind?: string
  date: string
  time?: string | null
  links?: string[]
  tags: string[]
  source: string
  created: string
  updated: string
}

export function serializeNote(meta: NoteMeta, body: string): string {
  const head = [
    '---',
    `id: ${meta.id}`,
    `title: ${JSON.stringify(meta.title)}`,
    ...(meta.kind ? [`kind: ${meta.kind}`] : []),
    `date: ${meta.date}`,
    ...(meta.time ? [`time: ${JSON.stringify(meta.time)}`] : []),
    `tags: ${JSON.stringify(meta.tags)}`,
    ...(meta.links && meta.links.length ? [`links: ${JSON.stringify(meta.links)}`] : []),
    `source: ${meta.source}`,
    `created: ${meta.created}`,
    `updated: ${meta.updated}`,
    '---'
  ].join('\n')
  const text = body.replace(/\r\n/g, '\n').replace(/^\n+/, '').trimEnd()
  return `${head}\n${text}${text ? '\n' : ''}`
}

function parseValue(raw: string): unknown {
  const value = raw.trim()
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      return value.replace(/^"|"$/g, '')
    }
  }
  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      /* 손으로 고친 [a, b] 형태는 아래에서 처리 */
    }
    return value
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
  }
  return value.replace(/^'|'$/g, '')
}

export interface ParsedNote {
  meta: Partial<NoteMeta>
  body: string
}

export function parseNote(text: string): ParsedNote {
  const normalized = text.replace(/\r\n/g, '\n').replace(/^﻿/, '')
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized)
  if (!match) return { meta: {}, body: normalized.trimEnd() }

  const meta: Record<string, unknown> = {}
  for (const line of match[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (kv) meta[kv[1]] = parseValue(kv[2])
  }
  const asString = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const tags = Array.isArray(meta.tags)
    ? (meta.tags as unknown[]).map(String)
    : typeof meta.tags === 'string' && meta.tags
      ? [meta.tags]
      : undefined
  return {
    meta: {
      id: asString(meta.id),
      title: asString(meta.title),
      kind: asString(meta.kind),
      date: asString(meta.date),
      time: asString(meta.time),
      links: Array.isArray(meta.links) ? (meta.links as unknown[]).map(String) : undefined,
      tags,
      source: asString(meta.source),
      created: asString(meta.created),
      updated: asString(meta.updated)
    },
    body: normalized.slice(match[0].length).trimEnd()
  }
}
