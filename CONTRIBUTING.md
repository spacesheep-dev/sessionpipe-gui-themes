# Contributing

- **DCO, not CLA.** Sign off every commit (`git commit -s`); the
  [Developer Certificate of Origin](DCO) is the only paperwork.
- **License.** Apache-2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)); every `.ts`, `.tsx`,
  `.mjs`, `.js` and `.css` file starts with `// SPDX-License-Identifier: Apache-2.0`.
  Anything bundled from a third party gets its notice in the package's
  `THIRD_PARTY_NOTICES.md` and in [NOTICE](NOTICE).
- **Conduct and security.** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md),
  [SECURITY.md](SECURITY.md).

## Running it

```sh
nvm use                      # Node 22
npm install
npm run build                # every package: dist/index.js (+ dist/index.css)
npm run typecheck
npm run lint                 # biome check .
npm test                     # canvas: Playwright on :7421; plugin: node --test; color-themes: the checker
```

Each view has a dev harness that mounts it against a fake `ThemeApi`, so it builds and
tests without a running GUI (`cd packages/canvas && npm run dev`). To try one in the
real GUI: `sessionpipe-gui view link packages/<id>` and open `/t/<id>`; a plugin with
`plugin link`, then *Reload plugins*.

## Adding a package

```
packages/<id>/
  theme.json | plugin.json   the manifest (id, name, version, entry, api)
  package.json               @sessionpipe-gui/<kind>-<id>; files: dist, the manifest, README.md
  src/                       TypeScript; nothing loaded from the network at runtime
  scripts/build.mjs          esbuild → dist/index.js, one ES module
  dev/                       the harness (views)
  test/                      Playwright against the harness, or node --test
```

The contract a package is written against is `@sessionpipe-gui/theme-types`
(`packages/shared-types`), a hand-kept mirror of the GUI's `shared/theme-api.ts`,
`shared/plugin-api.ts` and `shared/api.ts`; the authoring guides are in the GUI repo
(`docs/theme-authoring.md`, `docs/skin-authoring.md`, `docs/plugin-authoring.md`).

House rules: hairlines, one typeface (the host's), the host's colour tokens by name,
amber only for *needs you*, `prefers-reduced-motion` honoured, a view's `dist/index.js`
well under 150 KB. A plugin's secrets go through `type: "secret"` settings or a config
file outside the repo; never into code, a manifest, a fixture or a log.

Fixtures and screenshots use made-up data: `example.com` addresses, `acme/*` repos,
`10.0.0.x` / `192.168.1.x` addresses, no real hostname or home path.

## A good PR

One concern, the smallest diff, Biome-formatted, a Playwright assertion and a
screenshot (desktop and phone) for anything visual, and a line under *Unreleased* in
[CHANGELOG.md](CHANGELOG.md) if a person would notice.
