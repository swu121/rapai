import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import staticPlugin from '@fastify/static'
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { mkdirSync, createWriteStream } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { dictionary as cmuDict } from 'cmu-pronouncing-dictionary'

// --- Phoneme helpers ---

function getPhonemes(word: string): string[] | null {
  const entry = cmuDict[word.toLowerCase()]
  return entry ? entry.split(' ') : null
}

function getRhymeTail(phonemes: string[]): string[] {
  // Tail = last stressed vowel (ends in 1 or 2) through end of word
  for (let i = phonemes.length - 1; i >= 0; i--) {
    if (/[12]$/.test(phonemes[i])) return phonemes.slice(i)
  }
  return []
}

function stripStress(p: string): string {
  return p.replace(/[012]$/, '')
}

const WORD_BLACKLIST = new Set([
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
  'not', 'no', 'yes', 'oh', 'ah', 'hey',
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

function isBlacklisted(word: string): boolean {
  const lower = word.toLowerCase()
  if (lower.includes("'")) return true
  if (lower.length <= 1) return true
  return WORD_BLACKLIST.has(lower)
}

type RhymeType = 'exact' | 'slant' | 'none'

function getRhymeType(tailA: string[], tailB: string[]): RhymeType {
  if (!tailA.length || !tailB.length) return 'none'
  if (tailA.map(stripStress).join(' ') === tailB.map(stripStress).join(' ')) return 'exact'
  if (stripStress(tailA[0]) === stripStress(tailB[0])) return 'slant'
  return 'none'
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = join(__dirname, '../../uploads')
mkdirSync(UPLOADS_DIR, { recursive: true })

const db = new Database('./sessions.db')

db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    transcript TEXT NOT NULL,
    title      TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at   TEXT NOT NULL
  )
`)

for (const stmt of [
  'ALTER TABLE sessions ADD COLUMN transcript_words TEXT',
  'ALTER TABLE sessions ADD COLUMN suggested_words TEXT',
]) {
  try { db.exec(stmt) } catch { /* column already exists */ }
}

try {
  db.exec("ALTER TABLE sessions ADD COLUMN associations_status TEXT NOT NULL DEFAULT 'pending'")
} catch { /* column already exists */ }

try { db.exec('ALTER TABLE sessions ADD COLUMN audio_url TEXT') } catch { /* column already exists */ }

// Any sessions still 'pending' on startup had their jobs killed by a restart — mark them done
db.exec("UPDATE sessions SET associations_status = 'done' WHERE associations_status = 'pending'")

db.exec(`
  CREATE TABLE IF NOT EXISTS word_associations (
    suggested_word TEXT NOT NULL,
    used_word      TEXT NOT NULL,
    session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    count          INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (suggested_word, used_word, session_id)
  )
`)

try {
  db.exec('ALTER TABLE word_associations ADD COLUMN used_word_times TEXT')
} catch { /* column already exists */ }

interface PostSessionBody {
  transcript: string
  started_at: string
  ended_at: string
  transcript_words?: Array<{ word: string; start: number; end: number }>
  suggested_words?: Array<{ word: string; shownAt: number }>
}

interface SessionParams {
  id: string
}

interface WordParams {
  id: string
  index: string
}

async function runAssociationJob(
  sessionId: string,
  transcriptWords: Array<{ word: string; start: number; end: number }>,
  suggestedWords: Array<{ word: string; shownAt: number }>
): Promise<void> {
  const log = (...args: unknown[]) => console.log(`[assoc:${sessionId.slice(0, 8)}]`, ...args)
  const WINDOW_TAIL_MS = 3000 // extra ms after next word appears to still credit the previous prompt

  const setStatus = (status: 'done' | 'failed') =>
    db.prepare("UPDATE sessions SET associations_status = ? WHERE id = ?").run(status, sessionId)

  log(`starting — transcriptWords=${transcriptWords.length} suggestedWords=${suggestedWords.length}`)

  if (!transcriptWords.length || !suggestedWords.length) {
    log('skipping — empty input')
    setStatus('done')
    return
  }

  try {

  const uniqueWords = [...new Set(suggestedWords.map(s => s.word))]
  log(`unique suggested words (${uniqueWords.length}):`, uniqueWords)

  // Look up CMU phonemes for each suggested word upfront
  const tailMap = new Map<string, string[]>()
  for (const word of uniqueWords) {
    const phonemes = getPhonemes(word)
    const tail = phonemes ? getRhymeTail(phonemes) : []
    tailMap.set(word, tail)
    log(`phonemes for "${word}": [${phonemes?.join(' ') ?? 'not in CMU dict'}] → tail: [${tail.join(' ')}]`)
  }

  const sortedSuggested = [...suggestedWords].sort((a, b) => a.shownAt - b.shownAt)
  const sortedTranscript = [...transcriptWords].sort((a, b) => a.start - b.start)

  log(`transcript time range: ${sortedTranscript[0]?.start} → ${sortedTranscript.at(-1)?.end}`)
  log(`suggested word windows:`, sortedSuggested.map((s, i) => ({
    word: s.word,
    from: s.shownAt,
    to: sortedSuggested[i + 1]?.shownAt ?? 'end',
  })))

  // Collect all matches across windows: key = "suggested|used", value = set of start_ms timestamps
  const aggMap = new Map<string, Set<number>>()

  for (let i = 0; i < sortedSuggested.length; i++) {
    const { word: suggestedWord, shownAt } = sortedSuggested[i]
    const nextShownAt = sortedSuggested[i + 1]?.shownAt ?? Infinity
    const windowEnd = nextShownAt === Infinity ? Infinity : nextShownAt + WINDOW_TAIL_MS

    const suggestedTail = tailMap.get(suggestedWord) ?? []
    if (!suggestedTail.length) {
      log(`"${suggestedWord}" — no CMU tail, skipping window`)
      continue
    }

    const wordsInWindow = sortedTranscript.filter(tw => tw.start >= shownAt && tw.start < windowEnd)
    log(`"${suggestedWord}" window [${shownAt}–${windowEnd === Infinity ? 'end' : `${nextShownAt}+3s`}]: ${wordsInWindow.length} transcript words in range`)

    for (const tw of wordsInWindow) {
      const w = tw.word.toLowerCase()
      if (isBlacklisted(w)) { log(`  skip  "${w}" — blacklisted`); continue }
      if (w === suggestedWord.toLowerCase()) { log(`  skip  "${w}" — same as prompt`); continue }

      const twPhonemes = getPhonemes(w)
      if (!twPhonemes) { log(`  skip  "${w}" — not in CMU dict`); continue }

      const twTail = getRhymeTail(twPhonemes)
      const rhymeType = getRhymeType(suggestedTail, twTail)

      if (rhymeType === 'exact') {
        log(`  EXACT "${w}" [${twTail.join(' ')}] ✓ matches "${suggestedWord}" [${suggestedTail.join(' ')}]`)
      } else if (rhymeType === 'slant') {
        log(`  SLANT "${w}" [${twTail.join(' ')}] ✓ nucleus ${stripStress(twTail[0])} matches "${suggestedWord}" [${suggestedTail.join(' ')}]`)
      } else {
        log(`  miss  "${w}" [${twTail.join(' ')}] — nucleus ${stripStress(twTail[0] ?? '')} ≠ ${stripStress(suggestedTail[0])}`)
        continue
      }

      const key = `${suggestedWord.toLowerCase()}|${w}`
      if (!aggMap.has(key)) aggMap.set(key, new Set())
      aggMap.get(key)!.add(tw.start)
    }
  }

  const insert = db.prepare(`
    INSERT OR REPLACE INTO word_associations (suggested_word, used_word, session_id, count, used_word_times)
    VALUES (?, ?, ?, ?, ?)
  `)
  const insertAll = db.transaction(() => {
    for (const [key, times] of aggMap) {
      const bar = key.indexOf('|')
      const suggested = key.slice(0, bar)
      const used = key.slice(bar + 1)
      insert.run(suggested, used, sessionId, times.size, JSON.stringify([...times]))
    }
  })
  insertAll()

  log(`done — ${aggMap.size} association pairs saved`)
  setStatus('done')
  } catch (err) {
    log('failed:', err)
    setStatus('failed')
    throw err
  }
}

const app = Fastify({ logger: true })
await app.register(cors, { origin: /^http:\/\/localhost:\d+$/ })
await app.register(multipart)
await app.register(staticPlugin, { root: UPLOADS_DIR, prefix: '/uploads/' })

app.get('/health', async () => ({ status: 'ok' }))

app.get('/sessions', async () => {
  return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all()
})

app.get<{ Params: SessionParams }>('/sessions/:id', async (request, reply) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(request.params.id)
  if (!session) return reply.code(404).send({ error: 'not found' })
  return session
})

app.post<{ Body: PostSessionBody }>('/sessions', async (request, reply) => {
  const { transcript, started_at, ended_at, transcript_words, suggested_words } = request.body
  const id = randomUUID()
  const title = transcript.trim().split(/\s+/).slice(0, 6).join(' ') || 'Untitled'

  db.prepare(
    'INSERT INTO sessions (id, transcript, title, started_at, ended_at, transcript_words, suggested_words) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id, transcript, title, started_at, ended_at,
    transcript_words ? JSON.stringify(transcript_words) : null,
    suggested_words ? JSON.stringify(suggested_words) : null,
  )

  reply.code(201).send({ id, transcript, title, started_at, ended_at, associations_status: 'pending' })

  runAssociationJob(id, transcript_words ?? [], suggested_words ?? []).catch(err =>
    app.log.error({ err }, 'association job failed')
  )
})

app.patch<{ Params: WordParams; Body: { word: string } }>('/sessions/:id/words/:index', async (request, reply) => {
  const { id, index: indexStr } = request.params
  const newWord = request.body.word?.trim()
  if (!newWord) return reply.code(400).send({ error: 'word required' })

  const session = db.prepare('SELECT transcript_words FROM sessions WHERE id = ?').get(id) as
    | { transcript_words: string | null }
    | undefined
  if (!session) return reply.code(404).send({ error: 'not found' })
  if (!session.transcript_words) return reply.code(400).send({ error: 'no word-level data for this session' })

  const words: Array<{ word: string; start: number; end: number }> = JSON.parse(session.transcript_words)
  const idx = parseInt(indexStr, 10)
  if (isNaN(idx) || idx < 0 || idx >= words.length) return reply.code(400).send({ error: 'index out of range' })

  const oldWord = words[idx].word.toLowerCase()
  const newWordLower = newWord.toLowerCase()
  words[idx] = { ...words[idx], word: newWord }
  const newTranscript = words.map(w => w.word).join(' ')

  const hasAssocs = oldWord !== newWordLower &&
    db.prepare('SELECT 1 FROM word_associations WHERE used_word = ? AND session_id = ? LIMIT 1')
      .get(oldWord, id) != null

  db.transaction(() => {
    db.prepare('UPDATE sessions SET transcript = ?, transcript_words = ? WHERE id = ?')
      .run(newTranscript, JSON.stringify(words), id)

    if (hasAssocs) {
      db.prepare(`
        INSERT INTO word_associations (suggested_word, used_word, session_id, count)
        SELECT suggested_word, ?, session_id, count
        FROM word_associations WHERE used_word = ? AND session_id = ?
        ON CONFLICT(suggested_word, used_word, session_id) DO UPDATE SET count = count + excluded.count
      `).run(newWordLower, oldWord, id)
      db.prepare('DELETE FROM word_associations WHERE used_word = ? AND session_id = ?')
        .run(oldWord, id)
    }
  })()

  return { transcript: newTranscript, transcript_words: JSON.stringify(words), associationsMoved: hasAssocs }
})

app.delete<{ Params: WordParams }>('/sessions/:id/words/:index', async (request, reply) => {
  const { id, index: indexStr } = request.params

  const session = db.prepare('SELECT transcript_words FROM sessions WHERE id = ?').get(id) as
    | { transcript_words: string | null }
    | undefined
  if (!session) return reply.code(404).send({ error: 'not found' })
  if (!session.transcript_words) return reply.code(400).send({ error: 'no word-level data for this session' })

  const words: Array<{ word: string; start: number; end: number }> = JSON.parse(session.transcript_words)
  const idx = parseInt(indexStr, 10)
  if (isNaN(idx) || idx < 0 || idx >= words.length) return reply.code(400).send({ error: 'index out of range' })

  const deletedKey = words[idx].word.toLowerCase().replace(/[^a-z']/g, '')
  words.splice(idx, 1)
  const newTranscript = words.map(w => w.word).join(' ')

  db.transaction(() => {
    db.prepare('UPDATE sessions SET transcript = ?, transcript_words = ? WHERE id = ?')
      .run(newTranscript, JSON.stringify(words), id)
    if (deletedKey) {
      db.prepare('DELETE FROM word_associations WHERE used_word = ? AND session_id = ?')
        .run(deletedKey, id)
    }
  })()

  return { transcript: newTranscript, transcript_words: JSON.stringify(words) }
})

app.patch<{ Params: SessionParams; Body: { start: number; end: number; replacement: string } }>('/sessions/:id/word-range', async (request, reply) => {
  const { id } = request.params
  const { start, end, replacement } = request.body
  const trimmed = (replacement ?? '').trim()

  const session = db.prepare('SELECT transcript_words FROM sessions WHERE id = ?').get(id) as
    | { transcript_words: string | null }
    | undefined
  if (!session) return reply.code(404).send({ error: 'not found' })
  if (!session.transcript_words) return reply.code(400).send({ error: 'no word-level data for this session' })

  const words: Array<{ word: string; start: number; end: number }> = JSON.parse(session.transcript_words)
  if (start < 0 || end >= words.length || start > end) return reply.code(400).send({ error: 'invalid range' })

  const replacedKeys = words.slice(start, end + 1)
    .map(w => w.word.toLowerCase().replace(/[^a-z']/g, ''))
    .filter(Boolean)

  let newWords: Array<{ word: string; start: number; end: number }>
  if (!trimmed) {
    newWords = []
  } else {
    const rangeStart = words[start].start
    const rangeEnd = words[end].end
    const parts = trimmed.split(/\s+/)
    const interval = parts.length > 1 ? (rangeEnd - rangeStart) / parts.length : 0
    newWords = parts.map((word, i) => ({
      word,
      start: rangeStart + i * interval,
      end: i < parts.length - 1 ? rangeStart + (i + 1) * interval : rangeEnd,
    }))
  }

  const updated = [...words.slice(0, start), ...newWords, ...words.slice(end + 1)]
  const newTranscript = updated.map(w => w.word).join(' ')

  db.transaction(() => {
    db.prepare('UPDATE sessions SET transcript = ?, transcript_words = ? WHERE id = ?')
      .run(newTranscript, JSON.stringify(updated), id)
    for (const key of replacedKeys) {
      db.prepare('DELETE FROM word_associations WHERE used_word = ? AND session_id = ?').run(key, id)
    }
  })()

  return { transcript: newTranscript, transcript_words: JSON.stringify(updated) }
})

app.post<{ Params: SessionParams; Body: { suggested_word: string; used_word: string; time_ms: number } }>(
  '/sessions/:id/associations/manual',
  async (request, reply) => {
    const { id } = request.params
    const { suggested_word, used_word, time_ms } = request.body
    if (!suggested_word || !used_word || time_ms == null) {
      return reply.code(400).send({ error: 'missing fields' })
    }
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)
    if (!session) return reply.code(404).send({ error: 'not found' })

    const existing = db.prepare(
      'SELECT used_word_times FROM word_associations WHERE suggested_word = ? AND used_word = ? AND session_id = ?'
    ).get(suggested_word.toLowerCase(), used_word.toLowerCase(), id) as
      | { used_word_times: string | null }
      | undefined

    let times: number[]
    if (existing) {
      times = existing.used_word_times ? JSON.parse(existing.used_word_times) : []
      if (!times.includes(time_ms)) times.push(time_ms)
    } else {
      times = [time_ms]
    }

    db.prepare(`
      INSERT OR REPLACE INTO word_associations (suggested_word, used_word, session_id, count, used_word_times)
      VALUES (?, ?, ?, ?, ?)
    `).run(suggested_word.toLowerCase(), used_word.toLowerCase(), id, times.length, JSON.stringify(times))

    return { ok: true }
  }
)

app.delete<{ Params: SessionParams; Body: { entries: Array<{ used_word: string; time_ms: number }> } }>(
  '/sessions/:id/associations/manual',
  async (request, reply) => {
    const { id } = request.params
    const { entries } = request.body
    if (!entries?.length) return reply.code(400).send({ error: 'entries required' })
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)
    if (!session) return reply.code(404).send({ error: 'not found' })

    db.transaction(() => {
      for (const { used_word, time_ms } of entries) {
        const rows = db.prepare(
          'SELECT suggested_word, used_word_times FROM word_associations WHERE used_word = ? AND session_id = ?'
        ).all(used_word.toLowerCase(), id) as Array<{ suggested_word: string; used_word_times: string | null }>

        for (const row of rows) {
          const times: number[] = row.used_word_times ? JSON.parse(row.used_word_times) : []
          const newTimes = times.filter(t => t !== time_ms)
          if (newTimes.length === 0) {
            db.prepare('DELETE FROM word_associations WHERE suggested_word = ? AND used_word = ? AND session_id = ?')
              .run(row.suggested_word, used_word.toLowerCase(), id)
          } else {
            db.prepare('UPDATE word_associations SET used_word_times = ?, count = ? WHERE suggested_word = ? AND used_word = ? AND session_id = ?')
              .run(JSON.stringify(newTimes), newTimes.length, row.suggested_word, used_word.toLowerCase(), id)
          }
        }
      }
    })()

    return { ok: true }
  }
)

app.patch<{ Params: SessionParams; Body: { title: string } }>('/sessions/:id', async (request, reply) => {
  const { id } = request.params
  const { title } = request.body
  const trimmed = title?.trim()
  if (!trimmed) return reply.code(400).send({ error: 'title required' })
  const result = db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(trimmed, id)
  if (result.changes === 0) return reply.code(404).send({ error: 'not found' })
  return { id, title: trimmed }
})

app.delete<{ Params: SessionParams }>('/sessions/:id', async (request, reply) => {
  const { id } = request.params
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  reply.code(204)
  return null
})

app.post<{ Body: { words: string[] } }>('/word-associations/lookup', async (request) => {
  const { words } = request.body
  if (!words?.length) return []
  const lower = words.map(w => w.toLowerCase())
  const placeholders = lower.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT used_word, SUM(count) as count
    FROM word_associations
    WHERE used_word IN (${placeholders})
    GROUP BY used_word
    ORDER BY count DESC
  `).all(...lower)
  return rows
})

app.get<{ Params: { word: string } }>('/word-associations/:word', async (request) => {
  const rows = db.prepare(`
    SELECT used_word, SUM(count) as count
    FROM word_associations
    WHERE suggested_word = ?
    GROUP BY used_word
    ORDER BY count DESC
  `).all(request.params.word.toLowerCase())
  return rows
})

app.get<{ Params: { id: string } }>('/sessions/:id/associations', async (request) => {
  const session = db.prepare('SELECT transcript, transcript_words FROM sessions WHERE id = ?').get(request.params.id) as
    | { transcript: string; transcript_words: string | null }
    | undefined
  if (!session) return []

  let words: string[]
  if (session.transcript_words) {
    const tw = JSON.parse(session.transcript_words) as Array<{ word: string }>
    words = tw.map(w => w.word.toLowerCase().replace(/[^a-z']/g, '')).filter(Boolean)
  } else {
    words = session.transcript.trim().split(/\s+/).map(w => w.toLowerCase().replace(/[^a-z']/g, '')).filter(Boolean)
  }

  const unique = [...new Set(words)]
  if (!unique.length) return []

  const placeholders = unique.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT
      wa.used_word,
      wa.suggested_word,
      wa.session_id,
      wa.count,
      wa.used_word_times,
      s.title        AS session_title,
      s.started_at   AS session_started_at
    FROM word_associations wa
    JOIN sessions s ON s.id = wa.session_id
    WHERE wa.used_word IN (${placeholders})
      AND wa.session_id = ?
    ORDER BY wa.count DESC
  `).all(...unique, request.params.id)

  return rows
})

app.post<{ Params: SessionParams }>('/sessions/:id/audio', async (request, reply) => {
  const { id } = request.params
  const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)
  if (!session) return reply.code(404).send({ error: 'not found' })

  const data = await request.file()
  if (!data) return reply.code(400).send({ error: 'no file' })

  const ext = data.mimetype.includes('mp4') ? 'mp4' : 'webm'
  const filename = `${id}.${ext}`
  const filepath = join(UPLOADS_DIR, filename)

  await pipeline(data.file, createWriteStream(filepath))

  const audioUrl = `/uploads/${filename}`
  db.prepare('UPDATE sessions SET audio_url = ? WHERE id = ?').run(audioUrl, id)

  return { audio_url: audioUrl }
})

await app.listen({ port: 3001, host: '0.0.0.0' })
