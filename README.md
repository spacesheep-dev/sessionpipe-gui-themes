# sessionpipe-gui-themes

Themes for the [sessionpipe GUI](https://github.com/spacesheep-dev/sessionpipe-gui). A theme is an
ES module beside a `theme.json`, installed outside the GUI and loaded at runtime through the
`ThemeApi` the host hands it (`shared/theme-api.ts` in the GUI; mirrored here in
`packages/shared-types`).

## Packages

| Package | What it is |
| --- | --- |
| [`packages/canvas`](packages/canvas) | **Canvas** (`/t/canvas`): every live session as a window on an infinite, pannable, zoomable canvas. Drag them anywhere; the layout follows you across devices. Experimental. |
| [`packages/shared-types`](packages/shared-types) | Type-only mirror of the GUI's theme contract, kept in sync by hand. |

## Working on a theme

```sh
nvm use                      # Node 22
npm install
npm run build                # every package: dist/index.js + dist/index.css
npm run typecheck
npm run lint                 # biome
npm test                     # each package's Playwright suite
```

Each theme has a dev harness that mounts it against a fake `ThemeApi`, so it can be built
before (and without) a running GUI:

```sh
cd packages/canvas
npm run dev                  # http://127.0.0.1:7420/harness.html
```

To try a theme in the real GUI, link the package folder as a theme and open `/t/<id>`:

```sh
sessionpipe-gui theme link /path/to/sessionpipe-gui-themes/packages/canvas
```

## Layout of a theme package

```
packages/<id>/
  theme.json        the manifest (id, name, entry, style, api version)
  package.json      @sessionpipe-gui/theme-<id>; files: dist, theme.json, README.md
  src/              TypeScript + DOM (or whatever you bundle; nothing is loaded from the network)
  scripts/build.mjs esbuild → dist/index.js (one ES module) + dist/index.css
  dev/              harness.html + harness.ts: the fake host
  test/             Playwright against the harness
```

Rules of the house: hairlines, one typeface (the host's), the host's colour tokens by name
(`--bg`, `--fg`, `--fg-2`, `--fg-3`, `--line`, `--needs`, `--err`), amber only for *needs you*,
`prefers-reduced-motion` honoured, `dist/index.js` well under 150 KB.

## Contributing

Apache-2.0, with a [DCO](DCO) sign-off on every commit (`git commit -s`).
