interface DatamuseWord {
  word: string
  score: number
  numSyllables?: number
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}

export async function getRhymes(word: string, count = 5): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.datamuse.com/words?rel_rhy=${encodeURIComponent(word)}&max=50`
    )
    if (!res.ok) return []
    const results: DatamuseWord[] = await res.json()
    return pickRandom(results, count).map(r => r.word)
  } catch {
    return []
  }
}
