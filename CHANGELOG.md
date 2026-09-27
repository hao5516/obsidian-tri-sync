# Changelog

## 0.2.0 — 2026-09-28

- Replace the one-click ribbon with a responsive sync dashboard; retain the immediate sync command.
- Add a guided connection dialog with provider selection, masked credentials, validation and explicit save/cancel.
- Show live progress, persist the last sync result per backend, and explain up to 100 conflicting/skipped files.
- Add searchable local backups, conflict copies and incoming attachment versions.
- Collapse automatic sync and advanced limits; retain existing settings and baselines.
- Add theme-aware CSS, including mobile layouts. Releases now include `styles.css` alongside `main.js` and `manifest.json`.
- Provide actionable connection errors, redact credentials, and avoid repeating identical automatic-sync error notices.
- Validation: official lint, build, 25 automated tests, and browser UI smoke checks. Cloud-provider and physical-device testing remains outstanding.

## 0.1.1 — 2026-09-27

- Prepare community submission metadata, MIT license, third-party attribution and network/privacy disclosures.
- Add the official Obsidian ESLint rules with explicit manifest/license validation.
- Expose settings definitions for search on Obsidian 1.13+ while retaining the legacy settings renderer for 1.8+.
- Prevent further sync publication after the plugin is unloaded.
- Reject case-insensitive collisions with the reserved backup directory and non-breaking-space path aliases.
- Preserve whitespace in secrets and reset connection controls when changes are blocked by an active sync.
- Minify release builds and embed full dependency license notices.
- Validation: official lint passed with zero warnings, TypeScript/build passed, 21 automated tests passed.

Still unverified: live storage-provider integration and physical-device tests on Windows/macOS/Android/iOS. Baidu remains experimental. This release does not add deletion propagation, automatic binary replacement or end-to-end encryption.

## 0.1.0 — 2026-09-27

- Initial WebDAV, S3 and experimental Baidu Netdisk adapters.
- Append-only content/revision history, deterministic conflict copies and local backups.
- Manual and periodic synchronization with a Chinese settings interface.
