export interface Session {
  id: string
  userId: string
  bpm: number
  startedAt: string
  endedAt?: string
  transcript: TranscriptWord[]
}

export interface TranscriptWord {
  word: string
  start: number
  end: number
  confidence: number
  isFinal: boolean
}

export interface RhymeSuggestion {
  word: string
  source: 'cmu' | 'claude'
  score: number
  isNew: boolean
}

export interface HabitContext {
  userId: string
  topRhymeFamilies: Array<{ family: string; count: number }>
  seenWordsCount: number
}
