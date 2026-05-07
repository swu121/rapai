import Fastify from 'fastify'
import cors from '@fastify/cors'
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

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
  // First time adding this column — all existing rows have already processed, mark them done
  db.exec("UPDATE sessions SET associations_status = 'done'")
} catch { /* column already exists */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS word_associations (
    suggested_word TEXT NOT NULL,
    used_word      TEXT NOT NULL,
    session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    count          INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (suggested_word, used_word, session_id)
  )
`)

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
  const setStatus = (status: 'done' | 'failed') =>
    db.prepare("UPDATE sessions SET associations_status = ? WHERE id = ?").run(status, sessionId)

  if (!transcriptWords.length || !suggestedWords.length) {
    setStatus('done')
    return
  }

  try {

  const uniqueWords = [...new Set(suggestedWords.map(s => s.word))]
  const rhymeMap = new Map<string, Set<string>>()

  await Promise.all(uniqueWords.map(async (word) => {
    const res = await fetch(`https://api.datamuse.com/words?rel_rhy=${encodeURIComponent(word)}&max=1000`)
    const results: { word: string }[] = await res.json()
    rhymeMap.set(word, new Set(results.map(r => r.word.toLowerCase())))
  }))

  const sortedSuggested = [...suggestedWords].sort((a, b) => a.shownAt - b.shownAt)
  const sortedTranscript = [...transcriptWords].sort((a, b) => a.start - b.start)

  const upsert = db.prepare(`
    INSERT INTO word_associations (suggested_word, used_word, session_id, count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(suggested_word, used_word, session_id) DO UPDATE SET count = count + 1
  `)

  const upsertBatch = db.transaction((pairs: Array<[string, string]>) => {
    for (const [suggested, used] of pairs) {
      upsert.run(suggested, used, sessionId)
    }
  })

  for (let i = 0; i < sortedSuggested.length; i++) {
    const { word: suggestedWord, shownAt } = sortedSuggested[i]
    const nextShownAt = sortedSuggested[i + 1]?.shownAt ?? Infinity

    const rhymeSet = rhymeMap.get(suggestedWord)
    if (!rhymeSet) continue

    const pairs: Array<[string, string]> = []
    for (const tw of sortedTranscript) {
      if (tw.start < shownAt || tw.start >= nextShownAt) continue
      const w = tw.word.toLowerCase()
      if (w.length <= 1) continue
      if (w === suggestedWord.toLowerCase()) continue
      if (rhymeSet.has(w)) pairs.push([suggestedWord.toLowerCase(), w])
    }
    if (pairs.length) upsertBatch(pairs)
  }

  setStatus('done')
  } catch (err) {
    setStatus('failed')
    throw err
  }
}

const app = Fastify({ logger: true })
await app.register(cors, { origin: /^http:\/\/localhost:\d+$/ })

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
      s.title        AS session_title,
      s.started_at   AS session_started_at
    FROM word_associations wa
    JOIN sessions s ON s.id = wa.session_id
    WHERE wa.used_word IN (${placeholders})
    ORDER BY wa.count DESC
  `).all(...unique)

  return rows
})

await app.listen({ port: 3001, host: '0.0.0.0' })
