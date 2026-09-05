# Nuzlocke Log — onboarding

A single-file PWA for tracking Nuzlocke runs. Two games are wired up:
Pokémon Emerald (complete) and Pokémon Renegade Platinum (in progress).

---

## ⚠️ READ THIS FIRST: the source data lives in a SEPARATE repo

The Renegade Platinum encounter/trainer data is extracted from a
spreadsheet that is **not in this repo**. It lives in
**`frogdrums/poke-docs`**, along with the extraction tooling and the
long-form workspace CLAUDE.md.

If you are a cloud / web / fresh-clone session, attach and clone it
before doing any data work:

```
add_repo frogdrums/poke-docs
git clone --depth 1 https://github.com/frogdrums/poke-docs /home/user/poke-docs
```

What you get:

| Path in `poke-docs` | What it is |
| --- | --- |
| `Renegade Platinum References/Pokemon Renegade Platinum - Documentation.xlsx` | **The source of truth** for encounters, trainers, items, TMs, gifts. |
| `tools/EXTRACTION_GUIDE.md` | **Read this in full before touching the sheet.** Column offsets, layout quirks, the date-mangling gotcha, target JSON shapes. |
| `tools/dump_region.py` | Compact non-empty-cell dumper. `python3 dump_region.py "<xlsx>" ENCOUNTERS --find "ROUTE 208" --context 30` |
| `tools/extract_with_ollama.py`, `Modelfile.qwen3.8-tuned`, `qwen3.8-experience-notes.md` | The local-LLM extraction pipeline and notes on how well it worked. |
| `tools/output/` | Prior extraction attempts. Grade before trusting. |
| `CLAUDE.md` (999 lines) | The full workspace onboarding doc. |
| `nuzlocke-pwa/` | A **byte-identical copy of this repo's app**. See "Two copies of the app" below. |

`openpyxl` is not preinstalled — `pip install openpyxl`.

### Things that will bite you

- **`calc/rp-data.js` is trainer sets only.** It contains no wild
  encounter tables. Don't go looking there for them.
- **General outbound egress is blocked.** `docs.google.com`, the RP wiki
  at `fredericdlugi.github.io`, and `nuzlocke.app` all 403 at CONNECT.
  The xlsx in `poke-docs` is your only source; there is no web fallback.
- **From the Fantina split sheet onward, cells are formulas, not
  values.** `ROARK SPLiT` holds literal numbers, but later sheets use
  custom functions (`=MONHP(F22)`, `=MONABILITY(...)`, `=MOVEBP(...)`).
  Load with `openpyxl.load_workbook(path, data_only=True)` to get cached
  results — and note the cached strings carry an invisible **U+180E**
  (Mongolian vowel separator) that must be stripped: a raw read returns
  `'65\u180e'`, not `'65'`. This affects trainer extraction, not
  encounters.
- **Never infer a species or level from stats.** This romhack rebalances
  stats, abilities and movesets, so a stat block matching a vanilla
  Pokémon is evidence of nothing. A past run hallucinated "Snubbull"
  exactly this way. If a cell is not literally in the dump, emit `null`
  and flag it — do not pattern-match from training knowledge.

### Two copies of the app

`poke-docs/nuzlocke-pwa/index.html` and this repo's `index.html` are
currently **byte-identical**. Which one is canonical has not been
confirmed with the human — check before editing, and if you change one,
say plainly whether the other was updated too. Divergence here is a
silent trap.

---

## Repo layout

| Path | What it is |
| --- | --- |
| `index.html` | The entire app — markup, CSS, and all data tables, in one file. ~463 KB. |
| `calc/` | Vendored [Pokémon damage calculator](https://github.com/smogon/damage-calc), plus romhack profiles under `calc/mechanics/romhacks/`. |
| `calc/rp-data.js` | `window.RP_BACKUP_DATA` — Renegade Platinum **trainer** sets (~4.6 MB JSON). Not encounters. |
| `calc/rp-adapter.js` | Bridges `RP_BACKUP_DATA` into the calculator. |
| `sw.js`, `manifest.json`, `icon-*.png` | PWA shell. |

There is no build step and no test suite. `index.html` is the deliverable.

---

## Data model

All game data lives in `index.html` inside one IIFE, as `var` tables
named `<GAME>_GUIDE`, `<GAME>_BOSSES`, `<GAME>_TIPS`, and so on. The
**game registry** (`var GAMES`, ~line 4105) bundles each game's tables
with its per-game UI labels; `GAME_ORDER` controls the picker order.

### Adding a new game

Duplicate a `*_GUIDE` / `*_BOSSES` / `*_TIPS` / `*_CHEATS` / `*_EV_SPOTS`
set, add a `GAMES` entry, and push its id onto `GAME_ORDER`. No render or
UI code needs to change — `renderChecklist`, `renderGuide` and friends all
read through `currentGame()`.

### Encounter guide schema

`RENEGADE_GUIDE` (~line 1537) is an array of locations in story order:

```js
{ name: "Route 201", encounters: [
  {sp:"Starly", m:"Grass", lv:"4-5"},
  {sp:"Pidgey", m:"Grass", lv:"4", t:"MD"},
  {sp:"Magikarp", m:"Rod", lv:"—", tier:"OG"}
]}
```

| Field | Meaning |
| --- | --- |
| `sp` | Species name. |
| `m` | Method — `Grass`, `Surf`, `Cave`, `Rod`, `Poké Radar`, `Honey Tree`, `Gift`, `Static (event)`. Locations render grouped by this. |
| `lv` | Level or range as a string; `"—"` when the sheet gives none. |
| `t` | *Optional.* Time-of-day restriction, letters from `MDN` (Morning/Day/Night). **Omit entirely** when the species is available all day — it exists only to mark exceptions. |
| `tier` | *Optional.* Which rods a fished species bites on, letters from `OGS` (Old/Good/Super). |

Two conventions worth not rediscovering:

- Rod species are **one `Rod` method group per location**, with `tier`
  per species — not three separate Old/Good/Super Rod groups. The sheet
  has no per-species level for these, hence `lv:"—"`.
- Locations with **no wild encounter table at all** (Sandgem Town,
  Jubilife City, Oreburgh City, Oreburgh Gym) are **omitted** from the
  guide rather than listed with an empty species array.

`guideComplete` on the `GAMES` entry flips the Checklist header between
"All N locations" and "N locations extracted so far".

### Reading the ENCOUNTERS sheet

The authoritative reference is **`poke-docs/tools/EXTRACTION_GUIDE.md`**
— read that, not this summary, before extracting. The headlines:

- The sheet is **not one vertical list**. It's a grid of location blocks
  read top-to-bottom within a ~7-column band, then left-to-right to the
  next band. A location's position on the sheet does **not** track its
  story position.
- **Standing "search for clones" rule.** A route can legitimately appear
  more than once on the sheet, each occurrence gated behind something
  like Surf — so a low-level partial table in one place can be correct
  for now while a high-level table elsewhere is the same route later.
  Before excluding a route on data-quality grounds, full-sheet search
  every occurrence of its name. Routes 218/219 were excluded from the
  Roark split only after that search turned up nothing but a level 38–39
  table and no matching low-level Grass table.
- **Sanity-check against the level curve.** Ravaged Path (6–8) and Route
  207 (9–10) were confirmed as real Roark-split locations this way; they
  have no trainer battles, so they never surfaced from scanning the
  `ROARK SPLiT` sheet's location headers.

---

## Current status (2026-09-05)

- **Emerald** — complete. 88 locations, `guideComplete: true`.
- **Renegade Platinum** — `RENEGADE_GUIDE` has **10 locations**,
  Twinleaf Town → Oreburgh Mine. That is the **Roark split only**
  (gym 1). `guideComplete: false`.
- `RENEGADE_BOSSES` is filled in well past that point; the *encounter
  guide* is the part that stops at Roark.

### Open work

**Gym order in this romhack is not vanilla.** The workbook's split sheets
run **ROARK → GARDENiA → FANTINA → MAYLENE**: Fantina is the *third* gym
(Hearthome), not Maylene. Level caps come straight off each split sheet:

| Split | Gym | Cap |
| --- | --- | --- |
| `ROARK SPLiT` | 1 — Oreburgh | 16 |
| `GARDENiA SPLiT` | 2 — Eterna | 26 |
| `FANTINA SPLiT ` | 3 — Hearthome | 33 |
| `MAYLENE SPLiT ` | 4 — Veilstone | — |

(Note the trailing spaces in some sheet names, and the lowercase `i` in
`SPLiT`, `TRAiNERS`, `GARDENiA` — they are literal.)

Extending the encounter guide **through gym 3** means these locations
after Oreburgh Mine, in the story order the split sheets themselves give:

*Gardenia split* — Route 204 (North), Floaroma Town, Floaroma Meadow,
Valley Windworks, Route 205 (South), Eterna Forest, Route 205 (North),
Eterna City, Route 211 (West), Route 211 (East), Mt. Coronet (Route 216
Entry), Route 216. Old Chateau is not on the split sheet but may have its
own ENCOUNTERS table — check.

*Fantina split* — Route 206 (Cycling Road), Route 206 (Lower Path),
Wayward Cave, Route 208, Hearthome City. Route 207 is already shipped
from the Roark split at levels 9–10; check for a later-state clone.

Locations that are towns/buildings with no grass or water tiles get
omitted from the guide entirely rather than shown empty.

Longer term the human wants a real **local-LLM extraction pipeline**
(`poke-docs/tools/extract_with_ollama.py`). For a ~18-location job,
dispatching Claude subagents per split is cheaper; the pipeline is worth
building for the remaining five gyms, not for this.

---

## Working conventions

- **Commits are deploys.** Messages here read `Deploy: <what changed>`.
  Pushing to `main` is what ships.
- **Anything a fresh session needs must be committed.** This whole file
  exists because the onboarding doc, the source data, and the tooling
  all lived one directory up, outside git — so every cloud session
  started blind and re-derived the same dead ends. If you learn
  something a future session would need, write it in *here*, in the
  repo, not in a parent-directory note.
- **Prefer a live check over a remembered rule.** Run `git ls-files` or
  `git branch -av` rather than trusting a written inventory — including
  the one above.
- **Verify extracted data before trusting it.** A subagent's (or a local
  model's) confident "done, all correct" is not the same as it being
  correct. Spot-check rows against the sheet and against the level
  curve. Weaker models get *more* scrutiny, not less.
