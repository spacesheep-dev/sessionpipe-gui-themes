# Spacesheep · skin

The [Spacesheep color themes](../color-themes) as one **skin** for the
[sessionpipe GUI](https://github.com/spacesheep-dev/sessionpipe-gui): `scheme: "both"`, so
one entry in the appearance popover follows the system / dark / light setting with the
dark and light token sets from `spacesheep-dark.json` and `spacesheep-light.json`.

The GUI's default skin is **sessionpipe**; this one (id `spacesheep`) installs like any
skin, or is the starting point for a palette of your own (copy the folder, change the
`id`).

```sh
sessionpipe-gui skin add  @sessionpipe-gui/skin-spacesheep   # from npm, under <stateDir>/skins/spacesheep
sessionpipe-gui skin add  packages/skin-spacesheep     # or this folder, copied
sessionpipe-gui skin link packages/skin-spacesheep     # or a symlink, while editing
```

The palette itself, every ratio and where the colour goes: [`../color-themes/README.md`](../color-themes/README.md).
Checking: `npm test` here runs the token checker over `skin.json`. The skin format:
`docs/skin-authoring.md` in the GUI repo.
