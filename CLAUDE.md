# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A desktop-first web app for real-time freestyle rap training. Users rap over a beat while the app provides live word-by-word transcription, mid-bar rhyme suggestions personalized to their habits, and post-session flow analysis.

The hardest technical constraint: transcription must be word-by-word as the user speaks — not buffered and displayed after pauses. Everything in the architecture is shaped around this requirement.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + TypeScript, Vercel | Complex stateful UI |
| State | Zustand | Session state, suggestions, BPM |
| Audio capture | Web Audio API → AudioWorkletProcessor | Non-blocking main thread |
| Transcription | Deepgram Nova-2 (WebSocket) | Streaming interim results, ~300ms lag, rap model fine-tune |
| BPM detection | Essentia.js (WASM) in Web Worker | Doesn't block audio capture |
| Rhyme lookup | CMU Pronouncing Dictionary (in-browser) | <5ms, instant first suggestions |
| Smart suggestions | Claude API (streamed) | Habit-aware, vocabulary expansion |
| Backend | Node.js + Fastify on Railway/Fly.io | Claude API proxy, session storage, habit computation |
| Database | Supabase Postgres + Redis | Postgres: sessions/profiles; Redis: rhyme cache + in-session n-grams |

## Architecture

### Hot Path (latency-critical)
```
Mic → AudioWorklet (50–100ms chunks) → Deepgram WebSocket → interim results → UI
                                                           ↓
                                              last word → CMU lookup (<5ms) → instant suggestions
                                                           ↓
                                              Claude API (streamed) → better suggestions at 500–800ms
```
The AudioWorklet sends chunks **continuously** — never buffer and send on silence. That's what causes the "all words appear at once" failure mode.

### Suggestion Engine
Two-stage: fast then smart.
1. **CMU dict** fires immediately (<5ms) on the last transcribed word — pure phoneme matching.
2. **Claude API** streams in ranked/contextual suggestions 500–800ms later, annotated with user habit data.

Show stage 1 first, animate stage 2 in as it arrives. Users read this as "quick options → better options."

### Habit Tracking (post-session, not hot path)
- Maintain per-user rolling n-gram tables (1-gram, 2-gram, rhyme-family) in Postgres
- Pass usage stats as context to Claude: `"this user has used 'fire/higher/desire' 23 times this month"`
- Track a "seen words" set per user; rank unseen rhymes higher in suggestions
- During session: track last 8 rhyme-ending words in Redis; if same rhyme family appears 3+ times, switch to pattern-breaking mode

### BPM / Flow Tracking
- Deepgram word timestamps → syllable density per bar
- BPM (auto via Essentia.js or manual tap) → bar length in ms → beat grid
- Flag bars where user consistently lands on same beat position

## Project Structure (to be built)

```
/
├── frontend/          # React + TypeScript app
│   ├── worklets/      # AudioWorkletProcessor (runs off main thread)
│   ├── workers/       # Essentia.js BPM detection Web Worker
│   └── ...
├── backend/           # Fastify API server
│   ├── routes/        # Claude proxy, session CRUD, habit computation
│   └── ...
└── shared/            # Types shared between frontend and backend
```

## Development Commands

*(Fill in as project is scaffolded)*

```bash
# Frontend
cd frontend && npm run dev       # Start dev server
cd frontend && npm run build     # Production build
cd frontend && npm run typecheck # Type check without building

# Backend
cd backend && npm run dev        # Start Fastify with hot reload
cd backend && npm run test       # Run tests
```

## Key Implementation Notes

**AudioWorklet is mandatory** — `ScriptProcessorNode` is deprecated and blocks the main thread. The worklet file must be loaded via `audioContext.audioWorklet.addModule(url)`.

**Deepgram connection**: open a single WebSocket per session, send raw PCM chunks, listen for `Results` events with `is_final: false` for interim (word-by-word) and `is_final: true` for finalized lines.

**Claude API key never goes in the browser** — all Claude calls route through the Fastify backend.

**Redis is the session hot store**: current n-gram counts and the last-8-rhymes pattern buffer live in Redis during a session, then get flushed to Postgres post-session.

## MVP Build Order

1. AudioWorklet → Deepgram WebSocket → live transcript UI
2. CMU dict rhyme lookup → suggestion panel
3. BPM tap/manual input → beat grid overlay
4. Session recording via MediaRecorder + playback
5. Post-session vocab frequency analysis
6. Claude API habit-aware suggestions
7. User profiles + cross-session habit tracking
