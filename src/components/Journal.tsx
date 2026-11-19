import { useEffect, useState } from "react"
import { NPCS } from "@/game/npcs"
import { LANDMARKS } from "@/game/regions"
import { loadSave, onSaveChange } from "@/game/save"
import { PORTRAITS } from "@/components/Dialogue"

type Tab = "people" | "places" | "verses"

/** A pixel journal of the people you've met, the places you've found and the verses from your camps. */
export function Journal(props: { isFound: (id: string) => boolean; onClose: () => void; onCue: () => void }) {
  const [tab, setTab] = useState<Tab>("people")
  const [, force] = useState(0)
  useEffect(() => onSaveChange(() => force((n) => n + 1)), [])
  const save = loadSave()
  const people = NPCS.filter((n) => (save.met[n.id] ?? 0) > 0)
  const pick = (t: Tab) => {
    props.onCue()
    setTab(t)
  }

  return (
    <div className="pause-veil" onClick={props.onClose}>
      <div className="hud-glass journal" onClick={(e) => e.stopPropagation()}>
        <div className="journal-head">
          <div>
            <span className="eyebrow">THE KNIGHT'S JOURNAL</span>
            <h2>{save.horse ? `Travelling with ${save.horse}` : "Travelling alone, for now"}</h2>
          </div>
          <button type="button" className="text-button" onClick={props.onClose}>
            Close
          </button>
        </div>
        <nav className="journal-tabs">
          {(["people", "places", "verses"] as const).map((t) => (
            <button key={t} type="button" className={`text-button ${tab === t ? "is-on" : ""}`} onClick={() => pick(t)}>
              {t === "people" ? `People · ${people.length}` : t === "places" ? `Places · ${LANDMARKS.filter((l) => props.isFound(l.id)).length}/${LANDMARKS.length}` : `Verses · ${save.verses.length}`}
            </button>
          ))}
        </nav>
        <div className="journal-page">
          {tab === "people" ? (
            people.length ? (
              people.map((n) => (
                <article key={n.id} className="entry">
                  <img src={PORTRAITS[n.key]} alt="" className="entry-portrait" />
                  <div>
                    <b>{n.name}</b> <span className="muted">{n.title}</span>
                    {(save.notes[n.id] ?? ["We spoke for a while."]).map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <p className="muted">Nobody yet. People walk this road too, if you look for them.</p>
            )
          ) : tab === "places" ? (
            LANDMARKS.map((l) => (
              <article key={l.id} className="entry">
                <span className={`gem ${props.isFound(l.id) ? "on" : ""}`} />
                <div>
                  <b>{props.isFound(l.id) ? l.name : "???"}</b>
                  <p>{props.isFound(l.id) ? l.line : "Somewhere in the valley."}</p>
                </div>
              </article>
            ))
          ) : save.verses.length ? (
            save.verses.map((v) => (
              <article key={v} className="entry verse">
                <p>{v}</p>
              </article>
            ))
          ) : (
            <p className="muted">Make camp and rest a while. Verses come to people who sit still.</p>
          )}
        </div>
      </div>
    </div>
  )
}
