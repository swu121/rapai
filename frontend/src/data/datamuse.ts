interface DatamuseWord {
  word: string
  score: number
  numSyllables?: number
}

export async function getRhymes(word: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.datamuse.com/words?rel_rhy=${encodeURIComponent(word)}&max=50`
    )
    if (!res.ok) return []
    const results: DatamuseWord[] = await res.json()
    return results.map(r => r.word)
  } catch {
    return []
  }
}

