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
  used_word_times: string | null
}

type TooltipState = {
  assocs: Association[]
  wordStartMs: number
  x: number
  y: number
  below: boolean
}

type ContextMenuState = {
  x: number
  y: number
  wordIndices: number[]
  hasAssocs: boolean
  phase: 'main' | 'pick'
  suggestedWords: string[]
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
  // swear words
  'fuck', 'fucking', 'fucked', 'fucker', 'fucks',
  'shit', 'shitting', 'shitted', 'shits',
  'bitch', 'bitches', 'bitching',
  'ass', 'asses', 'asshole', 'assholes',
  'damn', 'damned', 'dammit',
  'hell', 'hella',
  'crap', 'crappy',
  'bastard', 'bastards',
  'dick', 'dicks',
  'cock', 'cocks',
  'pussy', 'pussies',
  'nigga', 'niggas', 'nigger', 'niggers',
  'hoe', 'hoes',
  'whore', 'whores',
  'slut', 'sluts',
  'piss', 'pissed',
  'cunt', 'cunts',
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
  const [pendingRange, setPendingRange] = useState<{ start: number; end: number } | null>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  const [assocMap, setAssocMap] = useState<Map<number, Association[]>>(new Map())
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [isProcessing, setIsProcessing] = useState(session.associations_status === 'pending')

  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(session.title)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)

  function seekToWord(startMs: number) {
    if (!audioRef.current) return
    audioRef.current.currentTime = startMs / 1000
    if (!isPlaying) audioRef.current.play()
  }

  useEffect(() => {
    setLocalWords(session.transcript_words ? JSON.parse(session.transcript_words) : [])
    setEditingIdx(null)
    setEditingRange(null)
    setPendingRange(null)
    setDraftTitle(session.title)
    setEditingTitle(false)
    setIsProcessing(session.associations_status === 'pending')
    setIsPlaying(false)
    setCurrentTime(0)
    setAudioDuration(0)
    setContextMenu(null)
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
        const map = new Map<number, Association[]>()
        for (const row of rows) {
          if (isAssocBlacklisted(row.used_word)) continue
          if (!row.used_word_times) continue
          const times: number[] = JSON.parse(row.used_word_times)
          for (const t of times) {
            if (!map.has(t)) map.set(t, [])
            map.get(t)!.push(row)
          }
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
            const map = new Map<number, Association[]>()
            for (const row of rows) {
              if (isAssocBlacklisted(row.used_word)) continue
              if (!row.used_word_times) continue
              const times: number[] = JSON.parse(row.used_word_times)
              for (const t of times) {
                if (!map.has(t)) map.set(t, [])
                map.get(t)!.push(row)
              }
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
      const deletedTime = localWords[idx].start

      setLocalWords(prev => prev.filter((_, i) => i !== idx))
      setAssocMap(prev => { const next = new Map(prev); next.delete(deletedTime); return next })

      await fetch(`${API}/sessions/${session.id}/words/${idx}`, { method: 'DELETE' })
        .catch(() => { setLocalWords(prevWords); setAssocMap(prevAssocMap) })
      return
    }

    if (trimmed.toLowerCase() === original.toLowerCase()) return

    const prevWords = localWords

    setLocalWords(prev => prev.map((w, i) => i === idx ? { ...w, word: trimmed } : w))

    await fetch(`${API}/sessions/${session.id}/words/${idx}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: trimmed }),
    }).catch(() => {
      setLocalWords(prevWords)
    })
  }

  function handleWordKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
    if (e.key === 'Escape') setEditingIdx(null)
  }

  // ── Range editing ──────────────────────────────────────────────────────────

  function handleTranscriptMouseUp(e: React.MouseEvent) {
    if (e.button !== 0) return
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
    // Keep browser highlight visible; don't enter edit mode yet.
    // Clicking into the selection will enter edit mode; right-click shows context menu.
    setEditingIdx(null)
    setEditingRange(null)
    setPendingRange({ start, end })
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
    const replacedTimes = localWords.slice(start, end + 1).map(w => w.start)

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
      for (const t of replacedTimes) next.delete(t)
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

  function handleWordHover(e: React.MouseEvent, assocs: Association[], wordStartMs: number) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const below = rect.top < 120
    setTooltip({ assocs, wordStartMs, x: rect.left, y: below ? rect.bottom : rect.top, below })
  }

  // ── Context menu ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!contextMenu) return
    function onMouseDown(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setContextMenu(null)
    }
    function onScroll() { setContextMenu(null) }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [contextMenu])

  function handleWordContextMenu(e: React.MouseEvent, idx: number) {
    e.preventDefault()
    e.stopPropagation()
    setTooltip(null)

    let targetIndices: number[]
    if (pendingRange && idx >= pendingRange.start && idx <= pendingRange.end) {
      targetIndices = Array.from({ length: pendingRange.end - pendingRange.start + 1 }, (_, i) => pendingRange.start + i)
    } else {
      // Right-click on a word outside any pending range — clear it and use just this word
      setPendingRange(null)
      window.getSelection()?.removeAllRanges()
      targetIndices = [idx]
    }

    const hasAssocs = targetIndices.some(i => (assocMap.get(localWords[i].start)?.length ?? 0) > 0)
    const sessionSuggestedWords = session.suggested_words
      ? [...new Set((JSON.parse(session.suggested_words) as Array<{ word: string }>).map(s => s.word))]
      : []

    if (!hasAssocs && sessionSuggestedWords.length === 0) return

    setPendingRange(null)
    window.getSelection()?.removeAllRanges()

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      wordIndices: targetIndices,
      hasAssocs,
      phase: 'main',
      suggestedWords: sessionSuggestedWords,
    })
  }

  async function addAssociation(suggestedWord: string) {
    if (!contextMenu) return
    const indices = contextMenu.wordIndices
    setContextMenu(null)

    setAssocMap(prev => {
      const next = new Map(prev)
      for (const i of indices) {
        const w = localWords[i]
        next.set(w.start, [{
          used_word: w.word.toLowerCase(),
          suggested_word: suggestedWord,
          session_id: session.id,
          session_title: session.title,
          session_started_at: session.started_at,
          count: 1,
          used_word_times: JSON.stringify([w.start]),
        }])
      }
      return next
    })

    for (const i of indices) {
      const w = localWords[i]
      await fetch(`${API}/sessions/${session.id}/associations/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggested_word: suggestedWord, used_word: w.word.toLowerCase(), time_ms: w.start }),
      }).catch(() => {})
    }
  }

  async function deleteAssociation() {
    if (!contextMenu) return
    const indices = contextMenu.wordIndices
    setContextMenu(null)

    setAssocMap(prev => {
      const next = new Map(prev)
      for (const i of indices) next.delete(localWords[i].start)
      return next
    })

    const entries = indices.map(i => ({ used_word: localWords[i].word.toLowerCase(), time_ms: localWords[i].start }))
    await fetch(`${API}/sessions/${session.id}/associations/manual`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    }).catch(() => {})
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

    const assocs = assocMap.get(localWords[idx].start)
    const isActive = idx === activeWordIdx
    const classes = [
      'transcript-word--editable',
      assocs?.length ? 'transcript-word--associated' : '',
      session.audio_url ? 'transcript-word--seekable' : '',
      isActive ? 'transcript-word--active' : '',
    ].filter(Boolean).join(' ')

    function enterEditMode() {
      window.getSelection()?.removeAllRanges()
      setPendingRange(null)
      setEditingIdx(idx)
      setDraftWord(word)
    }

    function enterRangeEditMode() {
      window.getSelection()?.removeAllRanges()
      setPendingRange(null)
      setEditingIdx(null)
      setEditingRange(pendingRange)
      setRangeDraft(localWords.slice(pendingRange!.start, pendingRange!.end + 1).map(w => w.word).join(' '))
    }

    return (
      <span
        key={idx}
        data-word-idx={idx}
        className={classes}
        onClick={() => {
          if (pendingRange && idx >= pendingRange.start && idx <= pendingRange.end) {
            enterRangeEditMode()
          } else if (session.audio_url) {
            setPendingRange(null)
            window.getSelection()?.removeAllRanges()
            seekToWord(localWords[idx].start)
          } else {
            enterEditMode()
          }
        }}
        onDoubleClick={session.audio_url ? () => {
          if (pendingRange && idx >= pendingRange.start && idx <= pendingRange.end) return
          enterEditMode()
        } : undefined}
        onContextMenu={e => handleWordContextMenu(e, idx)}
        onMouseEnter={assocs?.length ? e => handleWordHover(e, assocs, localWords[idx].start) : undefined}
        onMouseLeave={assocs?.length ? () => setTooltip(null) : undefined}
      >
        {word}
      </span>
    )
  }

  // ── Derived layout ─────────────────────────────────────────────────────────

  const activeWordIdx = session.audio_url && currentTime > 0
    ? localWords.findIndex(w => currentTime * 1000 >= w.start && currentTime * 1000 <= w.end)
    : -1

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
          onClick={e => { if (e.target === e.currentTarget) { setPendingRange(null) } }}
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
          {session.transcript.trim().split(/(\s+)/).map((token, i) => (
            /^\s+$/.test(token) ? token : <span key={i}>{token}</span>
          ))}
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
            </div>
          ))}
          <div className="word-tooltip-time">
            {new Date(tooltip.wordStartMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={e => e.preventDefault()}
        >
          {contextMenu.phase === 'main' ? (
            contextMenu.hasAssocs ? (
              <button className="context-menu-item context-menu-item--danger" onClick={deleteAssociation}>
                Remove association{contextMenu.wordIndices.length > 1 ? 's' : ''}
              </button>
            ) : (
              <button
                className="context-menu-item"
                onClick={() => setContextMenu(prev => prev ? { ...prev, phase: 'pick' } : null)}
              >
                Associate with…
              </button>
            )
          ) : (
            <>
              <button className="context-menu-back" onClick={() => setContextMenu(prev => prev ? { ...prev, phase: 'main' } : null)}>
                ← Back
              </button>
              <div className="context-menu-label">Choose word prompt</div>
              <div className="context-menu-words">
                {contextMenu.suggestedWords.map(word => (
                  <button key={word} className="context-menu-item" onClick={() => addAssociation(word)}>
                    {word}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
