# Canvas

A sessionpipe GUI theme: every live session is a **window** on an infinite canvas. Drag
them anywhere, zoom out to see the whole fleet, double-click one to watch it work. The
layout is kept by the host (`api.storage`) so it is the same on every device; the viewport
is per device (`api.local`).

Experimental: it lives under the "experimental" divider in the GUI's navigation, at `/t/canvas`.

## What it shows

**A window per session** — title bar (state dot, title, `machine · repo @ branch`, `→` opens
the session page, `×` hides the window), a body with what is happening now (the running tool
and how long it has run, the text being written, or the last exchange), the open attention
with **Allow / Deny** links (they go to the session page: control lives there), and a footer
of counts (tools, errors, files, turns, subagents, harness, model). Resize from the corner.

**State** — *needs you* gets an amber hairline and floats above everything. *Working* breathes
and names its tool. *Stale* and *idle* are muted. *Done* windows shrink and slide to a shelf
along the bottom edge (collapsed by default; the count is on it). Subagents are small windows
tethered to their parent by a dashed line; they follow when the parent moves.

**Detail mode** — double-click a title (two taps on a phone, or Enter on a focused window) and
the window grows and streams the session's rows inline: tools with their input hint and
result, turns, files, attentions, the assistant's replies. Double-click again to collapse.

**Placement** — a new session appears in the nearest free space to the centre of what you are
looking at, with a short fade. **Tidy** arranges by state in columns (wrapping when there are
many); **Fit** zooms to show everything; **Reset** forgets the layout; **Zones** draws each
machine as a faint labelled region you can drag and resize, and arranges by machine. Hold
Shift while dragging to snap to an 8 px grid. Hidden windows wait in a tray at the bottom
left and come back when the session changes state.

**Navigation** — drag the empty canvas or scroll to pan; ctrl/⌘ + wheel or pinch to zoom
(25 %–200 %); hold Space to pan from over a window. Keys: `0` fit, `+` / `-` zoom, arrows nudge
the focused window (Shift for bigger steps), `/` find (matches light up, the rest dim; it pans
to the first match if none is on screen), `Esc` clears. The minimap in the corner shows where
you are; click it to jump. On a phone, one finger drags a window or pans, two fingers pan and
zoom, and the windows start as a single column.

## Build, dev, test

```sh
npm run build        # esbuild → dist/index.js (~55 KB) + dist/index.css
npm run dev          # the harness at http://127.0.0.1:7420/harness.html
npm run typecheck
npm test             # Playwright: drag, snap, resize, zoom, tidy, expand, search, placement,
                     # hide/tray, done shelf, subagents, keyboard, phone
```

The harness (`dev/`) mounts the theme against a fake `ThemeApi` with a small world of sessions
in every state on two machines, subagents, and a tick that turns tools over, grows the text,
raises and clears attentions, ends and starts sessions. Query: `?tick=0` freezes it,
`?speed=N`, `?extra=N` adds sessions (try `?extra=50`), `?scheme=light|dark`.

In the real GUI: `sessionpipe-gui theme link <this folder>` and open `/t/canvas`.

## How it is drawn

Plain TypeScript and DOM; nothing from `api.react`. The world is one element with a
`translate3d(...) scale(k)` transform; every window is `position: absolute` with its own
`translate3d`, so pan, zoom and drag never cause layout. One `requestAnimationFrame` applies
whatever changed and is idle otherwise; the elapsed numerals update once a second by setting
text only. Each window re-renders only when a signature of its session changes. The dot grid
is a CSS background whose spacing follows the zoom. Colours are the host's tokens by name, so
dark and light are the host's; `prefers-reduced-motion` removes the fades and slides.

`src/`: `index.ts` (the canvas), `window.ts` (a window), `detail.ts` + `events.ts` (the rows),
`input.ts` (pointer, pinch, wheel, keys), `layout.ts` (placement and tidy), `types.ts`,
`canvas.css`.
