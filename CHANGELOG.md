# Changelog

All notable changes to the packages in `sessionpipe-gui-themes`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); each package carries its own
`version` and all are released together while they are `0.x`.

## [Unreleased]

## [0.3.0] - 2026-10-26

### Changed

- **`@sessionpipe-gui/theme-canvas`**: State, the default view, comes first (keys `1`–`7`
  follow the new order). Tidy and the presets read from the top-left, with shared row tops
  across a shelf. A window says less, once: two lines of body, the tool named once
  ("Bash: rm -rf dist"), MCP tools as "github · search_issues", previews without their
  Markdown, an error as one red ✕, durations on the GUI's grammar ("4 m"). The expanded
  window's rows read in words, one row per tool call. Live moves slide the group headings
  instead of blinking them; a window that leaves fades out. Windows dropped into an area
  land clear of its members, and the area grows to hold them. On the phone each group is
  one inset table of rows. The Map drops a passkey that is already a browser chip, and
  agents without an account. The Map's code is its own module, loaded the first time the
  Map is shown: the canvas opens on 103 KB of script instead of 113 KB.

### Added

- **`@sessionpipe-gui/theme-canvas`**: an empty canvas says what fills it, with the way to
  the Board; a search with no hits says so, with Clear.

## [0.2.0] - 2026-10-23

Alongside `sessionpipe-gui` 0.2.0, the native redesign.

### Changed

- **`@sessionpipe-gui/theme-canvas`**: a calm, native canvas. The lanes of id chips,
  duplicate device chips and repeated pairing hints are gone; a window is one status
  glyph, the title, where it runs and what it is doing. One segmented control picks the
  view: *My layout*, State, Machine, Harness, Repo, Label or Map; windows animate into
  labelled groups on a clean grid, and Tidy re-grids.

### Added

- **`@sessionpipe-gui/theme-canvas`**: *My layout*, your own titled areas (draw, rename,
  resize, label, drop sessions in) and sticky notes, kept by the receiver so every device
  sees one layout; right-click menus on the ground, an area, a note and a window; colour
  labels as one dot on a window; subagents as pills on a thin connector to their
  orchestrator's window, in every view.
- **`@sessionpipe-gui/theme-types`**: labels and agents on the `ThemeApi`, matching the
  GUI's 0.2.0 host.

## [0.1.0] - 2026-10-15

The first public release, alongside `sessionpipe-gui` 0.1.0.

### Added

- **`@sessionpipe-gui/theme-canvas`** (view `canvas`, `/t/canvas`): every live session as
  a window on an infinite, pannable, zoomable canvas; the Map draws viewers, accounts,
  machines and repos in lanes with bundled links; drag an account onto a machine to start
  a session; the layout is kept by the receiver and follows you across devices.
- **`@sessionpipe-gui/theme-office`** (view `office`, `/t/office`): every machine a room,
  every live session a person at a desk, subagents at side tables; posture is the state;
  an isometric floor by default, figures on request; drawn with the host's React.
- **`@sessionpipe-gui/skin-spacesheep`** (skin `spacesheep`): the spacesheep.dev palette
  as one `skin.json`, both schemes; the same palette the GUI ships built in as its default.
- **`@sessionpipe-gui/skin-spacesheep-vivid`** (skin `spacesheep-vivid`): Spacesheep with
  the surfaces carrying the brand, dark and light.
- **`@sessionpipe-gui/skin-paper-serif`** (skin `paper-serif`): warm paper, a bundled
  Source Serif 4 (OFL) for the interface text, 2 px corners, hairlines, roomier rows;
  light only. With `scripts/preview.mjs`, which renders any skin's `preview.png`.
- **`@sessionpipe-gui/color-themes`**: Spacesheep and Spacesheep Vivid, dark and light,
  as token-only colour themes with a contrast checker (`scripts/check.mjs`).
- **`@sessionpipe-gui/plugin-ping-a-human`** (plugin `ping-a-human`): a Telegram message
  when a session needs you, through ping-a-human; Allow and Deny taps come back as
  suggestions the person confirms with a passkey; quiet hours, machine filter, dry run.
- **`@sessionpipe-gui/theme-types`**: the type-only mirror of the GUI's `ThemeApi`,
  `PluginApi`, `SkinManifest` and wire types.
- **Packaging.** Every public package publishable on its own (`publishConfig.access:
  public`, `prepublishOnly` builds, `repository.directory`); `scripts/publish-all.mjs`
  publishes in dependency order and skips versions the registry has;
  `scripts/rename-unscoped.mjs` switches the names to `sessionpipe-gui-<kind>-<id>` in one
  command; a `v*` tag publishes with npm provenance from GitHub Actions (RELEASING.md).

[Unreleased]: https://github.com/spacesheep-dev/sessionpipe-gui-themes/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/spacesheep-dev/sessionpipe-gui-themes/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/spacesheep-dev/sessionpipe-gui-themes/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/spacesheep-dev/sessionpipe-gui-themes/releases/tag/v0.1.0
