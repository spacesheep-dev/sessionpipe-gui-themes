# @sessionpipe-gui/theme-types

A verbatim copy of the sessionpipe GUI's theme contract, so themes in this repo can
import the types without depending on the GUI package:

- `theme-api.ts` — `ThemeApi`, `ThemeManifest`, `ThemeSnapshot`, `Theme` (the module's default export)
- `plugin-api.ts` — `PluginApi`, `PluginManifest`, `SettingField`, `Plugin` (a server plugin's default export)
- `api.ts` — `SessionSummary`, `SessionState`, `StoredEvent`, `MachineSummary`, `Suggestion`, …
- `skin-api.ts`, `skins-builtin.ts`, `color-theme.ts`, `contrast.ts` — `SkinManifest`, `InstalledSkin`, the built-in skins, `COLOR_TOKEN_NAMES`
- `attachments.ts` — `composePrompt`, `splitAttachments`, `attachmentIdsIn`, `AttachmentRef`, `ATTACHMENT_REF_RE` (images named in a prompt's text)

**This mirrors `shared/theme-api.ts`, `shared/plugin-api.ts` and `shared/api.ts` in the GUI repo and must be kept in
sync by hand.** The GUI is the source of truth; copy, never edit here.

Mirrors the GUI's `shared/{theme-api,plugin-api,api,skin-api,skins-builtin,color-theme,contrast,attachments}.ts` as of GUI commit `cadac7a` (0.7.0).

To refresh:

```sh
cp ../sessionpipe-gui/shared/{theme-api,plugin-api,api,skin-api,skins-builtin,color-theme,contrast,attachments}.ts packages/shared-types/
```

then update the commit hash above.
