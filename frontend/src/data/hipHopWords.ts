export const HIP_HOP_WORDS: string[] = [
  // Actions
  'flow', 'grind', 'hustle', 'spit', 'bounce', 'rise', 'shine', 'reign',
  'flex', 'climb', 'ride', 'slide', 'glide', 'drop', 'lock', 'rock',
  'roll', 'stroll', 'run', 'gun', 'stunt', 'front', 'hunt', 'blunt',
  'push', 'rush', 'crush', 'brush', 'bust', 'trust', 'adjust', 'discuss',
  'breathe', 'seethe', 'weave', 'achieve', 'believe', 'deceive', 'conceive',
  'speak', 'seek', 'peak', 'freak', 'streak', 'wreak',
  'move', 'prove', 'groove', 'improve',
  'fight', 'write', 'ignite', 'excite', 'recite', 'invite',
  'stand', 'command', 'demand', 'expand', 'understand',
  'build', 'fill', 'spill', 'kill', 'thrill', 'chill', 'will',

  // Status / clout
  'crown', 'king', 'throne', 'boss', 'legend', 'ice', 'gold', 'chain',
  'stack', 'dime', 'prime', 'crime', 'lime', 'time', 'rhyme', 'climb',
  'paper', 'vapor', 'major', 'player', 'slayer', 'layer',
  'cash', 'flash', 'clash', 'stash', 'dash', 'smash', 'trash',
  'bread', 'thread', 'spread', 'dread', 'instead', 'ahead',
  'jewel', 'fuel', 'duel', 'rule', 'cool', 'school', 'fool', 'tool',
  'power', 'tower', 'hour', 'flower', 'devour',
  'name', 'fame', 'game', 'flame', 'aim', 'claim', 'blame', 'shame',
  'prize', 'rise', 'wise', 'eyes', 'skies', 'disguise',

  // Place / scene
  'block', 'streets', 'hood', 'stage', 'city', 'night', 'cipher',
  'corner', 'borough', 'avenue', 'bridge', 'roof', 'basement', 'spotlight',
  'jungle', 'concrete', 'pavement', 'rooftop', 'skyline', 'underground',
  'coast', 'toast', 'host', 'ghost', 'post', 'most', 'boast',

  // Abstract / emotional
  'truth', 'pain', 'rain', 'brain', 'chain', 'lane', 'gain', 'strain',
  'hunger', 'thunder', 'wonder', 'plunder', 'asunder',
  'soul', 'goal', 'role', 'whole', 'scroll', 'control', 'patrol',
  'mind', 'grind', 'find', 'blind', 'bind', 'kind', 'behind', 'defined',
  'heart', 'art', 'start', 'part', 'smart', 'apart', 'depart',
  'dream', 'stream', 'team', 'scheme', 'extreme', 'supreme', 'redeem',
  'fire', 'desire', 'inspire', 'higher', 'wire', 'empire',
  'blood', 'flood', 'mud', 'bud', 'thud', 'stud',
  'voice', 'choice', 'noise', 'poise', 'rejoice',
  'light', 'night', 'flight', 'sight', 'might', 'right', 'tight', 'delight',
  'life', 'strife', 'knife', 'wife', 'rife',
  'sound', 'ground', 'found', 'bound', 'round', 'pound', 'surround',
  'word', 'heard', 'third', 'bird', 'blurred', 'stirred',

  // Descriptors
  'raw', 'cold', 'real', 'live', 'hard', 'sharp', 'clean', 'smooth',
  'wild', 'bright', 'bold', 'old', 'gold', 'sold', 'told', 'mold',
  'deep', 'sleep', 'keep', 'leap', 'sweep', 'creep', 'reap',
  'strong', 'long', 'wrong', 'song', 'belong', 'along', 'prolong',
  'free', 'see', 'be', 'key', 'spree', 'agree', 'degree', 'decree',
  'pure', 'sure', 'cure', 'lure', 'endure', 'obscure', 'secure',
]

export function randomWord(exclude?: string): string {
  const pool = exclude
    ? HIP_HOP_WORDS.filter(w => w !== exclude)
    : HIP_HOP_WORDS
  return pool[Math.floor(Math.random() * pool.length)]
}
