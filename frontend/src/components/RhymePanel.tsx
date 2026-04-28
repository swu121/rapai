import './RhymePanel.css'

interface RhymePanelProps {
  baseWord: string
  rhymes: string[]
  loading?: boolean
}

export function RhymePanel({ baseWord, rhymes, loading }: RhymePanelProps) {
  if (!loading && rhymes.length === 0) return null

  return (
    <div className="rhyme-panel">
      <p className="rhyme-panel__label">Rhymes with <span>{baseWord}</span></p>
      {loading ? (
        <p className="rhyme-panel__loading">...</p>
      ) : (
        <ul className="rhyme-panel__list">
          {rhymes.map(word => (
            <li key={word} className="rhyme-panel__word">{word}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
