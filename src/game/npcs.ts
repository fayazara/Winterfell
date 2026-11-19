/**
 * The people of the valley and what they have to say. No quests: just
 * conversations that remember you. Each NPC is a painted billboard; their
 * dialogue is a small graph of nodes. A choice without `next` ends the talk.
 */
import { horseName, loadSave, type SaveData } from "./save"
import { COURT, PATH_END_Z, pathX } from "./world"

export { COURT }

export type NpcKey = "hermit" | "merchant" | "farmer" | "woman" | "guard" | "stranger" | "lamplighter"

export interface Ctx {
  save: SaveData
  /** 0 day … 1 night */
  night: number
  weather: "clear" | "rain" | "fog"
  forecast: string
  riding: boolean
}

export type Action = "enterCourtyard" | "leaveCourtyard" | "nameHorse" | "vanish"

export interface Choice {
  label: string | ((c: Ctx) => string)
  next?: string
  /** flag to set when chosen */
  set?: string
  /** only offered when this returns true */
  if?: (c: Ctx) => boolean
}

export interface DNode {
  text: string | ((c: Ctx) => string)
  choices?: Choice[]
  /** auto-continue to this node */
  next?: string
  set?: string
  action?: Action
  /** a line saved to the journal under this person */
  note?: string
}

export interface Npc {
  id: string
  name: string
  title: string
  key: NpcKey | "horse"
  /** sprite height (m) */
  h: number
  x: number
  z: number
  /** walks back and forth along the road */
  walk?: { z0: number; z1: number; offset: number; speed: number }
  /** where it appears: the valley, the courtyard, or only by your fire at night */
  place?: "valley" | "courtyard" | "camp"
  start: (c: Ctx) => string
  nodes: Record<string, DNode>
}

const met = (c: Ctx, id: string) => (c.save.met[id] ?? 0) > 0


export const NPCS: Npc[] = [
  {
    id: "aldric",
    name: "Old Aldric",
    title: "Hermit of the Shrine",
    key: "hermit",
    h: 1.85,
    x: pathX(17) + 7.5,
    z: 17,
    start: (c) => (met(c, "aldric") ? "again" : "hello"),
    nodes: {
      hello: {
        text: "Another one walking toward the spires. Sit, if you like. The stone doesn't mind.",
        choices: [
          { label: "Who are you?", next: "who" },
          { label: "What's in the castle?", next: "castle" },
          { label: "I should keep walking.", next: "bye" },
        ],
      },
      who: {
        text: "I was a knight once. Then I was a man who prayed here. Now I mostly watch the light change.",
        choices: [
          { label: "Why did you stop?", next: "why" },
          { label: "What's in the castle?", next: "castle" },
        ],
      },
      why: {
        text: "Because the road was always going to be there. The evenings weren't.",
        note: "The road will always be there. The evenings won't.",
        choices: [{ label: "…I think I understand.", next: "gift" }],
      },
      castle: {
        text: "Some say a king. Some say nobody at all. I've never gone in. The not-knowing is good company.",
        choices: [
          { label: "Then why does everyone go?", next: "why2" },
          { label: "Thank you.", next: "gift" },
        ],
      },
      why2: { text: "To find out. That's the best reason there is, and the worst.", next: "gift" },
      gift: {
        text: "Here, bread from the hamlet. Eat it by a fire, not on the road.",
        set: "bread",
        note: "Gave me bread. 'Eat it by a fire, not on the road.'",
        choices: [{ label: "Thank you, Aldric." }],
      },
      again: {
        text: (c) => (c.night > 0.6 ? "Still up? Good. The stars are better company than I am." : "Back again. Has the light gone violet for you yet?"),
        choices: [
          { label: "It has.", next: "violet" },
          { label: "Not yet.", next: "notyet" },
          { label: "Tell me about the castle again.", next: "castle" },
        ],
      },
      violet: { text: "Then you've seen the best of it. The castle can only be the second best." },
      notyet: { text: "It will. Light a fire when it does." },
      bye: { text: "Then walk well. And slowly." },
    },
  },
  {
    id: "pell",
    name: "Pell",
    title: "Peddler of Stories",
    key: "merchant",
    h: 1.9,
    x: 0,
    z: 0,
    walk: { z0: 12, z1: -64, offset: 2.4, speed: 0.8 },
    start: (c) => (met(c, "pell") ? "again" : "hello"),
    nodes: {
      hello: {
        text: "Ho there! I've nothing to sell, I'm afraid. Sold it all. But I trade in stories, if you've got the time.",
        choices: [
          { label: "Tell me one.", next: "rumour" },
          { label: "Where are you headed?", next: "where" },
          { label: "Another time.", next: "bye" },
        ],
      },
      again: {
        text: "My favourite listener! Back for another?",
        choices: [
          { label: "Tell me one.", next: "rumour" },
          { label: "Just passing.", next: "bye" },
        ],
      },
      rumour: {
        text: (c) =>
          !c.save.flags.hint_stones
            ? "There are stones in the west meadow, past the mere, that glow at night. Runes. Older than the castle, older than the road."
            : !c.save.flags.hint_tower
              ? "A watchtower stands broken on the east slope. Its keeper left one winter and never came back."
              : !c.save.flags.hint_arch
                ? "Near the castle road there's a gate with no wall. Walk through it and nothing happens. Probably."
                : "That's every story I have. Come back when I've heard more. Or tell me one of yours.",
        next: "rumour_mark",
      },
      rumour_mark: {
        text: (c) =>
          c.save.flags.hint_arch ? "Off you go, then." : "I've marked it on your map. Old peddler's habit.",
        // the flag for whichever story was just told
        set: "__next_hint",
        choices: [{ label: "Thank you, Pell." }],
      },
      where: { text: "Up the road, down the road. The walking's the trade, really.", choices: [{ label: "Tell me a story, then.", next: "rumour" }, { label: "Safe travels." }] },
      bye: { text: "Safe roads, friend!" },
    },
  },
  {
    id: "maren",
    name: "Maren",
    title: "of the Hamlet Well",
    key: "woman",
    h: 1.75,
    x: pathX(-10) + 14.5,
    z: -10,
    start: (c) => (met(c, "maren") ? "again" : "hello"),
    nodes: {
      hello: {
        text: (c) =>
          c.riding
            ? "That horse of yours looks thirsty. And you look worse. The water's cold and it's free."
            : "You look like you've been walking a while. The water's cold and it's free.",
        choices: [
          { label: "I'll drink, thank you.", next: "drink" },
          { label: "Do you know the castle?", next: "castle" },
          { label: "Is that your cottage?", next: "home" },
        ],
      },
      drink: {
        text: "There. My grandmother said this well never runs dry. It nearly did once. We all carried water up from the mere for a month.",
        note: "The well nearly ran dry once. The hamlet carried water from the mere for a month.",
        choices: [{ label: "Do you know the castle?", next: "castle" }, { label: "Thank you, Maren." }],
      },
      castle: {
        text: "The lamps come on every evening, up there. Nobody from the hamlet has ever seen who lights them.",
        note: "Nobody has seen who lights the castle lamps.",
        choices: [{ label: "Strange.", next: "strange" }],
      },
      strange: { text: "Is it? Somebody has to. Maybe it's nicer not to know." },
      home: { text: "The one with the red roof. And the other one, actually. My brother's away, wandering. Like you." },
      again: {
        text: "Back for more water? The well remembers you.",
        choices: [{ label: "I'll drink.", next: "drink" }, { label: "Just saying hello." }],
      },
    },
  },
  {
    id: "tobin",
    name: "Tobin",
    title: "Farmer",
    key: "farmer",
    h: 1.85,
    x: pathX(-24) - 11,
    z: -24,
    start: () => "hello",
    nodes: {
      hello: {
        text: (c) =>
          c.weather === "rain"
            ? "Good rain, this. The barley's been asking for it all week."
            : c.weather === "fog"
              ? "Can't see my own fence. Good. Then it can't see me not mending it."
              : c.night > 0.6
                ? "Can't sleep. The crickets are loud tonight. Not complaining, mind."
                : "Fine day for walking. Fine day for not working, too, if anyone asks.",
        choices: [
          { label: "Will the weather hold?", next: "forecast" },
          { label: "How's the farm?", next: "farm" },
          { label: "Good day, Tobin." },
        ],
      },
      forecast: { text: (c) => `My knee says ${c.forecast}. My knee's never been wrong. Well. Twice.` },
      farm: { text: "Barley, two goats, one opinionated goose. It's a living. Mostly it's a sitting." },
    },
  },
  {
    id: "hallan",
    name: "Sir Hallan",
    title: "Gatewarden",
    key: "guard",
    h: 1.95,
    x: pathX(PATH_END_Z + 2) + 2.6,
    z: PATH_END_Z + 2,
    start: (c) => (met(c, "hallan") ? "again" : "hello"),
    nodes: {
      hello: {
        text: "Halt! …No, I'm only joking. Nobody's come up this road in years. You've walked a long way.",
        choices: [
          { label: "May I go in?", next: "enter" },
          { label: "Who lives in the castle?", next: "who" },
          { label: "Not yet.", next: "notyet" },
        ],
      },
      again: { text: "Back again. The gate's still open.", choices: [{ label: "Then I'll go in.", next: "enter" }, { label: "Not yet.", next: "notyet" }] },
      who: {
        text: "Live? Hm. The lamps live here. The banners. Me, for my sins.",
        choices: [{ label: "May I go in?", next: "enter" }, { label: "I'll come back." , next: "notyet" }],
      },
      enter: { text: "The gate's open. It always was. Mind the step.", action: "enterCourtyard" },
      notyet: { text: "Take your time. The castle has plenty." },
    },
  },
  {
    id: "lamplighter",
    name: "Wenna",
    title: "the Lamplighter",
    key: "lamplighter",
    h: 1.8,
    x: COURT.x + 5,
    z: COURT.z - 7,
    place: "courtyard",
    start: (c) => (met(c, "lamplighter") ? "again" : "hello"),
    nodes: {
      hello: {
        text: "Oh! A visitor. Mind the oil, it's everywhere. I'm the one who lights the lamps, if you were wondering.",
        choices: [
          { label: "Everyone in the valley wonders.", next: "wonder" },
          { label: "Who else lives here?", next: "who" },
        ],
      },
      wonder: {
        text: "Do they? How lovely. It's only me. Every evening, every lamp. Somebody has to, and I like the walk.",
        note: "It was her all along: she lights every lamp, every evening, because she likes the walk.",
        set: "lamps_answered",
        choices: [{ label: "Is that all the castle is?", next: "all" }],
      },
      who: { text: "Sir Hallan at the gate, the pigeons, and me. The king left a very long time ago. We kept the lamps on anyway.", next: "wonder" },
      all: {
        text: "All? It's a warm room at the end of a long road. People walk a long way for less.",
        choices: [{ label: "I suppose they do.", next: "end" }],
      },
      end: {
        text: "Stay as long as you like. And when you leave, the road will still be there. That's the nice thing about roads.",
        note: "'The road will still be there. That's the nice thing about roads.'",
      },
      again: {
        text: (c) => (c.night > 0.5 ? "Lamps are lit. Sit by the fountain, it hums at night." : "Too early for lamps. Too early for most things. Tea?"),
        choices: [{ label: "Tea would be nice." }, { label: "I'll head back to the road.", next: "leave" }],
      },
      leave: { text: "Mind the step on the way out.", action: "leaveCourtyard" },
    },
  },
  {
    id: "stranger",
    name: "Hooded Stranger",
    title: "who walks at night",
    key: "stranger",
    h: 1.95,
    x: 0,
    z: 0,
    place: "camp",
    start: (c) => (met(c, "stranger") ? "again" : "hello"),
    nodes: {
      hello: {
        text: "May I share your fire? …Thank you.",
        choices: [{ label: "Who are you?", next: "who" }, { label: "Sit.", next: "sit" }],
      },
      who: { text: "Someone who walks at night, the way you walk by day.", next: "sit" },
      sit: {
        text: "You're going to the castle. Everyone is, eventually. Don't hurry. It isn't going anywhere, and neither, really, are you.",
        note: "'Don't hurry. It isn't going anywhere, and neither, really, are you.'",
        choices: [{ label: "Will I see you again?", next: "bye" }],
      },
      again: {
        text: "Your fire again. It's a good one.",
        choices: [{ label: "Where do you go in the day?", next: "day" }, { label: "Goodnight." , next: "bye" }],
      },
      day: { text: "Where the night goes. Somewhere just past the edge of the map.", next: "bye" },
      bye: { text: "When the fire is low. Goodnight, knight.", action: "vanish" },
    },
  },
]

/** Your horse, which you can talk to when you're standing beside it. */
export const HORSE_TALK: Npc = {
  id: "horse",
  name: "",
  title: "your horse",
  key: "horse",
  h: 2.5,
  x: 0,
  z: 0,
  start: (c) => (c.save.horse ? "named" : "nameless"),
  nodes: {
    nameless: {
      text: "Your horse nudges your shoulder, warm and patient. It has carried you a long way without a name.",
      choices: [{ label: "Give it a name", next: "name" }, { label: "Pat its neck", next: "pat" }, { label: "Leave it be" }],
    },
    named: {
      text: (c) => `${c.save.horse} flicks an ear at you.`,
      choices: [
        { label: (c) => `Pat ${c.save.horse}'s neck`, next: "pat" },
        { label: "Share your bread", next: "fed", if: (c) => !!c.save.flags.bread && !c.save.flags.horse_fed },
        { label: "Choose a new name", next: "name" },
        { label: "Leave it be" },
      ],
    },
    name: { text: "What will you call your horse?", action: "nameHorse" },
    pat: { text: () => `${cap(horseName("Your horse"))} leans into your hand and breathes out, long and slow.` },
    fed: { text: (c) => `${c.save.horse} takes the bread very politely. Mostly politely.`, set: "horse_fed" },
  },
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The order Pell tells his stories in. */
export const PELL_HINTS = ["hint_stones", "hint_tower", "hint_arch"] as const

export function nextPellHint(): string | null {
  const f = loadSave().flags
  return PELL_HINTS.find((h) => !f[h]) ?? null
}
