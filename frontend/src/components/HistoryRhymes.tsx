import { useState, useEffect } from 'react'
import './HistoryRhymes.css'

const API = 'http://localhost:3001'

interface Association {
  used_word: string
  count: number
}

interface Props {
  rhymeSet: string[]
}

export function HistoryRhymes({ rhymeSet }: Props) {
  const [associations, setAssociations] = useState<Association[]>([])

  useEffect(() => {
    if (!rhymeSet.length) return
    let cancelled = false
    fetch(`${API}/word-associations/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: rhymeSet }),
    })
      .then(r => r.json())
      .then((data: Association[]) => { if (!cancelled) setAssociations(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [rhymeSet])

  if (associations.length === 0) return null

  return (
    <div className="history-rhymes">
      <p className="hr-label">Your rhymes</p>
      {associations.map(a => (
        <div key={a.used_word} className="hr-word">
          {a.used_word} <span className="hr-count">×{a.count}</span>
        </div>
      ))}
    </div>
  )
}
