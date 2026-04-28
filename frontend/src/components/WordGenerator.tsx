import { useState, useEffect, useRef } from 'react'
import { randomWord } from '../data/hipHopWords'
import './WordGenerator.css'

const INTERVALS = [5, 10, 15] as const

export function WordGenerator() {
  const [intervalSecs, setIntervalSecs] = useState<number>(10)
  const [secondsLeft, setSecondsLeft] = useState<number>(10)
  const [isRunning, setIsRunning] = useState(true)
  const [currentWord, setCurrentWord] = useState(() => randomWord())
  const [visible, setVisible] = useState(true)

  const currentWordRef = useRef(currentWord)
  currentWordRef.current = currentWord

  useEffect(() => {
    if (!isRunning) return

    const tick = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          advanceWord()
          return intervalSecs
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(tick)
  }, [isRunning, intervalSecs])

  function advanceWord() {
    setVisible(false)
    setTimeout(() => {
      setCurrentWord(randomWord(currentWordRef.current))
      setVisible(true)
    }, 200)
  }

  function handleToggle() {
    if (!isRunning) {
      setSecondsLeft(intervalSecs)
    }
    setIsRunning(r => !r)
  }

  function handleSkip() {
    setSecondsLeft(intervalSecs)
    advanceWord()
  }

  function handleIntervalChange(secs: number) {
    setIntervalSecs(secs)
    setSecondsLeft(secs)
  }

  return (
    <div className="word-generator">
      <p className="wg-label">Word Prompt</p>

      <div className={`wg-word ${visible ? 'wg-word--visible' : 'wg-word--hidden'}`}>
        {currentWord}
      </div>

      <p className="wg-countdown">
        {isRunning ? `Next word in: ${secondsLeft}s` : 'Paused'}
      </p>

      <div className="wg-controls">
        <button className="wg-toggle" onClick={handleToggle}>
          {isRunning ? '⏸ Pause' : '▶ Start'}
        </button>
        <button className="wg-skip" onClick={handleSkip}>
          Skip →
        </button>
      </div>

      <div className="wg-intervals">
        {INTERVALS.map(s => (
          <button
            key={s}
            className={`wg-interval-btn ${intervalSecs === s ? 'wg-interval-btn--active' : ''}`}
            onClick={() => handleIntervalChange(s)}
          >
            {s}s
          </button>
        ))}
      </div>
    </div>
  )
}
