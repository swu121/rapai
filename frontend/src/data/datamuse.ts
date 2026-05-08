interface DatamuseWord {
  word: string
  score: number
  numSyllables?: number
}

const WORD_BLACKLIST = new Set([
  // pronouns
  'i', 'me', 'my', 'mine', 'myself',
  'we', 'us', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'they', 'them', 'their', 'theirs', 'themselves',
  // articles / determiners
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  // common conjunctions / prepositions
  'and', 'but', 'or', 'nor', 'so', 'yet', 'for',
  'in', 'on', 'at', 'by', 'to', 'of', 'up', 'as', 'is', 'be',
  'do', 'did', 'does', 'done',
  'have', 'has', 'had',
  'was', 'were', 'are', 'am',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
  'not', 'no', 'yes', 'oh', 'ah', 'hey',
])

function isBlacklisted(word: string): boolean {
  const lower = word.toLowerCase()
  // filter contractions (contain apostrophe)
  if (lower.includes("'")) return true
  // filter single characters
  if (lower.length <= 1) return true
  return WORD_BLACKLIST.has(lower)
}

export async function getRhymes(word: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.datamuse.com/words?rel_rhy=${encodeURIComponent(word)}&max=50`
    )
    if (!res.ok) return []
    const results: DatamuseWord[] = await res.json()
    return results.map(r => r.word).filter(w => !isBlacklisted(w))
  } catch {
    return []
  }
}

