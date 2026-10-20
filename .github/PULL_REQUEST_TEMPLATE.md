## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The symptom or the reason, not just the mechanism. -->

## How it was verified

- [ ] `npm run verify` passes (version, layout, links, 259 unit checks)
- [ ] Browser suites run if capture, clipboard, focus or layout changed
       (`npm run test:browser`)
- [ ] Added or updated a fixture/test for the behaviour

## Risk check

- [ ] No new permission, host permission or CSP exception
- [ ] No new network path or upload
- [ ] Clipboard is still only written after an explicit action
- [ ] Old saved captures still load
- [ ] Screenshots in `docs/` still match the UI (or were updated with the table
      in `docs/SCREENSHOTS.md`)
