# Security

## Reporting a vulnerability

Please **do not** open a public issue for anything that could be exploited.

Use GitHub's private reporting: **Security → Report a vulnerability** on
[github.com/Ankushui18/figextenison](https://github.com/Ankushui18/figextenison).
If that is unavailable, open a minimal issue asking for a private channel and
leave the details out of it.

Useful reports include: the extension version, the Chrome version, the page or a
minimal fixture that reproduces it, and what an attacker gains. A proof of
concept is welcome; captured page content is not.

This is a single-maintainer project, so replies are best-effort. Please allow
time for a fix before disclosing publicly.

## Scope

In scope:

- the extension runtime in `extension/` (service worker, injected scripts,
  options page);
- the local message protocol (six RPCs) and the capture/serializer path;
- the extension's storage and clipboard handling;
- the restrictive extension CSP and asset-fetch policy;
- privilege boundaries in the responsive-capture iframe and Design System frame.

Out of scope:

- a website's own scripts, tracking or network behaviour;
- content you deliberately copy out and paste elsewhere;
- Figma's behaviour after a paste (this repo never talks to Figma);
- missing fidelity in a capture (see "Known limits" in the README);
- vulnerabilities that require an already-compromised browser profile.

## Design constraints the code is expected to keep

These are enforced by tests where practical:

- **No upload path.** No Figma API, no analytics, no remote logging.
- **Asset fetches are `GET`, credential-less, no-referrer, redirect-rejected.**
  Blocked hosts and private address ranges are refused before `fetch`.
- **Message handlers are allowlisted.** Unknown `cmd` values are answered with a
  generic failure; asset jobs are bound to the sending tab and frame.
- **Captured page content never becomes executable UI.** Generated board HTML is
  built in a script-disabled frame with `connect-src 'none'`.
- **No `innerHTML` on captured text.** Page text and attributes are sanitized
  before they reach the DOM of the panel.
- **CSP stays restrictive.** `connect-src 'self'` is not relaxed for convenience.

## Supported versions

Only the current `main` build (currently 1.7.9) is supported. The extension is
distributed as source in this repository; there is no store build yet.
