/**
 * What the valley remembers about you, kept in localStorage: who you've
 * met, little flags from conversations, verses from your camps, and the
 * name you gave your horse. Landmark finds live in "winterfell-found".
 */
export interface SaveData {
  met: Record<string, number>
  flags: Record<string, boolean>
  verses: string[]
  horse: string
  /** things people told you, per person, for the journal */
  notes: Record<string, string[]>
}

const KEY = "winterfell-journal"

const empty = (): SaveData => ({ met: {}, flags: {}, verses: [], horse: "", notes: {} })

let cache: SaveData | null = null
const listeners = new Set<() => void>()

export function loadSave(): SaveData {
  if (cache) return cache
  try {
    cache = { ...empty(), ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<SaveData>) }
  } catch {
    cache = empty()
  }
  return cache
}

export function updateSave(fn: (s: SaveData) => void) {
  const s = loadSave()
  fn(s)
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage can be unavailable */
  }
  for (const l of listeners) l()
}

export function onSaveChange(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function horseName(fallback = "your horse") {
  return loadSave().horse || fallback
}
