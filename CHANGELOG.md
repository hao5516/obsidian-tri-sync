# Changelog

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
