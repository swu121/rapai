import { useState, useEffect } from 'react'
import { MicController } from './components/MicController'
import { WordGenerator } from './components/WordGenerator'
import { SessionSidebar } from './components/SessionSidebar'
import { SessionViewer } from './components/SessionViewer'
import './App.css'

export type StoredSession = {
  id: string
  transcript: string
  title: string
  started_at: string
  ended_at: string
}

const API = 'http://localhost:3001'

function App() {
  const [sessions, setSessions] = useState<StoredSession[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  async function fetchSessions() {
    const res = await fetch(`${API}/sessions`)
    setSessions(await res.json())
  }

  useEffect(() => { fetchSessions() }, [])

  async function deleteSession(id: string) {
    await fetch(`${API}/sessions/${id}`, { method: 'DELETE' })
    setSessions(prev => prev.filter(s => s.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  function handleSelect(id: string) {
    setSelectedId(prev => (prev === id ? null : id))
  }

  const selectedSession = sessions.find(s => s.id === selectedId) ?? null

  return (
    <div className="app-layout">
      <SessionSidebar
        sessions={sessions}
        selectedId={selectedId}
        onSelect={handleSelect}
        onDelete={deleteSession}
        onHome={() => setSelectedId(null)}
      />
      <main className="app-main">
        {selectedSession ? (
          <SessionViewer session={selectedSession} />
        ) : (
          <div className="app-columns">
            <WordGenerator />
            <MicController onSessionSaved={fetchSessions} />
          </div>
        )}
      </main>
    </div>
  )
}

export default App
