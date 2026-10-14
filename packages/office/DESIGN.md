# Office theme · design v2

`/office` shows the board's facts as rooms and people, with the readability of a good
management sim and none of its HUD. v1 drew a side view in one row; on real data it read
as a bar chart of identical grey silhouettes. v2 changes the camera, the people and the
labels, and keeps everything that already works: the `Posture` contract in
`themes/posture.ts`, stable seating, the calm budget, tooltip, keyboard, legend.

**Why 3/4 is both more legible and calmer than side view.** Side-on, every seated figure is
the same outline, so state can only be shown by colour and small props, which pushes the
drawing toward more colour and more props. From the front and a little above, each posture
moves the *head* to a different place (forward, high, back, down, absent), which the eye
reads at any size with no colour at all; the pods, aisles and walls give the row a
structure the eye walks through instead of counting along. So the view can be greyer, with
fewer marks and fewer movements, and still say more. More legibility per ink, which is the
minimal taste applied, not abandoned.

**Changed from v1**: camera (§1), character look (§2), postures (§3), nameplates (§4),
side tables for helpers (§5), clock + one plant (§6), breathing removed (§7).

## 1. Camera, pods, room

**Projection: front-above, 2:1, no isometric math.** The camera looks at the room from
the front wall, slightly above. Every object is drawn as its **front face** at full height
plus its **top face** at half its real depth, as a rectangle stacked above the front face,
one shade lighter. x is x; a thing 1 px further back is 0.5 px higher on screen. Paint
back to front: back wall, back row, aisle, front row, front wall. Figures sit **facing the
window wall**, seen from behind at a 3/4 turn to the right: back of the head, right shoulder
and right arm visible. The one cheat, the same one every management sim makes: the screen
is drawn straight on, as if it faced us, so it can show its state.

```
 misha-air  Cl 2.1.290 · Cx 0.157.1  ●online
┌────────────────────────────────────────────────── back wall ──────────┐
│  ░░░░░░░░░ window ░░░░░░░░░                                  (clock) │
│                                                                       │
│   ┌desk┐ ┌desk┐        ┌desk┐ ┌desk┐                 ← back row       │
│    chair  chair          chair  chair                                 │
│    name   name           name   name                                  │
│                                                                       │
│   ┌desk┐ ┌desk┐        ┌desk┐ ┌desk┐        ┌desk┐ ┌desk┐  ← front   │
│    chair  chair          chair  chair         chair  chair            │
│    name   name           name   name          name   name             │
│  ── front aisle, figures walk here ─────────────────────────── plant │
└───╷    ╷──────────────────────────────────────────── front wall ──────┘
   door   4 home
```

- **Cell** 160 × 128 px, fixed at every viewport. **Pod** = 2 cells side by side, desks
  touching; a 4-pod is two 2-pods, one row behind the other. Aisle 16 px between pods,
  24 px between rows (room for the back row's nameplates above the front row's lamps).
  Room padding 12 px; back wall strip 28 px tall; front aisle 24 px.
- **Desk** 112 wide × 28 deep → top face 14 tall (`--bg-4`), front face 10 tall
  (`--bg-3`, 1 px `--line-2` edge). Monitor on the far-left of the top: screen 24 × 16
  with a 2 px bezel (`--fg-4`), a 6 px foot. Keyboard a 28 × 4 bar centred. **Desk mat**
  20 × 6 under the keyboard in the harness hue (`oklch(0.7 0.06 hue)`, dark: `0.5`): the
  harness object. **Mug** 5 × 6 at the desk's right end, `--fg-4`, always present. Lamp
  on an arm at the right of the monitor, shade 12 × 5, `--fg-4` off / `--needs` on.
- **Chair** in front of the desk: seat 14 × 7 (top face), back 14 × 12 rounded,
  `--fg-4`, drawn *over* the figure's lower back. Casters as 3 dots.
- **Pods per row**: `min(3, ceil(liveDesks / 2))` on desktop, `1` at ≤ 480 px. Rows as
  needed, max 3 (18 desks); beyond, the nameplate gains `+n more` (Board, machine
  filter). An empty room shows one pod of two empty desks.
- **Seating** (`useSeating`): slot 0 is the front-left desk; slots run along the front
  row, then the row behind. A session takes the lowest free slot when first seen alive and
  keeps it; a slot holding an empty chair (§3 `gone`) counts as free. Mirrored to
  `sessionStorage`.
- **Door** an 18 px gap in the front wall at x = 16, jamb lines 1 px. **Tally** `4 home`
  outside the wall beside it (`--fg-3`). **Clock** on the back wall, right, §6. **Plant**
  inside the front-right corner, §6.
- **Walk path**: in through the door onto the front aisle, along it to the pod's left
  aisle, up to the row, two steps right to the chair. Out is the reverse. Walkers are
  painted by their current y so they pass behind front desks.
- **Phone (390 px)**: rooms stack; one pod (320 px) per row, so a room is a column of
  pods; the back wall is a 16 px strip with the window band; the clock moves into the
  nameplate line as text (`14:02`); the tally sits inside the room, bottom-right. No
  horizontal scroll. Tap target = the whole cell.

## 2. People

Each session gets one look, fixed for its life, from `fnv1a(session.id)`: no two
neighbours are likely to match, nobody changes clothes mid-day.

| part    | choices                                                         | bits |
|---------|-----------------------------------------------------------------|------|
| shirt   | 6 muted tones: `oklch(0.58 0.05 h)` for h ∈ {20, 80, 150, 220, 280} and `oklch(0.42 0 0)`; dark scheme L + 0.1 | 3 |
| hair    | 4 silhouettes seen from behind: cropped (follows the head), side-swept (one side 2 px wider), tied back (a 4 px bun below the crown), curly cap (head radius + 1.5, scalloped) | 2 |
| hair colour | `oklch(0.28 0.02 60)` or `oklch(0.62 0.05 75)`                 | 1 |
| skin    | `oklch(0.82 0.05 60)` or `oklch(0.5 0.06 50)` (neck and hands only) | 1 |
| glasses | 1 in 4: a 1 px `--fg` temple line from the ear to the head's front edge | 2 |

Figure 24 px tall seated (30 standing): head 7 px circle; neck 2 px of skin; torso a 14 ×
11 rounded block in the shirt tone, the right shoulder 2 px wider than the left (the 3/4
turn); right arm a 2 px line to the keyboard, hand a 3 px skin dot; legs hidden by the
chair. **No face**: the head is hair over skin and nothing else, and we see its back.
Harness is the desk mat (§1) and the monogram on the bezel; never on the person.

## 3. Postures

Head position is the primary signal; everything else confirms it.

| state / phase | figure                                                           | screen (`Posture.screen`) | lamp | bubble |
|---------------|------------------------------------------------------------------|-----------|------|--------|
| `working`     | **leaning in**: torso rotated 10° forward, head 2 px lower and over the desk edge, both hands on the keyboard | `lit`: `--work` fill, 3 code lines (§7) and the tool name | off | none |
| `needs_you`   | **standing beside the chair**, 30 px tall, 10 px into the aisle, right arm raised 60°, turned to face the door | `dim`: `--work-bg`, no text | **on** | `ATTENTION_LABEL[kind]` on `--needs-bg`, pointing at the head |
| `idle`        | **leaning back**: torso −10°, head 2 px higher and 3 px behind the chair line, right hand holds the **mug** at shoulder height (the desk mug disappears) | `off`: `--bg-4` | off | none |
| `stale`       | **head down on the desk**: head circle rests on the desk's front edge, torso 45° forward, arms on the desk top; a single 9 px `z` in `--fg-4` 6 px above the head, static | `off` | off | none; elapsed under the chair |
| `gone` (done) | no figure; chair **pushed in** (seat hidden under the desk, back shows above the desk front); nameplate kept at `--fg-4` | `off` | off | none |
| `arriving`    | walking the aisle, legs 2 frames, shirt and hair already its own; sits on arrival | `off` until seated | off | none |
| `leaving`     | stands, walks out, fades at the jamb                             | `off` from the first frame | off | none |

```
 working        needs_you         idle            stale           gone
 ┌──┐ lit        ┌──┐ dim  ●      ┌──┐ off        ┌──┐ off        ┌──┐ off
 │≡≡│            │  │   o/        │  │            │  │  z         │  │
 └Cl┘            └Cl┘   |         └Cl┘            └Cl┘            └Cl┘
 ═══o═══ head    ═══════ chair    ══════  ○▫ mug  ═══o═══ head    ═══════
   ▟█▙ forward     ▐█▌ empty        ▜█▛  back       ▄█▄  down       ▐▌ chair in
```

- **Empty chairs are capped**: at most one `gone` desk per pod. A second `done` in the
  same pod frees the older one to the tally at once; any `gone` desk is also freed after
  30 min, or the moment an arrival needs its slot. The tally counts every `done` of the
  day; the chair is only the recent ones.
- **Reading-distance test**: render the five rows above at 24 px, `--fg-2` on `--bg-2`,
  no colour, no props. Head forward / head high and arm up / head back / head on the
  desk / no head must each be namable by someone who has not seen the legend. Then add
  colour and check one lamp is findable at 2 m across a room of 18 desks.
- **Priority**: `--needs` amber exists only on a `needs_you` lamp and bubble; `--work`
  only on a lit screen; walls, floors and figures never tint by state. A standing figure
  is also the tallest thing in the room, so needs_you wins the eye in greyscale too.

## 4. Nameplates

A two-line floor label in front of each chair, 156 px wide, left-aligned to the cell.

- Line 1: `sessionTitle(s)`, 11 px `--font-ui` `--fg`, up to **26 characters**; if longer,
  it wraps to line 2 and ends with an ellipsis there (~52 characters in all).
- Line 2 (only when the title fit on one line): `repoBranch(s)`, 10 px `--font-mono`
  `--fg-3`, `cutLeft(…, 26)` so the branch end survives. When the title took both lines,
  repo @ branch lives in the tooltip only.
- `gone` desks keep their label in `--fg-4`. Helpers (§5) have no label; their title is
  in the tooltip.
- Measure with `ch` units against the mono line (26ch) and clamp the UI line by
  `max-width: 156px; -webkit-line-clamp: 2`: no measuring code.

## 5. Helpers (subagents)

```
 ┌desk───────────────┐ ┌side┐
 │ [screen]  ▂▂  mug │ │ ▭  │   ← laptop lid, lit when working
 └───────────────────┘ └────┘
        chair              stool + helper, 18 px
```

A parent with live children (`Posture.helpers`) gets a **side table** 36 × 20 at the right
end of its desk, inside the cell: top face `--bg-4`, front `--bg-3`. One helper sits at it
on a stool, 18 px tall, its own look from its own `session.id`, with a **laptop** (lid 12 ×
8) instead of a monitor. A second helper sits at the far side of the same table, half
hidden behind the first; more become a `+n` numeral on the table (`MAX_HELPERS = 2`,
`hiddenHelpers` as today). A helper uses the §3 postures at its own state: working
leans in and **types** with a lit lid (so a live helper is visibly working); needs_you
stands with the arm raised and its own small lamp; idle leans back; stale head down.
No side table when there are no live helpers; `children` with no live summaries shows
only the numeral on the desk's right corner.

## 6. Ambience

- **Wall clock**: 16 px, on the back wall at the room's right, `--fg-4` ring, `--fg-2`
  hands; the viewer's local time; the minute hand steps once a minute, no seconds hand, no
  sweep. On phone it is text in the nameplate line.
- **Window**: a flat band on the back wall, 60 % of the room width, tinted by `hourBand`:
  morning `oklch(0.93 0.02 230)`, day `oklch(0.95 0.015 85)`, evening `oklch(0.88 0.05
  60)`, night `oklch(0.3 0.03 250)`; dark scheme: L × 0.6 except night. 60 s transition at
  a boundary. No sun, sky, gradient or stars.
- **Plant**: one per room, in the front-right corner, 14 px, two leaf shapes in
  `oklch(0.6 0.06 150)` on a `--fg-4` pot. Static. It is the single thing on the page
  that carries no fact; it is there so the room reads as a room, and there is only one.
- Nothing else is drawn, and nothing else ever moves.

## 7. Motion

The whole vocabulary. **Loops: typing and screen lines, on working figures only.**
Breathing is gone (v1 had it on idle; it added motion to the very figures that should be
still). Everything else plays once.

| name        | what                                                   | timing              | easing                  | plays |
|-------------|--------------------------------------------------------|---------------------|-------------------------|-------|
| typing      | hands up / down 1 px, 2 frames                         | 2 Hz                | `steps(2)`              | loops while `Posture.typing` |
| screen lines| 3 lines of lengths 14 / 9 / 11 px, 1 px, `--bg` at 60 % on the lit screen, shift up one line and a new one enters at the bottom | 1 line / 1.5 s | `steps(1)` | loops while `screen === "lit"` |
| hand raise  | arm 0° → 60°, figure rises from chair and steps 10 px aside | 240 ms up, 180 ms down | `--ease-out` / `--ease-in` | once per needs_you enter / exit |
| walk        | along the path of §1; legs 2 frames                    | 900 ms total, legs 4 Hz | linear, legs `steps(2)` | once per arrive / leave |
| sit / stand | 4 px drop onto the chair / rise                        | 200 ms              | `--ease-out`            | once |
| mug         | mug moves desk ↔ hand                                  | 200 ms              | `--ease-out`            | once per idle enter / exit |
| head down   | head slides onto the desk                              | 300 ms              | `--ease-in`             | once on stale |
| bubble pop  | `scale(0.8)→1`, opacity 0 → 1                          | 160 ms              | `--ease-out`            | once per `attentionId` |
| lamp        | opacity                                                | 300 ms on, 600 ms off | linear                | once |
| screen      | crossfade fill and text                                | 120 ms              | linear                  | once per change |
| chair in    | chair slides 6 px under the desk, figure already gone  | 300 ms              | `--ease-in`             | once on gone |
| sheet       | new error sheet drops 3 px                             | 200 ms              | `--ease-out`            | once per rise |
| clock       | minute hand steps                                      | instant             | —                       | once a minute |

- `Posture.typing` = `progress.assistant` grew in the last 3 s. A running tool shows on
  the screen with still hands; the lines keep scrolling. Writing and running stay
  distinguishable without a word.
- Typing offsets `(slot % 4) × 125 ms`; screen lines offset `(slot % 3) × 500 ms`.
- **Calm budget** (`MAX_WALKS = 6`, `MAX_TYPING = 12`): arrivals past the walk budget
  fade in seated after 2 s; past the typing budget the oldest typers hold hands on keys
  and their screen lines freeze. Priority: hand raise › walk › typing › screen lines.
  Eighteen desks in a room must look like a quiet floor.
- CSS animations on `transform` / `opacity` only; one `useNow()` tick a second for
  numerals, one a minute for the clock. `document.hidden` pauses every loop.
- **`prefers-reduced-motion`**: no walks (200 ms fade in place), no typing, no screen
  lines (three static lines), no bubble pop, sheet or mug travel; lamp, screen and chair
  switch instantly. Raised arm, mug in hand and head down are static poses and stay.

## 8. Facts on the desk

- Monogram `harnessMark(s.harness).glyph` on the bezel, 9 px, `oklch(0.55 0.1 hue)`.
- Tool name on the lit screen, 9 px mono `--bg`, `screenText(tool, 5)`; full in tooltip.
- Errors as sheets at the desk's left corner, `sheets(toolErrors)`: 1 for 1–2, 2 for 3–5,
  3 for 6+, `--fg-4`. No red.
- Long-running tool: `elapsedMs > 60 s` → `durShort` under the chair, `--fg-3`, 1 Hz.
- Stale elapsed: time since `stateSince` in the same place.

## 9. Interaction

- **Tooltip** (hover / focus, 150 ms, no animation, `role="tooltip"`): title · harness
  label + `modelShort` · `STATE_LABEL` since `stateSince` · tool + elapsed · attention
  kind + `<Redacted>` message · `repoBranch` · `turns · tools · errors · files ·
  subagents` (zeros omitted). Helpers: the same.
- **Click / Enter** → `sessionPath`. Nameplate line (machine) → `/machines`. Tally,
  clock, window, plant: not interactive.
- **Keyboard**: DOM order = rooms by name, cells by slot, helpers after their parent;
  `j`/`k`/Enter via `useListNav`; `?` toggles the legend, Esc closes it or goes back;
  `/` does nothing here. Focus ring `--focus` 2 px outside the cell.
- **Page header**: the one line of text that exists, `2 need you · 2 working · 3 idle or
  stale`, as built. Document title `(n) Office`.
- **Empty office**: one room `no machines yet`, one pod of empty desks, the clock and
  window live, then the three ways from `EmptyBoard` in one line each and `Open Connect`.
- **Legend** behind `?`: the five postures at 24 px with `STATE_HINT`, then lamp, bubble,
  side table, mug, sheets, mat, monogram, elapsed. The page must read without it.

## 10. What not to do

- No faces: no eyes, mouths, eyebrows, or any expression. We see the back of the head.
- No emoji, icons, logos or stickers; the `z` is one lowercase glyph, static, and the
  only one of its kind.
- No particles, glow, shadow, gradient, texture, or sound.
- No points, levels, streaks, scores, or "best desk".
- No second plant, no posters, no rugs, no coffee machine: one plant, one clock, one
  window, one door.
- No colour outside the tokens and the two look palettes in §2; amber means needs_you
  and nothing else; blue means a lit screen and nothing else.
- No movement outside the §7 table.

## 11. Theme system note

`themes/posture.ts` stays theme-neutral and grows two fields: `look` (`{ shirt, hair,
hairColour, skin, glasses }` from the id hash) and the `gone` phase. Seating, calm
budget, tooltip, keyboard and legend stay shared. A theme exports `{ Room, Cell, Helper,
Legend }` and its drawings. A train yard maps machine → platform, session → carriage,
needs_you → signal lamp, typing → steam, gone → an empty bay; an orchestra maps machine →
section, session → chair, needs_you → raised bow, stale → head on the stand. Same
facts, same motion table, same reading-distance test; only the drawings change.

## 12. Style toggle

`style: "figures" | "plan"`, persisted per device in `localStorage` under
`sessionpipe-gui.office.style` (the `lib/theme.ts` pattern, `useSyncExternalStore`),
default `figures` until the owner picks. A `Segmented` control beside the `?` button:
`figures · plan`. Both styles consume the same `Posture`, `useSeating`, calm budget,
cursor order, tooltip and keyboard; the toggle swaps only `Cell`, `Helper`, `EmptyDesk`
and the room chrome. `Look` is ignored in plan.

## 13. Plan view, a second style

A floor plan, the drawing an architect makes: nothing is foreshortened, so nothing can
squash; the room is lines on paper, not a box. State is **position and one ring**.

```
┌────── window ────────────────────────────────────────────────── ◷ ┐
│  ╭──────────╮ ╭──────────╮        ╭──────────╮ ╭──────────╮      │
│  │ ▬▬   Cl  │ │ ▬▬   Cx  │        │ ▬▬   Cl  │ │ ▬▬   Ge  │  ○   │  ← desks, monitor line, monogram, round table
│  ╰────▂─────╯ ╰────▂─────╯        ╰────▂─────╯ ╰────▂─────╯      │  ← mat at the bottom edge
│     (●)            ●                   ◌             ●  z          │  ← working · needs_you (ring, beside) · gone · stale
│    title          title               title         title         │
│    repo @ br      repo @ br           repo @ br     repo @ br     │
│                                                                 ⊙ │  ← plant
└──╮ )─────────────────────────────────────────────────────────────┘  ← door with swing arc
   4 home
```

**Sizes at 1×** (cell 160 × 108; pods, aisles, rows, seating, nameplates as §1 / §4):
- Desk: rounded rect 112 × 40, r 4, fill `--bg-4`, 1 px `--line-2`. Monitor line 28 × 2
  at 4 px from the top edge, 10 px from the left: `--fg-4` off, `--work` lit, `--work-bg`
  dim. Tool name 9 px mono `--fg-2` under a lit line. Monogram 9 px in the top-right
  corner, harness hue. Mat 20 × 6 centred on the bottom edge, harness hue
  (`oklch(0.7 0.06 h)`, dark `0.5`). Mug a 5 px circle at the right end, `--fg-4`.
  Sheets 6 × 4 at the left end, `--fg-4`, 1–3.
- Chair: 16 × 16 rounded r 6, 1 px `--fg-4` outline, no fill, centred under the desk.
- Person: head 8 px circle `--fg-2` on a shoulder arc, a 16 × 8 ellipse clipped to its
  lower half, `--fg-3`, the head overlapping its top by 3 px. One tone, no hair, no shirt.
- Helper table: 20 px circle `--bg-4` + `--line-2`, in the 48 px to the right of the desk;
  helper = 5 px head + 10 × 4 arc; a 10 × 2 laptop line on the table, lit when working.
  Two seats (top and bottom of the table), then `+n` inside it.
- Room: floor `--bg-2` on the page `--bg`, walls 1 px `--line-2`, no back-wall strip.
  Window: a 4 px line in the top wall, 60 % wide, tinted by `hourBand` (§6). Door: 18 px
  gap in the bottom wall at x = 16 with a quarter-arc swing line r 18, 1 px `--line-2`.
  Clock: §6 glyph at 12 px inside the top-right corner. Plant: 10 px circle
  `oklch(0.6 0.06 150)` inside the bottom-right corner. Tally outside the door.

**Positions** (`pull` = gap between the desk's bottom edge and the chair):

| state / phase | chair + person                                                   | monitor line | ring / bubble |
|---------------|------------------------------------------------------------------|--------------|---------------|
| `working`     | pull 0, head 2 px over the desk edge                              | lit + tool   | none |
| `idle`        | pull 12, person in the chair                                      | off          | none |
| `stale`       | pull 12, person `--fg-4`, a 9 px `z` `--fg-4` 4 px right of the head | off     | none; elapsed under the chair |
| `needs_you`   | chair empty at pull 12; person **beside the desk**, 10 px into the right aisle at the desk's mid-height | dim | **2 px `--needs` ring** at r 7 around the head; bubble above (§3) |
| `gone`        | chair outline only at pull 12, `--line-2`; nameplate `--fg-4`     | off          | none |
| arriving / leaving | the same mark moving along the aisles (§1 path), no chair    | off          | none |

**Colour discipline**: persons `--fg-2` (stale `--fg-4`), desks `--bg-4`, chairs `--fg-4`,
harness hue only on the mat and monogram, `--work` only on a lit line, `--needs` only on
the ring and bubble. Nothing else is coloured; `Look` is not drawn.

**Motion** (adapted from §7; same calm budget and reduced-motion rules):
- typing: the shoulder arc moves 1 px toward the desk, 2 frames, 2 Hz `steps(2)`, loops
  while `Posture.typing`. The lit line does not blink; it is the only loop.
- pull in / out 200 ms `--ease-out`; step beside / back 240 / 180 ms; ring 300 ms on,
  600 ms off; bubble pop 160 ms; walk 900 ms linear along the aisles; chair-only 300 ms
  `--ease-in` on gone; `z`, sheets, line changes instant. Reduced motion: no shrug, walks
  become a 200 ms fade, pulls and steps instant.

**Legend** (`?`): the five marks at 16 px with `STATE_HINT`, then the ring, bubble, mat,
monogram, round table, door arc, window line, clock, plant: one line each.

**Reading-distance test at 16 px**: desk 56 × 20, head 4 px, `--fg-2` on `--bg-2`, no
colour, no text. Five head positions must each be namable by someone who has not seen the
legend: touching the desk (working) · 6 px below it (idle) · 6 px below and fainter, with
the `z` (stale) · beside the desk's right edge (needs_you) · absent, chair only (gone).
Then add colour and confirm one ring is findable at 2 m across 18 desks.

**Phone**: as §1, one pod per row, everything at 1×; the clock becomes text in the
nameplate line; the door arc and plant stay.
