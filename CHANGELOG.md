# Changelog

All notable changes to the packages in `sessionpipe-gui-themes`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); each package carries its own
`version` and all are released together while they are `0.x`.

## [Unreleased]

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
- **`@sessionpipe-gui/color-themes`**: Spacesheep and Spacesheep Vivid, dark and light,
  as token-only colour themes with a contrast checker (`scripts/check.mjs`).
- **`@sessionpipe-gui/plugin-ping-a-human`** (plugin `ping-a-human`): a Telegram message
  when a session needs you, through ping-a-human; Allow and Deny taps come back as
  suggestions the person confirms with a passkey; quiet hours, machine filter, dry run.
- **`@sessionpipe-gui/theme-types`**: the type-only mirror of the GUI's `ThemeApi`,
  `PluginApi` and wire types.

[Unreleased]: https://github.com/spacesheep-dev/sessionpipe-gui-themes/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/spacesheep-dev/sessionpipe-gui-themes/releases/tag/v0.1.0
