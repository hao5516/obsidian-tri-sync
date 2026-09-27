# Community submission notes

Status: the owner submitted the plugin and its public listing is available at https://community.obsidian.md/plugins/tri-sync. The notes below describe the original submission process. Each update is reviewed independently by the directory.

Local verification for 0.1.1: official Obsidian ESLint checks passed with zero warnings (including manifest and license rules), TypeScript and bundle build passed, and all 21 automated tests passed. These results are not a community-directory approval.

## Submission fields

- Repository: `https://github.com/hao5516/obsidian-tri-sync`
- Owner: your connected community profile (GitHub owner `hao5516`).
- Plugin ID: `tri-sync` (availability must be verified by the directory when submitting).
- Name: `Tri Sync`.
- Version: `0.1.1`.
- Description: `Sync notes through WebDAV, S3-compatible storage, or Baidu Netdisk, with conflict copies and local backups.`
- Suggested categories: Files, Integrations.
- Payment: the plugin is free; storage provider fees may apply.
- License prepared: MIT, copyright 2026 hao5516.

## Required owner actions

1. The owner approved making this repository public with an MIT license. The visibility change is complete.
2. Review the prepared MIT license before making the source public.
3. Sign in at https://community.obsidian.md with your Obsidian account and connect GitHub account `hao5516`.
4. Open Plugins → New plugin; enter the repository URL and choose yourself as owner.
5. Read and personally agree to the developer policies and ongoing support/transfer/removal commitment, then submit.
6. Address scanner feedback before selecting Publish. A GitHub release alone does not create a searchable community entry.

The assistant has no connected browser session for your Obsidian account and cannot complete the account linking or personal policy acceptance on your behalf.

## Release checklist

- Root `README.md`, `LICENSE`, `manifest.json`, and `versions.json` are present.
- `manifest.json` and GitHub release tag must both use `0.1.1`.
- Upload `main.js` and `manifest.json` as individual release assets; ZIP is for manual installation.
- Source remains readable; the build bundles dependencies and minifies the executable. Full third-party license notices remain in the bundle.
- `npm run lint`, `npm run build`, and `npm test` must pass on the final commit.
- Do not publish credentials, local `data.json`, or `node_modules`.

## Testing limits to disclose

Automated tests use in-memory storage and mocked HTTP responses. No real WebDAV/S3/Baidu account or Android/iOS device has been supplied for end-to-end testing. The Baidu adapter remains experimental. Deletion propagation, automatic binary replacement, end-to-end encryption and history cleanup are not implemented. Do not state that all platforms/providers have passed live testing.

Suggested manual checks: install in disposable vaults on each intended platform; exercise first upload/download, UTF-8 and attachment paths, concurrent offline edits, network interruption, credentials expiry, app restart and mobile suspend/resume. Retain both original and conflict versions while verifying results.

Official references:
- https://docs.obsidian.md/plugins/releasing/submit-plugin
- https://docs.obsidian.md/community-directory/set-up-and-claim
- https://docs.obsidian.md/community-directory/developer-policies
- https://docs.obsidian.md/community-directory/submission-requirements-for-plugins
