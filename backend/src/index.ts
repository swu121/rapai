import Fastify from 'fastify'
import cors from '@fastify/cors'
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

const db = new Database('./sessions.db')

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    transcript TEXT NOT NULL,
    title      TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at   TEXT NOT NULL
  )
`)

interface PostSessionBody {
  transcript: string
  started_at: string
  ended_at: string
}

interface SessionParams {
  id: string
}

const app = Fastify({ logger: true })
await app.register(cors, { origin: 'http://localhost:5173' })

app.get('/health', async () => ({ status: 'ok' }))

app.get('/sessions', async () => {
  return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all()
})

app.post<{ Body: PostSessionBody }>('/sessions', async (request, reply) => {
  const { transcript, started_at, ended_at } = request.body
  const id = randomUUID()
  const title = transcript.trim().split(/\s+/).slice(0, 6).join(' ') || 'Untitled'

  db.prepare(
    'INSERT INTO sessions (id, transcript, title, started_at, ended_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, transcript, title, started_at, ended_at)

  reply.code(201)
  return { id, transcript, title, started_at, ended_at }
})

app.delete<{ Params: SessionParams }>('/sessions/:id', async (request, reply) => {
  const { id } = request.params
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  reply.code(204)
  return null
})

await app.listen({ port: 3001, host: '0.0.0.0' })
