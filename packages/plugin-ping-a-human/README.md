# ping-a-human · a sessionpipe GUI plugin

A Telegram message when a session needs you, through
[ping-a-human](https://www.npmjs.com/package/ping-a-human). On a permission prompt the
message carries **Allow** and **Deny** buttons; the one you tap comes back to the GUI as a
*suggestion* beside the prompt, "Allow suggested by Misha on Telegram · Confirm", and you
confirm it with your passkey. The plugin never answers anything itself: the receiver holds
no key, and neither does the plugin (CONTROL.md).

```
🔔 Needs you · misha-air
Bash: rm -rf dist
https://misha-air.local:7373/s/claude-code/8c13…?k=…
```

## Setup

1. Make the Telegram bot and the config once (it asks for the bot token and finds your chat id):

   ```sh
   npx ping-a-human setup
   ```

   This writes `~/.config/ping-a-human/config.json`.

2. Install the plugin into the GUI, on the machine that runs the receiver:

   ```sh
   sessionpipe-gui plugin add @sessionpipe-gui/plugin-ping-a-human     # from npm (or `sessionpipe-gui extras add ping-a-human`)
   sessionpipe-gui plugin add ./packages/plugin-ping-a-human           # or this folder, built
   ```

   Then **Reload plugins** on the Views page (or restart the receiver). The row shows
   `active`, or the reason it is not (no config yet, say).

3. Settings, on the Views page (saved from the receiver machine only):

| Setting | Default | Meaning |
|---|---|---|
| `configPath` | `~/.config/ping-a-human/config.json` | Where `ping-a-human setup` wrote the token and chat id. |
| `botToken` | — | Optional override of the file (kept 0600 by the GUI, shown masked). |
| `chatId` | — | Optional override of the file. |
| `events` | `needs_you`, `question`, `turn_error` | What sends a message: an attention (permission, elicitation, idle prompt), a question, a turn error; also `session_done`, `flags` (slow tool, error streak, loop, compacting, gap) and `control_delivered`. |
| `askOnPermission` | on | Allow / Deny buttons on a permission prompt; the tap becomes a suggestion. |
| `quietHours` | — | `22:00-08:00`: nothing is sent in between (local time of the receiver). |
| `machines` | — | Comma-separated names; only sessions of these machines. |
| `minSilenceS` | 20 | A prompt answered at the desk within this many seconds sends nothing. |
| `dryRun` | off | Log what would be sent instead of sending it. |

## How a reply becomes an answer

```
Claude Code asks "Allow Bash?"  →  receiver  →  plugin sends the message with Allow / Deny
you tap Allow on the phone      →  plugin calls api.suggest({ decision: "allow", by: "Misha on Telegram" })
the GUI shows "Allow suggested by Misha on Telegram · Confirm" beside the prompt
you tap Confirm on a trusted device  →  the ordinary signed permission.answer goes to the machine
```

If the prompt was answered in the terminal meanwhile, the suggestion disappears with it.
Replies are read one prompt at a time (ping-a-human's channel has one reply stream), each
waiting up to two minutes.

## Development

```sh
npm install                 # at the repository root
npm run build -w packages/plugin-ping-a-human     # dist/index.js: one ES module, ping-a-human bundled in
npm test  -w packages/plugin-ping-a-human         # node:test against a fake Channel
sessionpipe-gui plugin link packages/plugin-ping-a-human   # then Reload plugins after each build
```

`src/index.ts` exports `createPlugin({ createChannel })` so a test can hand in any
`Channel`; the default export uses ping-a-human's. The contract it is written against is
`@sessionpipe-gui/theme-types/plugin-api`, a mirror of the GUI's `shared/plugin-api.ts`
(`docs/plugin-authoring.md` there explains it).

A plugin is code running in the receiver process, with everything that machine has. This
one reads one config file, talks to `api.telegram.org`, and logs nothing that contains the
token.

## Third-party

`dist/index.js` bundles [ping-a-human](https://www.npmjs.com/package/ping-a-human) (MIT);
its notice is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
