# Releasing sessionpipe-gui-themes

Every public package here (`@sessionpipe-gui/theme-types`, `theme-canvas`, `theme-office`,
`skin-spacesheep`, `skin-spacesheep-vivid`, `skin-paper-serif`, `plugin-ping-a-human`)
carries the same version and is published together from one `v*` tag. `color-themes` is
private by design. The GUI bundles Canvas and Office from this repo at its own build time,
so release this repo **before** the GUI.

## The scope: `@sessionpipe-gui/*`

The names are scoped, which needs the npm organisation **sessionpipe-gui**. It is free for
public packages and one form:

1. Signed in at npmjs.com as the owner, open <https://www.npmjs.com/org/create>.
2. Organisation name `sessionpipe-gui`, plan *Free* (unlimited public packages). Create.
3. That is all: a scoped package publishes under the org when its name starts with
   `@sessionpipe-gui/` and the publishing account is a member (the owner is).
   `npm access list packages sessionpipe-gui` shows what is in it.

The name follows the trademark page of the protocol (`sessionpipe-*` for things that work
with sessionpipe, provided the name makes that clear): everything here is an extension of
the sessionpipe GUI and says so in its description.

**If the org is not wanted**, the fallback is unscoped names, `sessionpipe-gui-<kind>-<id>`
(`sessionpipe-gui-skin-paper-serif`, `sessionpipe-gui-theme-canvas`, …):

```sh
node scripts/rename-unscoped.mjs          # lists the files it would rewrite (this repo + ../sessionpipe-gui)
node scripts/rename-unscoped.mjs --yes    # rewrites package.json names, imports, docs, lock file, the GUI catalogue
npm install && npm run build && npm test  # then commit, in both repos
```

`--scoped` reverses it. Nothing else in the release flow cares which spelling is in use:
the scripts read the names from the package.json files.

## One-time setup

1. **The scope** (above), or the rename.
2. **The first publish is by hand.** npm's trusted publishing cannot create a package that
   does not exist yet, so version 0.1.0 of each package goes up from a laptop:
   ```sh
   nvm use && npm ci && npm run build && npm test
   npm login                                 # the owner's account (2FA on)
   node scripts/publish-all.mjs              # dry run: builds, checks every tarball, `npm publish --dry-run`
   node scripts/publish-all.mjs --yes        # publishes, in order: types → canvas, office → the three skins → the plugin
   ```
   It skips any version the registry already has, so it can be re-run after a failure.
3. **Trusted publisher, per package** (so the tag workflow needs no token). On npmjs.com,
   for each of the seven packages: *Package → Settings → Trusted Publisher → GitHub Actions*:
   organisation `spacesheep-dev`, repository `sessionpipe-gui-themes`, workflow filename
   `release.yml`, environment `npm`. Save. (Seven times; the form is the same.)
4. **The GitHub environment.** Repo *Settings → Environments → New environment* named
   `npm`; add the owner as a required reviewer if a human should approve each release,
   or leave it empty for an unattended one. The workflow names it, and npm checks it.
5. **Branch protection** on `main` as usual; tags are pushed by the owner only.

Nothing in the workflow reads an `NPM_TOKEN`; if one is in the repo secrets, delete it.

## Each release

1. Everything for the release is on `main`, CI green, `CHANGELOG.md` has a `## [X.Y.Z] - date`
   section (move the *Unreleased* lines under it). The GUI's `README` and catalogue
   (`server/extensions/catalog.ts`) name these packages: check the sizes there if a
   tarball changed much (`node scripts/pack-check.mjs packages/<id>` prints it).
2. The version, in every package at once:
   ```sh
   npm version 0.2.0 --workspaces --no-git-tag-version      # each packages/*/package.json
   npm install                                              # the lock file's workspace entries
   git commit -s -am "Release 0.2.0" && git tag v0.2.0 && git push && git push origin v0.2.0
   ```
   (`color-themes` is bumped with the rest; harmless, it is private.) The devDependency on
   `@sessionpipe-gui/theme-types` is by version, so bump it in the views and the plugin
   when the types change in a way they need.
3. The tag runs `.github/workflows/release.yml`: version check, typecheck, lint, build,
   tests, `publish-all --yes` with provenance, then a GitHub Release with the changelog
   section and the tarballs attached. A package already at that version on the registry
   is skipped, so a re-run after a failure publishes only what is missing.
4. Then release the GUI (its `RELEASING.md`): its build bundles Canvas and Office from
   this repo's `main`, and its catalogue installs the rest from npm.

## Install smoke test

On a machine with the GUI running (never the one on :7373 you are using), or in a scratch
state dir:

```sh
sessionpipe-gui --state /tmp/spgui-smoke --port 7399 &
sessionpipe-gui --state /tmp/spgui-smoke skin add @sessionpipe-gui/skin-paper-serif
sessionpipe-gui --state /tmp/spgui-smoke skin add @sessionpipe-gui/skin-spacesheep-vivid
sessionpipe-gui --state /tmp/spgui-smoke plugin add @sessionpipe-gui/plugin-ping-a-human
sessionpipe-gui --state /tmp/spgui-smoke extras list        # the three show [installed]
curl -s http://localhost:7399/api/ui/skins | grep -o '"id":"paper-serif"'
```

Before the first publish the same thing with the tarballs: `npm pack -w packages/skin-paper-serif`
then `skin add ./sessionpipe-gui-skin-paper-serif-0.1.0.tgz`.
