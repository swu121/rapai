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

const ASSOC_BLACKLIST = new Set([
  'i', 'me', 'my', 'mine', 'myself',
  'we', 'us', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'they', 'them', 'their', 'theirs', 'themselves',
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'and', 'but', 'or', 'nor', 'so', 'yet', 'for',
  'in', 'on', 'at', 'by', 'to', 'of', 'up', 'as', 'is', 'be',
  'do', 'did', 'does', 'done',
  'have', 'has', 'had',
  'was', 'were', 'are', 'am',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
  'not', 'no', 'yes', 'oh', 'ah',
])

function isAssocBlacklisted(word: string): boolean {
  const lower = word.toLowerCase()
  if (lower.includes("'")) return true
  if (lower.length <= 1) return true
  return ASSOC_BLACKLIST.has(lower)
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

function formatAudioTime(secs: number) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function SessionViewer({ session, onTitleChange }: Props) {
  const [localWords, setLocalWords] = useState<TimedWord[]>(
    () => session.transcript_words ? JSON.parse(session.transcript_words) : []
  )
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [draftWord, setDraftWord] = useState('')

  const [editingRange, setEditingRange] = useState<{ start: number; end: number } | null>(null)
  const [rangeDraft, setRangeDraft] = useState('')
  const rangeEscapeRef = useRef(false)
  const transcriptRef = useRef<HTMLDivElement>(null)

  const [assocMap, setAssocMap] = useState<Map<string, Association[]>>(new Map())
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [isProcessing, setIsProcessing] = useState(session.associations_status === 'pending')

  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(session.title)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)

  useEffect(() => {
    setLocalWords(session.transcript_words ? JSON.parse(session.transcript_words) : [])
    setEditingIdx(null)
    setEditingRange(null)
    setDraftTitle(session.title)
    setEditingTitle(false)
    setIsProcessing(session.associations_status === 'pending')
    setIsPlaying(false)
    setCurrentTime(0)
    setAudioDuration(0)
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
          if (isAssocBlacklisted(row.used_word)) continue
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
              if (isAssocBlacklisted(row.used_word)) continue
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
    setEditingIdx(null)

    if (!trimmed) {
      // Delete the word
      const prevWords = localWords
      const prevAssocMap = assocMap
      const deletedKey = normalizeKey(original)

      setLocalWords(prev => prev.filter((_, i) => i !== idx))
      if (assocMap.has(deletedKey)) {
        setAssocMap(prev => { const next = new Map(prev); next.delete(deletedKey); return next })
      }

      await fetch(`${API}/sessions/${session.id}/words/${idx}`, { method: 'DELETE' })
        .catch(() => { setLocalWords(prevWords); setAssocMap(prevAssocMap) })
      return
    }

    if (trimmed.toLowerCase() === original.toLowerCase()) return

    const prevWords = localWords
    const prevAssocMap = assocMap

    setLocalWords(prev => prev.map((w, i) => i === idx ? { ...w, word: trimmed } : w))

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

  // ── Range editing ──────────────────────────────────────────────────────────

  function handleTranscriptMouseUp() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !transcriptRef.current) return

    const spans = transcriptRef.current.querySelectorAll<HTMLElement>('[data-word-idx]')
    const indices: number[] = []
    for (const span of spans) {
      if (sel.containsNode(span, true)) indices.push(Number(span.dataset.wordIdx))
    }
    if (indices.length < 2) return

    const start = Math.min(...indices)
    const end = Math.max(...indices)
    sel.removeAllRanges()
    setEditingIdx(null)
    setEditingRange({ start, end })
    setRangeDraft(localWords.slice(start, end + 1).map(w => w.word).join(' '))
  }

  async function commitRange() {
    if (rangeEscapeRef.current) {
      rangeEscapeRef.current = false
      setEditingRange(null)
      return
    }
    if (!editingRange) return
    const { start, end } = editingRange
    const trimmed = rangeDraft.trim()
    setEditingRange(null)

    const originalText = localWords.slice(start, end + 1).map(w => w.word).join(' ')
    if (trimmed === originalText) return

    const prevWords = localWords
    const prevAssocMap = assocMap
    const replacedKeys = localWords.slice(start, end + 1).map(w => normalizeKey(w.word)).filter(Boolean)

    if (!trimmed) {
      setLocalWords(prev => prev.filter((_, i) => i < start || i > end))
    } else {
      const rangeStartTime = localWords[start].start
      const rangeEndTime = localWords[end].end
      const parts = trimmed.split(/\s+/)
      const interval = parts.length > 1 ? (rangeEndTime - rangeStartTime) / parts.length : 0
      const newWordObjs: TimedWord[] = parts.map((word, i) => ({
        word,
        start: rangeStartTime + i * interval,
        end: i < parts.length - 1 ? rangeStartTime + (i + 1) * interval : rangeEndTime,
      }))
      setLocalWords(prev => [...prev.slice(0, start), ...newWordObjs, ...prev.slice(end + 1)])
    }

    setAssocMap(prev => {
      const next = new Map(prev)
      for (const k of replacedKeys) next.delete(k)
      return next
    })

    await fetch(`${API}/sessions/${session.id}/word-range`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, end, replacement: trimmed }),
    }).catch(() => { setLocalWords(prevWords); setAssocMap(prevAssocMap) })
  }

  function handleRangeKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
    if (e.key === 'Escape') {
      rangeEscapeRef.current = true
      ;(e.currentTarget as HTMLInputElement).blur()
    }
  }

  // ── Tooltip ────────────────────────────────────────────────────────────────

  function handleWordHover(e: React.MouseEvent, assocs: Association[]) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const below = rect.top < 120
    setTooltip({ assocs, x: rect.left, y: below ? rect.bottom : rect.top, below })
  }

  // ── Word renderer ──────────────────────────────────────────────────────────

  function renderWord(word: string, idx: number) {
    if (editingRange && idx === editingRange.start) {
      return (
        <input
          key={`range-${idx}`}
          autoFocus
          className="transcript-word--input transcript-word--range-input"
          value={rangeDraft}
          onChange={e => setRangeDraft(e.target.value)}
          onBlur={commitRange}
          onKeyDown={handleRangeKeyDown}
        />
      )
    }

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
        data-word-idx={idx}
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

      {session.audio_url && (
        <div className="audio-player">
          <audio
            ref={audioRef}
            src={`${API}${session.audio_url}`}
            onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
            onLoadedMetadata={() => setAudioDuration(audioRef.current?.duration ?? 0)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => { setIsPlaying(false); setCurrentTime(0) }}
          />
          <button
            className="audio-player-btn"
            onClick={() => isPlaying ? audioRef.current?.pause() : audioRef.current?.play()}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <input
            className="audio-player-scrubber"
            type="range"
            min={0}
            max={audioDuration || 1}
            step={0.01}
            value={currentTime}
            onChange={(e) => {
              const t = parseFloat(e.target.value)
              setCurrentTime(t)
              if (audioRef.current) audioRef.current.currentTime = t
            }}
          />
          <span className="audio-player-time">
            {formatAudioTime(currentTime)} / {formatAudioTime(audioDuration)}
          </span>
        </div>
      )}

      {isProcessing && (
        <div className="associations-processing">
          <span className="associations-processing-spinner" />
          Calculating word associations…
        </div>
      )}

      {lines ? (
        <div
          ref={transcriptRef}
          className="session-transcript session-transcript--lyrics"
          onMouseUp={handleTranscriptMouseUp}
        >
          {lines.map((line, li) => {
            const visible = line.filter(
              wordIdx => !(editingRange && wordIdx > editingRange.start && wordIdx <= editingRange.end)
            )
            return (
              <p key={li} className="transcript-line">
                {visible.map((wordIdx, wi) => (
                  <Fragment key={wordIdx}>
                    {renderWord(localWords[wordIdx].word, wordIdx)}
                    {wi < visible.length - 1 ? ' ' : ''}
                  </Fragment>
                ))}
              </p>
            )
          })}
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
