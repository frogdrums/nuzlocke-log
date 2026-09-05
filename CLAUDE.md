# Nuzlocke Log — onboarding

A single-file PWA for tracking Nuzlocke runs. Two games are wired up:
Pokémon Emerald (complete) and Pokémon Renegade Platinum (in progress).

---

## ⚠️ READ THIS FIRST: the source data is NOT in this repo

The Renegade Platinum encounter/trainer data is extracted from:

    Pokemon Renegade Platinum - Documentation.xlsx

That spreadsheet, the extraction `tools/`, and the original long-form
CLAUDE.md all live in the **parent directory of this repo** — the
workspace folder that *contains* `nuzlocke-log/`. Source comments refer
to them as `../CLAUDE.md` (see `index.html` around lines 1487 and 4098).

**None of it is tracked by git.** Verified on 2026-09-05:

- `git ls-tree -r origin/main` → only `index.html`, `sw.js`,
  `manifest.json`, three icons, and `calc/`. No `tools/`.
- `git log --all --diff-filter=D --name-only` → `tools/` has never
  existed on any branch, in any commit.
- `find / -name "*.xlsx"` in a fresh clone → nothing.

### What this means for you

If you are a **cloud / web / fresh-clone session**, you do not have the
spreadsheet and you cannot get it:

- General outbound egress is blocked by the network proxy. `docs.google.com`,
  `fredericdlugi.github.io` (the RP wiki) and `nuzlocke.app` all return
  403 at CONNECT. Subagents run in the same container and hit the same wall.
- `calc/rp-data.js` is **trainer sets only** — it contains no wild
  encounter tables. Don't go looking there for them.

So: **do not write encounter data from model knowledge.** This is a
rebalance romhack; recalled vanilla-Platinum tables are wrong, and wrong
encounter data silently corrupts someone's actual Nuzlocke run. If you
have no source, say so and stop — that is the correct outcome, not a
failure.

To unblock a fresh session, the human must do one of:

1. **Commit the source into this repo** (preferred — it is the only fix
   that makes the problem stop recurring). Add the xlsx and `tools/`,
   or at minimum a text/CSV export of the `ENCOUNTERS` sheet.
2. Paste the relevant raw sheet rows into the session.
3. Add the RP wiki host to the environment's network egress allowlist.

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

Recorded here from the source comments, since the sheet itself isn't
committed:

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

Extending the encounter guide to **gym 3 (Maylene, Veilstone)** needs
roughly these locations, in story order, after Oreburgh Mine:

> Route 204 (North), Valley Windworks, Route 205 (South), Eterna Forest,
> Old Chateau, Eterna City, Route 205 (North), Route 206, Wayward Cave,
> Route 208, Mt. Coronet (South), Hearthome City, Route 209, Lost Tower,
> Solaceon Town, Solaceon Ruins, Route 210 (South), Route 215,
> Veilstone City

Route 207 is already done. **Blocked** on the source spreadsheet
reaching the session — see the top of this file.

Longer term the human wants a real **local-LLM extraction pipeline** for
this (that's what the un-committed `tools/` is). For a job this size,
dispatching Claude subagents per location block is the cheaper path;
the pipeline is worth building for the remaining ~5 gyms, not for 18
locations.

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
