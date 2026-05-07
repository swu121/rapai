import { useState, useEffect } from 'react'
import type { StoredSession } from '../App'

const API = 'http://localhost:3001'

type Association = {
  used_word: string
  suggested_word: string
  session_id: string
  session_title: string
  session_started_at: string
  count: number
}

type TooltipState = {
  assocs: Association[]
  x: number
  y: number
  below: boolean
}

type Props = {
  session: StoredSession
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function duration(start: string, end: string) {
  const secs = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

export function SessionViewer({ session }: Props) {
  const [assocMap, setAssocMap] = useState<Map<string, Association[]>>(new Map())
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  useEffect(() => {
    setAssocMap(new Map())
    fetch(`${API}/sessions/${session.id}/associations`)
      .then(r => r.json())
      .then((rows: Association[]) => {
        const map = new Map<string, Association[]>()
        for (const row of rows) {
          const key = row.used_word.toLowerCase()
          if (!map.has(key)) map.set(key, [])
          map.get(key)!.push(row)
        }
        setAssocMap(map)
      })
      .catch(() => {})
  }, [session.id])

  const tokens = session.transcript.trim().split(/(\s+)/)

  function handleWordHover(e: React.MouseEvent, assocs: Association[]) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const below = rect.top < 120
    setTooltip({ assocs, x: rect.left, y: below ? rect.bottom : rect.top, below })
  }

  return (
    <div className="session-viewer">
      <h2 className="session-viewer-title">{session.title}</h2>
      <div className="session-meta">
        {formatDate(session.started_at)} &nbsp;·&nbsp; {duration(session.started_at, session.ended_at)}
      </div>
      <div className="session-transcript">
        {tokens.map((token, i) => {
          if (/^\s+$/.test(token)) return token
          const key = token.toLowerCase().replace(/[^a-z']/g, '')
          const assocs = assocMap.get(key)
          if (!assocs?.length) return <span key={i}>{token}</span>
          return (
            <span
              key={i}
              className="transcript-word--associated"
              onMouseEnter={e => handleWordHover(e, assocs)}
              onMouseLeave={() => setTooltip(null)}
            >
              {token}
            </span>
          )
        })}
      </div>

      {tooltip && (
        <div
          className={`word-tooltip${tooltip.below ? ' word-tooltip--below' : ''}`}
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.assocs.map((a, i) => (
            <div key={i} className="word-tooltip-entry">
              <div className="word-tooltip-suggestion">
                Suggested: <strong>{a.suggested_word}</strong>
              </div>
              <div className="word-tooltip-session">{a.session_title}</div>
              <div className="word-tooltip-date">{formatShortDate(a.session_started_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
