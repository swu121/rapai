import { useState, useEffect, useRef } from 'react'
import type { StoredSession } from '../App'

const API = 'http://localhost:3001'
type TimedWord = { word: string; start: number; end: number }

function inferThreshold(words: TimedWord[]): number {
  const gaps = words.slice(1).map((w, i) => w.start - words[i].end).sort((a, b) => a - b)
  if (gaps.length < 2) return 800
  let biggestJump = 0, splitIdx = 0
  for (let i = 1; i < gaps.length; i++) {
    const jump = gaps[i] - gaps[i - 1]
    if (jump > biggestJump) { biggestJump = jump; splitIdx = i }
  }
  return (gaps[splitIdx - 1] + gaps[splitIdx]) / 2
}

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
  onTitleChange: (id: string, title: string) => void
}

function detectLines(words: TimedWord[], threshold: number): string[][] {
  if (!words.length) return []
  const lines: string[][] = []
  let current: string[] = [words[0].word]
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end
    if (gap >= threshold) {
      lines.push(current)
      current = [words[i].word]
    } else {
      current.push(words[i].word)
    }
  }
  if (current.length) lines.push(current)
  return lines
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

export function SessionViewer({ session, onTitleChange }: Props) {
  const [assocMap, setAssocMap] = useState<Map<string, Association[]>>(new Map())
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(session.title)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraftTitle(session.title)
    setEditingTitle(false)
  }, [session.id, session.title])

  function startEditing() {
    setDraftTitle(session.title)
    setEditingTitle(true)
    setTimeout(() => titleInputRef.current?.select(), 0)
  }

  async function commitTitle() {
    const trimmed = draftTitle.trim()
    if (!trimmed || trimmed === session.title) {
      setDraftTitle(session.title)
      setEditingTitle(false)
      return
    }
    setEditingTitle(false)
    onTitleChange(session.id, trimmed)
    await fetch(`${API}/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    }).catch(() => onTitleChange(session.id, session.title))
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') titleInputRef.current?.blur()
    if (e.key === 'Escape') { setDraftTitle(session.title); setEditingTitle(false) }
  }

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

  function handleWordHover(e: React.MouseEvent, assocs: Association[]) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const below = rect.top < 120
    setTooltip({ assocs, x: rect.left, y: below ? rect.bottom : rect.top, below })
  }

  function renderWord(word: string, key: number | string) {
    const lookup = word.toLowerCase().replace(/[^a-z']/g, '')
    const assocs = assocMap.get(lookup)
    if (!assocs?.length) return <span key={key}>{word}</span>
    return (
      <span
        key={key}
        className="transcript-word--associated"
        onMouseEnter={e => handleWordHover(e, assocs)}
        onMouseLeave={() => setTooltip(null)}
      >
        {word}
      </span>
    )
  }

  const timedWords: TimedWord[] | null = session.transcript_words
    ? JSON.parse(session.transcript_words)
    : null
  const lines = timedWords ? detectLines(timedWords, inferThreshold(timedWords)) : null

  return (
    <div className="session-viewer">
      {editingTitle ? (
        <input
          ref={titleInputRef}
          className="session-viewer-title session-viewer-title--input"
          value={draftTitle}
          onChange={e => setDraftTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={handleTitleKeyDown}
        />
      ) : (
        <h2 className="session-viewer-title session-viewer-title--editable" onClick={startEditing}>
          {session.title}
        </h2>
      )}
      <div className="session-meta">
        {formatDate(session.started_at)} &nbsp;·&nbsp; {duration(session.started_at, session.ended_at)}
      </div>

      {lines ? (
        <div className="session-transcript session-transcript--lyrics">
          {lines.map((line, li) => (
            <p key={li} className="transcript-line">
              {line.map((word, wi) => (
                <>{renderWord(word, wi)}{wi < line.length - 1 ? ' ' : ''}</>
              ))}
            </p>
          ))}
        </div>
      ) : (
        <div className="session-transcript">
          {session.transcript.trim().split(/(\s+)/).map((token, i) => {
            if (/^\s+$/.test(token)) return token
            return renderWord(token, i)
          })}
        </div>
      )}

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
