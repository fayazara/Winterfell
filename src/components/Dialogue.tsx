import { useEffect, useMemo, useRef, useState } from "react"
import { nextPellHint, type Action, type Choice, type Ctx, type DNode, type Npc } from "@/game/npcs"
import { updateSave } from "@/game/save"

/** Portrait art per speaker: the same painted sprite, framed on the head. */
export const PORTRAITS: Record<string, string> = {
  hermit: "/sprites/library/people/hermit.png",
  merchant: "/sprites/library/people/merchant.png",
  farmer: "/sprites/library/people/villager_farmer.png",
  woman: "/sprites/library/people/villager_woman.png",
  guard: "/sprites/library/people/guard.png",
  stranger: "/sprites/library/people/hooded_stranger.png",
  lamplighter: "/sprites/world/lamplighter.png",
  horse: "/sprites/library/creatures/horse_front.png",
}

const say = <T,>(v: T | ((c: Ctx) => T), c: Ctx): T => (typeof v === "function" ? (v as (c: Ctx) => T)(c) : v)

export function Dialogue(props: {
  npc: Npc
  ctx: () => Ctx
  onAction: (a: Action) => void
  onClose: () => void
  onCue: () => void
}) {
  const { npc } = props
  const [nodeId, setNodeId] = useState(() => npc.start(props.ctx()))
  const [shown, setShown] = useState(0)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState("")
  const pendingAction = useRef<Action | null>(null)
  const node: DNode = npc.nodes[nodeId]
  // freeze the context per node so text doesn't change as flags are set
  const ctx = useMemo(() => props.ctx(), [nodeId, naming]) // eslint-disable-line react-hooks/exhaustive-deps
  const text = say(node.text, ctx)
  const done = shown >= text.length
  const choices = (node.choices ?? []).filter((c) => !c.if || c.if(ctx))

  // entering a node: apply its effects once
  useEffect(() => {
    setShown(0)
    if (node.set || node.note) {
      updateSave((s) => {
        if (node.set) {
          const flag = node.set === "__next_hint" ? nextPellHint() : node.set
          if (flag) s.flags[flag] = true
        }
        if (node.note) {
          const list = (s.notes[npc.id] ??= [])
          if (!list.includes(node.note)) list.push(node.note)
        }
      })
    }
    if (node.action === "nameHorse") setNaming(true)
    else if (node.action) pendingAction.current = node.action
  }, [nodeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // typewriter
  useEffect(() => {
    if (done) return
    const id = setTimeout(() => setShown((n) => Math.min(text.length, n + 2)), 22)
    return () => clearTimeout(id)
  }, [shown, done, text.length])

  const close = () => {
    const a = pendingAction.current
    pendingAction.current = null
    props.onClose()
    if (a) props.onAction(a)
  }

  const choose = (c?: Choice) => {
    props.onCue()
    if (!done) {
      setShown(text.length)
      return
    }
    if (c?.set) updateSave((s) => void (s.flags[c.set!] = true))
    const next = c ? c.next : node.next
    if (next) setNodeId(next)
    else close()
  }

  const submitName = () => {
    const n = name.trim().slice(0, 18)
    if (!n) return
    updateSave((s) => void (s.horse = n))
    setNaming(false)
    setNodeId("pat")
  }

  // keys: 1–4 pick a choice, Enter/Space/E continue, Esc leaves
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (naming) return
      if (e.code === "Escape") {
        e.stopPropagation()
        close()
        return
      }
      const n = Number(e.key)
      if (n >= 1 && n <= choices.length) choose(choices[n - 1])
      else if ((e.code === "Enter" || e.code === "Space" || e.code === "KeyE") && (!done || choices.length === 0)) {
        e.preventDefault()
        choose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  })

  const speaker = npc.id === "horse" ? ctx.save.horse || "Your horse" : npc.name

  return (
    <div className="hud-glass dialogue" role="dialog" aria-label={`Talking with ${speaker}`}>
      <div className="portrait">
        <img src={PORTRAITS[npc.key]} alt="" />
      </div>
      <div className="dialogue-body">
        <div className="speaker">
          <b>{speaker}</b>
          <span>{npc.title}</span>
        </div>
        <p className="line" onClick={() => !done && setShown(text.length)}>
          {text.slice(0, shown)}
          {!done ? <span className="caret">▌</span> : null}
        </p>
        {naming ? (
          <form
            className="name-form"
            onSubmit={(e) => {
              e.preventDefault()
              submitName()
            }}
          >
            <input autoFocus maxLength={18} value={name} onChange={(e) => setName(e.target.value)} placeholder="A good name…" />
            <button type="submit" className="text-button">
              Name
            </button>
          </form>
        ) : done ? (
          <ol className="choices">
            {choices.length ? (
              choices.map((c, i) => (
                <li key={i}>
                  <button type="button" onClick={() => choose(c)}>
                    <kbd>{i + 1}</kbd> {say(c.label, ctx)}
                  </button>
                </li>
              ))
            ) : (
              <li>
                <button type="button" onClick={() => choose()}>
                  <kbd>E</kbd> {node.next ? "Continue" : "Farewell"}
                </button>
              </li>
            )}
          </ol>
        ) : null}
      </div>
    </div>
  )
}
