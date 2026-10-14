# @sessionpipe-gui/theme-types

A verbatim copy of the sessionpipe GUI's theme contract, so themes in this repo can
import the types without depending on the GUI package:

- `theme-api.ts` — `ThemeApi`, `ThemeManifest`, `ThemeSnapshot`, `Theme` (the module's default export)
- `api.ts` — `SessionSummary`, `SessionState`, `StoredEvent`, `MachineSummary`, …

**This mirrors `shared/theme-api.ts` and `shared/api.ts` in the GUI repo and must be kept in
sync by hand.** The GUI is the source of truth; copy, never edit here.

Mirrors GUI commit `4d8748eb040897029bef1257575b7ffb280924ae` (`Theme plugin contract`).

To refresh:

```sh
cp ../sessionpipe-gui/shared/theme-api.ts ../sessionpipe-gui/shared/api.ts packages/shared-types/
```

then update the commit hash above.
