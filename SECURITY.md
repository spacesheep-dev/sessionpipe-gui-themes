# Security

## Reporting

Report a vulnerability privately through GitHub's **Report a vulnerability** button on
the Security tab of this repository. Do not open a public issue for anything that could
let someone read sessions, forge a command or reach a machine. You should hear back
within a week.

## What these packages are

A **view** (`canvas`, `office`) is an ES module the GUI loads into its own page: it runs
with everything the page has, including the UI key and the `ThemeApi`'s control
methods. A **plugin** (`plugin-ping-a-human`) is an ES module the receiver imports into
its own process: it runs with everything that machine has. A **colour theme** is JSON
and has no code. The GUI says so at install time; install only what you trust.

The control model these packages live under is the GUI's, described in
[sessionpipe-gui/SECURITY.md](https://github.com/spacesheep-dev/sessionpipe-gui/blob/main/SECURITY.md):
a plugin may *suggest* an answer to a permission prompt and a view may send a command on
the person's behalf, but every command is signed by a passkey on the person's device and
verified by the machine's daemon; neither a view nor a plugin holds a key that can sign.

## In scope

- A view or plugin here that leaks the UI key, a token or session content anywhere but
  its own origin; `ping-a-human` sends only to `api.telegram.org`, and only the text its
  README describes.
- A plugin that delivers an answer to a machine without a passkey confirmation.
- A path or injection weakness in a package's build or install path.
- The Telegram bot token: it must only ever come from the ping-a-human config file or
  the GUI's masked `type: "secret"` setting, never from code, a manifest or a log.

## Out of scope

- The GUI itself: report those to
  [sessionpipe-gui](https://github.com/spacesheep-dev/sessionpipe-gui/security/advisories/new).
- The sessionpipe CLI, daemon and hooks: report those to the
  [sessionpipe project](https://github.com/spacesheep-dev/sessionpipe).
- Views, skins or plugins from other authors.
