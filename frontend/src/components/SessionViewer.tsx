import { useState, useEffect, useRef, Fragment } from 'react'
import type { StoredSession } from '../App'

const API = 'http://localhost:3001'

type TimedWord = { word: string; start: number; end: number }

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

// Returns array of lines, each line is an array of indices into the words array
function detectLines(words: TimedWord[], threshold: number): number[][] {
  if (!words.length) return []
  const lines: number[][] = []
  let current: number[] = [0]
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end
    if (gap >= threshold) {
      lines.push(current)
      current = [i]
    } else {
      current.push(i)
    }
  }
  if (current.length) lines.push(current)
  return lines
}

function normalizeKey(word: string) {
  return word.toLowerCase().replace(/[^a-z']/g, '')
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
  const [localWords, setLocalWords] = useState<TimedWord[]>(
    () => session.transcript_words ? JSON.parse(session.transcript_words) : []
  )
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [draftWord, setDraftWord] = useState('')

  const [assocMap, setAssocMap] = useState<Map<string, Association[]>>(new Map())
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [isProcessing, setIsProcessing] = useState(session.associations_status === 'pending')

  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(session.title)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLocalWords(session.transcript_words ? JSON.parse(session.transcript_words) : [])
    setEditingIdx(null)
    setDraftTitle(session.title)
    setEditingTitle(false)
    setIsProcessing(session.associations_status === 'pending')
  }, [session.id])

  useEffect(() => {
    setDraftTitle(session.title)
  }, [session.title])

  useEffect(() => {
    setAssocMap(new Map())
    if (session.associations_status === 'pending') return
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

  useEffect(() => {
    if (!isProcessing) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/sessions/${session.id}`)
        const data: { associations_status?: string } = await res.json()
        if (data.associations_status !== 'pending') {
          setIsProcessing(false)
          if (data.associations_status === 'done') {
            const assocRes = await fetch(`${API}/sessions/${session.id}/associations`)
            const rows: Association[] = await assocRes.json()
            const map = new Map<string, Association[]>()
            for (const row of rows) {
              const key = row.used_word.toLowerCase()
              if (!map.has(key)) map.set(key, [])
              map.get(key)!.push(row)
            }
            setAssocMap(map)
          }
        }
      } catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(interval)
  }, [isProcessing, session.id])

  // ── Title editing ──────────────────────────────────────────────────────────

  function startEditingTitle() {
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

  // ── Word editing ───────────────────────────────────────────────────────────

  async function commitWord(idx: number) {
    const trimmed = draftWord.trim()
    const original = localWords[idx].word
    if (!trimmed || trimmed.toLowerCase() === original.toLowerCase()) {
      setEditingIdx(null)
      return
    }

    const prevWords = localWords
    const prevAssocMap = assocMap

    // Optimistic: update word in local state
    setLocalWords(prev => prev.map((w, i) => i === idx ? { ...w, word: trimmed } : w))
    setEditingIdx(null)

    // Optimistic: migrate assocMap from old key → new key
    const oldKey = normalizeKey(original)
    const newKey = normalizeKey(trimmed)
    if (oldKey !== newKey && assocMap.has(oldKey)) {
      setAssocMap(prev => {
        const next = new Map(prev)
        const moved = next.get(oldKey)!
        next.delete(oldKey)
        const existing = next.get(newKey) ?? []
        next.set(newKey, [...existing, ...moved])
        return next
      })
    }

    await fetch(`${API}/sessions/${session.id}/words/${idx}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: trimmed }),
    }).catch(() => {
      setLocalWords(prevWords)
      setAssocMap(prevAssocMap)
    })
  }

  function handleWordKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
    if (e.key === 'Escape') setEditingIdx(null)
  }

  // ── Tooltip ────────────────────────────────────────────────────────────────

  function handleWordHover(e: React.MouseEvent, assocs: Association[]) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const below = rect.top < 120
    setTooltip({ assocs, x: rect.left, y: below ? rect.bottom : rect.top, below })
  }

  // ── Word renderer ──────────────────────────────────────────────────────────

  function renderWord(word: string, idx: number) {
    if (editingIdx === idx) {
      return (
        <input
          key={idx}
          autoFocus
          className="transcript-word--input"
          value={draftWord}
          onChange={e => setDraftWord(e.target.value)}
          onBlur={() => commitWord(idx)}
          onKeyDown={handleWordKeyDown}
          style={{ width: `${Math.max(draftWord.length, 2)}ch` }}
        />
      )
    }

    const key = normalizeKey(word)
    const assocs = assocMap.get(key)
    const classes = [
      'transcript-word--editable',
      assocs?.length ? 'transcript-word--associated' : '',
    ].filter(Boolean).join(' ')

    return (
      <span
        key={idx}
        className={classes}
        onClick={() => { setEditingIdx(idx); setDraftWord(word) }}
        onMouseEnter={assocs?.length ? e => handleWordHover(e, assocs) : undefined}
        onMouseLeave={assocs?.length ? () => setTooltip(null) : undefined}
      >
        {word}
      </span>
    )
  }

  // ── Derived layout ─────────────────────────────────────────────────────────

  const lines = localWords.length
    ? detectLines(localWords, inferThreshold(localWords))
    : null

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
        <h2 className="session-viewer-title session-viewer-title--editable" onClick={startEditingTitle}>
          {session.title}
        </h2>
      )}
      <div className="session-meta">
        {formatDate(session.started_at)} &nbsp;·&nbsp; {duration(session.started_at, session.ended_at)}
      </div>

      {isProcessing && (
        <div className="associations-processing">
          <span className="associations-processing-spinner" />
          Calculating word associations…
        </div>
      )}

      {lines ? (
        <div className="session-transcript session-transcript--lyrics">
          {lines.map((line, li) => (
            <p key={li} className="transcript-line">
              {line.map((wordIdx, wi) => (
                <Fragment key={wordIdx}>
                  {renderWord(localWords[wordIdx].word, wordIdx)}
                  {wi < line.length - 1 ? ' ' : ''}
                </Fragment>
              ))}
            </p>
          ))}
        </div>
      ) : (
        <div className="session-transcript">
          {session.transcript.trim().split(/(\s+)/).map((token, i) => {
            if (/^\s+$/.test(token)) return token
            const assocs = assocMap.get(normalizeKey(token))
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
