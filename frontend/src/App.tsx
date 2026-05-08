import { useState, useEffect } from 'react'
import { MicController } from './components/MicController'
import { WordGenerator } from './components/WordGenerator'
import { SessionSidebar } from './components/SessionSidebar'
import { SessionViewer } from './components/SessionViewer'
import { HistoryRhymes } from './components/HistoryRhymes'
import './App.css'

export type StoredSession = {
  id: string
  transcript: string
  title: string
  started_at: string
  ended_at: string
  transcript_words?: string  // JSON: Array<{word, start, end}> in ms
  suggested_words?: string   // JSON: Array<{word, shownAt}>
  associations_status?: string  // 'pending' | 'done' | 'failed'
  audio_url?: string
}

const API = 'http://localhost:3001'

function App() {
  const [sessions, setSessions] = useState<StoredSession[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [suggestedWords, setSuggestedWords] = useState<Array<{ word: string; shownAt: number }>>([])
  const [rhymeSet, setRhymeSet] = useState<string[]>([])
  const [isRecording, setIsRecording] = useState(false)

  async function fetchSessions() {
    const res = await fetch(`${API}/sessions`)
    setSessions(await res.json())
  }

  useEffect(() => { fetchSessions() }, [])

  async function handleSessionSaved() {
    setSuggestedWords([])
    await fetchSessions()
  }

  function handleWordChange(word: string, shownAt: number) {
    setSuggestedWords(prev => {
      if (prev.at(-1)?.word === word) {
        console.log('[suggestedWords] skip duplicate:', word)
        return prev
      }
      console.log('[suggestedWords] adding:', word, '| total:', prev.length + 1)
      return [...prev, { word, shownAt }]
    })
    setRhymeSet([])
  }

  function handleTitleChange(id: string, title: string) {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title } : s))
  }

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
          <SessionViewer session={selectedSession} onTitleChange={handleTitleChange} />
        ) : (
          <div className="app-columns">
            <HistoryRhymes rhymeSet={rhymeSet} />
            <WordGenerator onWordChange={handleWordChange} onRhymesChange={setRhymeSet} isRecording={isRecording} />
            <MicController onSessionSaved={handleSessionSaved} suggestedWords={suggestedWords} onRecordingChange={setIsRecording} />
          </div>
        )}
      </main>
    </div>
  )
}

export default App
