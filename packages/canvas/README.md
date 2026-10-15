# Canvas

A sessionpipe GUI theme: every live session is a **window** on an infinite canvas. Drag
them anywhere, zoom out to see the whole fleet, double-click one to watch it work. The
layout is kept by the host (`api.storage`) so it is the same on every device; the viewport
is per device (`api.local`).

Experimental: it lives under the "experimental" divider in the GUI's navigation, at `/t/canvas`.

## What it shows

**A window per session** — title bar (state dot, title, `machine · repo @ branch`, `→` opens
the session beside the canvas in the host's split panel, morphing out of the window, `×` hides
the window), a body with what is happening now (the running tool
and how long it has run, the text being written, or the last exchange), the open attention
with **Allow / Deny** links (they go to the session page: control lives there), and a footer
of counts (tools, errors, files, turns, subagents, harness, model). Resize from the corner.

**State** — *needs you* gets an amber hairline and floats above everything. *Working* breathes
and names its tool. *Stale* and *idle* are muted. *Done* windows shrink and slide to a shelf
along the bottom edge (collapsed by default; the count is on it). Subagents are small windows
tethered to their parent by a dashed line; they follow when the parent moves.

**The session tree** — a root session's subagents stand in a column to its right, each a
small live window of its own (state dot, the tool it is on and for how long, what it is
writing), joined by orthogonal hairlines; dragging the parent drags the tree. Subagents
that finished fold into an "n done" chip on the parent's footer; click it to unfold them.

**Detail mode** — double-click a title (two taps on a phone, or Enter on a focused window) and
the window grows and streams the session's rows inline: tools with their input hint and
result, turns, files, attentions, the assistant's replies. Double-click again to collapse.

**Placement** — a new session appears in the nearest free space to the centre of what you are
looking at, with a short fade. **Tidy** arranges by state in columns (wrapping when there are
many); **Fit** zooms to show everything; **Reset** forgets the layout; **Zones** draws each
machine as a faint labelled region you can drag and resize, and arranges by machine. Hold
Shift while dragging to snap to an 8 px grid. Hidden windows wait in a tray at the bottom
left and come back when the session changes state.

**Control** — when the host can sign and carry a command to a session (`api.control`),
the window gains a prompt line (Enter sends), Allow / Deny act in place, and a working
session has Cancel; the message's lifecycle (queued → taken → working → delivered, with
the reply) renders under the line the way the Session page shows it. When it cannot,
the host's reason sits there instead, muted. Keys: `Enter` on a focused window opens its
prompt line (or, without one, the session split beside the canvas), `a` / `d` answer an open
permission.

**Map** — the Map toggle (persisted; off by default on phones) draws the infrastructure
around the sessions in lanes, top to bottom: *devices* (browsers on this GUI, the
current one marked "you", and the passkeys machines trust), a small *sessionpipe-gui*
hub, *agents* (one group per harness with a chip per account, labelled by email when a
machine's control reported it), the session windows, *machines* (online / offline / not
paired, an amber dot when a session there needs you) and *storage* (one node per repo).
Lines: device → hub, account → the machines it runs on, live session → its machine and
its repo. Hover a node to light its lines and step everything else back. Lanes are as wide as the sessions (at least 960 px) and their nodes pack into rows inside
that width, so nothing can leave its lane; a node dragged along its lane keeps its place
while it fits, and positions of nodes that are gone (a browser that reconnected) are dropped. **Drag an account chip onto a machine** to
start a session there: a small form takes the folder (from the machine's allowlist) and
the first message, and the new window appears above the machine when it acks.

**Hand-drawn** — `+` adds a node of your own ("lavalier mic", "pen"), typed in place;
drag from a node's edge handle to another node, or a window, to draw a link; Backspace
removes the selected node or link. Both persist with the layout.

**Colour and recency** — the Colour toggle (on by default, per device) gives each state its
own mark: working is teal (a 2 px left rule, the dot, the "now" line, a tinted title bar),
needs-you stays amber, stale is slate with a dashed border and its body at 70 %, idle and
done stay grey. The latest session carries a small "latest" in its title bar; every other
window's border and title fade with age on a log scale (2 min · 15 min · 1 h · 6 h). Press
`?` for the legend (it also shows once when colour is first turned on). Map lines are quiet
hairlines that draw only for what you hover (Lines: hovered · all · none, per device);
they leave a window straight, run along a bus outside the target's lane and join one trunk
per machine, repo or account, so many sessions on one machine draw as one bundle; nodes
pack in the order of the windows they connect to, and Tidy clusters windows by machine
while the map is on.

**Navigation** — drag the empty canvas or scroll to pan; ctrl/⌘ + wheel or pinch to zoom
(25 %–200 %); hold Space to pan from over a window. Keys: `0` fit, `+` / `-` zoom, arrows nudge
the focused window (Shift for bigger steps), `/` find (matches light up, the rest dim; it pans
to the first match if none is on screen), `Esc` clears. The minimap in the corner shows where
you are; click it to jump. On a phone, one finger drags a window or pans, two fingers pan and
zoom, and the windows start as a single column.

## Build, dev, test

```sh
npm run build        # esbuild → dist/index.js (~100 KB) + dist/index.css
npm run dev          # the harness at http://127.0.0.1:7420/harness.html
npm run typecheck
npm test             # Playwright: drag, snap, resize, zoom, tidy, expand, search, placement,
                     # hide/tray, done shelf, subagents, keyboard, phone
```

The harness (`dev/`) mounts the theme against a fake `ThemeApi` with a small world of sessions
in every state on two machines, subagents, and a tick that turns tools over, grows the text,
raises and clears attentions, ends and starts sessions. Query: `?tick=0` freezes it,
`?speed=N`, `?extra=N` adds sessions (try `?extra=50`), `?scheme=light|dark`.

In the real GUI: `sessionpipe-gui view link <this folder>` and open `/t/canvas`. Canvas
ships inside the GUI's package; on an older GUI, `sessionpipe-gui view add @sessionpipe-gui/theme-canvas`.

## How it is drawn

Plain TypeScript and DOM; nothing from `api.react`. The world is one element with a
`translate3d(...) scale(k)` transform; every window is `position: absolute` with its own
`translate3d`, so pan, zoom and drag never cause layout. One `requestAnimationFrame` applies
whatever changed and is idle otherwise; the elapsed numerals update once a second by setting
text only. Each window re-renders only when a signature of its session changes. The dot grid
is a CSS background whose spacing follows the zoom. Colours are the host's tokens by name, so
dark and light are the host's; `prefers-reduced-motion` removes the fades and slides.

`src/`: `index.ts` (the canvas), `window.ts` (a window, with its control line), `detail.ts` +
`events.ts` (the rows), `map.ts` (lanes, nodes, edges, links, the start form), `input.ts`
(pointer, pinch, wheel, keys), `layout.ts` (placement and tidy), `types.ts`, `canvas.css`.

The harness fakes `snapshot.viewers` (three browsers) and `api.control` (`misha-air`
online with two accounts, `studio` offline; `send`/`answer`/`cancel`/`start` carry a
message through queued → taken → delivered in about three seconds; `?control=0` removes
the channel; `?world=small` is the map test's fixture).
