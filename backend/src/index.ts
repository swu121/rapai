import Fastify from 'fastify'
import cors from '@fastify/cors'

const app = Fastify({ logger: true })

await app.register(cors, { origin: 'http://localhost:5173' })

app.get('/health', async () => ({ status: 'ok' }))

await app.listen({ port: 3001, host: '0.0.0.0' })
