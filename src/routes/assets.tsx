import { Link, createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import library from "@/game/library.json"

/**
 * Asset library gallery: every generated sprite for the game and story,
 * grouped by category. Images live in /public/sprites/library/<category>/.
 */
export const Route = createFileRoute("/assets")({
  head: () => ({ meta: [{ title: "Winterfell — Assets" }] }),
  component: AssetsPage,
})

type Asset = (typeof library)[number]

const CATEGORIES: { id: string; label: string }[] = [
  { id: "creatures", label: "Mounts & animals" },
  { id: "people", label: "People" },
  { id: "enemies", label: "Enemies" },
  { id: "props", label: "Story props" },
  { id: "nature", label: "Nature" },
  { id: "items", label: "Item icons" },
]

const src = (a: Asset) => `/sprites/library/${a.category}/${a.name}.png`

function AssetsPage() {
  const [filter, setFilter] = useState<string | null>(null)
  const [bg, setBg] = useState<"grass" | "dusk" | "checker">("grass")
  const [open, setOpen] = useState<Asset | null>(null)
  const bgClass =
    bg === "grass"
      ? "bg-[#3e5a36]"
      : bg === "dusk"
        ? "bg-gradient-to-b from-[#3a2870] to-[#f07ea0]"
        : "bg-[length:16px_16px] bg-[conic-gradient(#2a2833_25%,#3f3c4a_0_50%,#2a2833_0_75%,#3f3c4a_0)]"

  return (
    <div className="pixel-ui min-h-svh bg-[#0f0d1c] p-4 text-[#c9c6e8] sm:p-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl tracking-[0.2em] text-[#e8a040] uppercase">Asset library</h1>
          <p className="text-sm text-[#a19dab]">
            {library.length} sprites for the road ahead · <Link to="/" className="underline">back to the game</Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          {(["grass", "dusk", "checker"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBg(b)}
              className={`border px-2 py-1 capitalize ${bg === b ? "border-[#e8a040] text-[#f6d27a]" : "border-[#2e2a5c]"}`}
            >
              {b}
            </button>
          ))}
        </div>
      </header>

      <nav className="mb-5 flex flex-wrap gap-1 text-xs">
        <Chip active={filter === null} onClick={() => setFilter(null)}>All</Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
            {c.label}
          </Chip>
        ))}
      </nav>

      {CATEGORIES.filter((c) => !filter || c.id === filter).map((c) => {
        const items = library.filter((a) => a.category === c.id)
        return (
          <section key={c.id} className="mb-8">
            <h2 className="mb-2 text-sm tracking-widest text-[#8a83c2] uppercase">
              {c.label} <span className="text-[#5a5666]">({items.length})</span>
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {items.map((a) => (
                <button
                  key={a.name}
                  onClick={() => setOpen(a)}
                  className="group border-2 border-[#2e2a5c] bg-[#171530] text-left hover:border-[#6a62a6]"
                >
                  <div className={`flex aspect-square items-center justify-center p-2 ${bgClass}`}>
                    <img
                      src={src(a)}
                      alt={a.description}
                      loading="lazy"
                      className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
                    />
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="truncate text-xs text-[#f6d27a]">{a.name}</p>
                    <p className="truncate text-[11px] text-[#7a7686]">{a.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )
      })}

      {open ? (
        <div
          className="fixed inset-0 z-10 grid place-items-center bg-[#07060d]/85 p-4"
          onClick={() => setOpen(null)}
        >
          <div className="max-h-full w-full max-w-xl border-2 border-[#3d3873] bg-[#0f0d1c] p-3" onClick={(e) => e.stopPropagation()}>
            <div className={`flex h-[60vh] items-center justify-center p-4 ${bgClass}`}>
              <img src={src(open)} alt={open.description} className="max-h-full max-w-full object-contain [image-rendering:pixelated]" />
            </div>
            <div className="mt-2 flex items-start justify-between gap-2 text-sm">
              <div>
                <p className="text-[#f6d27a]">{open.category}/{open.name}</p>
                <p className="text-xs text-[#a19dab]">{open.description}</p>
                <code className="text-[11px] text-[#7a7686]">{src(open)}</code>
              </div>
              <button onClick={() => setOpen(null)} className="border border-[#2e2a5c] px-2 py-1 text-xs">
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Chip(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className={`border px-2 py-1 ${props.active ? "border-[#e8a040] bg-[#2e2a5c] text-[#f6d27a]" : "border-[#2e2a5c] hover:border-[#6a62a6]"}`}
    >
      {props.children}
    </button>
  )
}
