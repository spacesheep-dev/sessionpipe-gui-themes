# sessionpipe-gui-themes

The official extensions for the [sessionpipe GUI](https://github.com/spacesheep-dev/sessionpipe-gui):
two **views** that draw the board their own way, a set of **color themes**, and one
**plugin**. Each is a package the GUI installs outside itself and loads at runtime through a
small contract (`ThemeApi` for a view, `PluginApi` for a plugin, a token file for a color
theme); none of them is bundled into the GUI. Apache-2.0, like the GUI.

## Packages

| Package | Kind | What it is |
|---|---|---|
| [`packages/canvas`](packages/canvas) | view, `/t/canvas` | Every live session as a window on an infinite canvas. Drag, resize, zoom; a **Map** draws the devices, accounts, machines and repos around the sessions in lanes; drag an account onto a machine to start a session there. Layout kept by the GUI, so it is the same on every device. Experimental. |
| [`packages/office`](packages/office) | view, `/t/office` | Every machine a room, every live session a person at a desk, every subagent a helper at a side table. Posture is the state, amber marks who needs you. An isometric floor by default, figures on request. Drawn with the host's React, so the bundle carries none. Experimental. |
| [`packages/color-themes`](packages/color-themes) | color themes | **Spacesheep** and **Spacesheep Vivid**, dark and light: the colours of [spacesheep.dev](https://spacesheep.dev) on the GUI's tokens, with a checker that verifies every text-on-ground ratio. Spacesheep itself ships inside the GUI as its default skin; this package carries the JSON files, the Vivid pair and the checker. |
| [`packages/skin-spacesheep`](packages/skin-spacesheep) | skin | The Spacesheep palette as one `skin.json` (both schemes in one entry). The GUI ships it built in as its default; this is the installable copy, and the starting point for a palette of your own. |
| [`packages/skin-spacesheep-vivid`](packages/skin-spacesheep-vivid) | skin | Spacesheep Vivid: the surfaces carry the brand (indigo cards on violet-black, lavender on cream), lavender hairlines, a flame highlight. `sessionpipe-gui skin add packages/skin-spacesheep-vivid`. |
| [`packages/skin-paper-serif`](packages/skin-paper-serif) | skin | What a color theme cannot carry: a bundled serif (Source Serif 4, OFL) for the interface text, 2 px corners, one-pixel hairlines, comfortable rows, on warm paper. Holds `scripts/preview.mjs`, which renders any skin's `preview.png` against a GUI in demo mode. |
| [`packages/plugin-ping-a-human`](packages/plugin-ping-a-human) | plugin | A Telegram message when a session needs you, through [ping-a-human](https://www.npmjs.com/package/ping-a-human). Allow / Deny buttons in the message come back to the GUI as a *suggestion* beside the prompt, which you confirm with your passkey. The plugin never answers anything itself. |
| [`packages/shared-types`](packages/shared-types) | types | A verbatim copy of the GUI's `shared/theme-api.ts`, `plugin-api.ts` and `api.ts`, so a package here type-checks without depending on the GUI. The GUI is the source of truth; copy, never edit. |

### Canvas

![Canvas with the map on](docs/screenshots/canvas.png)

### Office

| ![Office, the isometric floor](docs/screenshots/office-iso.png) | ![Office, figures](docs/screenshots/office-figures.png) |
|---|---|

### Color themes

![The board in Spacesheep Vivid, dark](docs/screenshots/spacesheep-vivid-dark.png)

### ping-a-human

![The plugin's settings on the GUI's Views page](docs/screenshots/ping-a-human.png)

## Install

On the machine that runs `sessionpipe-gui`:

```sh
# views: a folder (copied), an archive, an npm package name or a git URL
sessionpipe-gui view add ./packages/canvas
sessionpipe-gui view add ./packages/office

# color themes: JSON files the GUI lists beside its skins; read on every open of the popover
cp packages/color-themes/spacesheep-*.json ~/.local/state/sessionpipe-gui/color-themes/

# the plugin: needs `npx ping-a-human setup` once, then Reload plugins on the Views page
sessionpipe-gui plugin add ./packages/plugin-ping-a-human
```

A view then appears on the GUI's rail under *experimental*; a color theme in the
appearance popover under *custom*; a plugin on the Views page with its settings form and
its status (`active`, or the reason it is not). A view is code running in the board page
with everything the page has; a plugin is code running in the receiver process with
everything that machine has. Install only what you trust.

## Working on a package

```sh
nvm use                      # Node 22 (.nvmrc); the GUI needs ≥ 20
npm install                  # workspaces
npm run build                # every package: dist/index.js (+ dist/index.css for a view)
npm run typecheck
npm run lint                 # biome
npm test                     # canvas: Playwright against its harness; plugin: node:test; color themes: the checker
```

Link a package into a running GUI instead of copying it; a linked view is re-imported on
every visit to its page and a linked plugin on **Reload plugins**, so an edit shows without
a restart:

```sh
sessionpipe-gui view link   $PWD/packages/canvas      # then open /t/canvas
sessionpipe-gui plugin link $PWD/packages/plugin-ping-a-human
```

Canvas has a dev harness that mounts it against a fake `ThemeApi` with a small world of
sessions, so it can be built before (and without) a running GUI: `npm run dev -w
packages/canvas` serves `http://127.0.0.1:7420/harness.html` (`?extra=50` adds sessions,
`?scheme=light`, `?tick=0` freezes the world).

### Layout of a view package

```
packages/<id>/
  theme.json        the manifest: id, name, version, entry, style, icon, api
  package.json      @sessionpipe-gui/theme-<id>; files: dist, theme.json, README.md
  src/              TypeScript + DOM, or TSX against the host's React (office)
  scripts/build.mjs esbuild → dist/index.js (one ES module) + dist/index.css
  dev/              harness.html + harness.ts: the fake host (canvas)
  test/             Playwright against the harness (canvas)
```

A plugin is the same shape with `plugin.json` (`"kind": "plugin"`, a `settings` list the
GUI draws a form from) and a Node bundle (`--platform=node --format=esm`, dependencies
bundled in, since the installer leaves `node_modules` out).

Rules of the house: hairlines, one typeface (the host's), the host's colour tokens by name
(`--bg`, `--fg`, `--fg-2`, `--fg-3`, `--line`, `--needs`, `--err`, …) so a skin restyles
every view at once, amber (or the skin's *needs you* colour) only for *needs you*,
`prefers-reduced-motion` honoured, a view's `dist/index.js` well under 150 KB. The
contracts are explained in the GUI's [theme-authoring.md](https://github.com/spacesheep-dev/sessionpipe-gui/blob/main/docs/theme-authoring.md)
and [plugin-authoring.md](https://github.com/spacesheep-dev/sessionpipe-gui/blob/main/docs/plugin-authoring.md).

The screenshots above come from the GUI's demo data; how to regenerate them is in the
GUI repo's [docs/screenshots/README.md](https://github.com/spacesheep-dev/sessionpipe-gui/blob/main/docs/screenshots/README.md).

## Contributing

Apache-2.0 ([LICENSE](LICENSE)), with a [DCO](DCO) sign-off on every commit
(`git commit -s`); no CLA. One concern per PR, the smallest diff that does it, a screenshot
for anything visual. "sessionpipe" is a [mark of Michael Makarov](https://github.com/spacesheep-dev/sessionpipe/blob/main/TRADEMARKS.md);
these packages work with the sessionpipe GUI and are not part of, or endorsed by, the
sessionpipe project. The spacesheep colours are used with that project's name only to say
where they come from; no logo or wordmark of theirs is used.
