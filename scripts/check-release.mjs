import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const json = path => JSON.parse(readFileSync(path, 'utf8'));
const pkg = json('package.json');
const manifest = json('manifest.json');
assert.deepEqual(json('dist/tri-sync/manifest.json'), manifest);
assert.equal(pkg.version, manifest.version);
assert.equal(json('package-lock.json').packages[''].version, pkg.version);
assert.equal(json('versions.json')[manifest.version], manifest.minAppVersion);
assert.equal(readFileSync('dist/tri-sync/styles.css', 'utf8'), readFileSync('styles.css', 'utf8'));
const bundle = readFileSync('dist/tri-sync/main.js', 'utf8');
for (const holder of ['Paul Miller', 'Michael Hart', '2026 hao5516']) {
  assert.ok(bundle.includes(holder), `Missing bundled license notice: ${holder}`);
}
assert.ok(!/require\(["'](?:node:|fs["']|path["']|electron["']|crypto["'])/.test(bundle), 'Desktop-only module found in mobile bundle');
console.log('Release versions, assets and bundled license notices verified.');
