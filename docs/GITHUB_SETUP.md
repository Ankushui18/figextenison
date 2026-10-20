# GitHub setup

A short checklist for making this repository present as well as its code. None
of it is required to use the extension.

## About section

- **Description:** `Local page capture Chrome extension — editable design layers for Figma, responsive widths, no account, no uploads.`
- **Website:** leave empty until there is one.
- **Topics:** `chrome-extension`, `manifest-v3`, `figma`, `design-handoff`,
  `clipboard`, `page-capture`, `design-tokens`, `privacy`, `no-telemetry`,
  `javascript`
- **Social preview:** upload [`brand/social-1280x640.png`](brand/social-1280x640.png)
  under **Settings → Social preview**.

## Repository settings

| Setting | Value |
|---|---|
| Default branch | `main` |
| Issues | on (templates are in `.github/ISSUE_TEMPLATE/`) |
| Discussions | optional |
| Wiki | off — docs live in `docs/` |
| Releases | tag `vX.Y.Z`, CI attaches `page-capture-<version>.zip` |
| Merge strategy | squash or merge; delete the branch after merge |

## Branch protection (recommended)

Require **CI / verify** to pass before merging to `main`. The workflow runs on
pull requests, so this is enough to keep the suite and the version handshake
honest.

## Releases

1. Bump the version in `extension/manifest.json`, `package.json` and
   `CHANGELOG.md` (all three must match — `npm run check` enforces it).
2. `npm run verify && npm run pack`
3. `git tag v1.7.9 && git push origin v1.7.9`
4. CI creates the release and uploads the ZIP. Users unzip it and point
   **Load unpacked** at the extracted folder that contains `manifest.json`.

## Upload mistakes to avoid

- Uploading the **repository root** as the extension: the manifest must be at the
  ZIP root (that is what `npm run pack` produces).
- Forgetting `_locales/` or `font/`: the options page and icons then fall back or
  disappear.
- Committing `node_modules/` or a ZIP: `.gitignore` covers both.
- Editing `extension/manifest.json` without bumping `package.json` and
  `CHANGELOG.md`: CI fails on purpose.

## Publishing to the Chrome Web Store

Not done yet. If you do it, the store listing needs the privacy summary from
[PRIVACY.md](../PRIVACY.md), the single-purpose description from the README, and
a justification for `scripting` + `<all_urls>`. The `<all_urls>` grant is
requested at runtime as well as declared, which reviewers generally accept for a
capture tool, but it needs the explanation to be explicit.
