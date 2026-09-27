import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist/tri-sync', { recursive: true });
const notices = await Promise.all(['LICENSE', 'node_modules/@noble/hashes/LICENSE', 'node_modules/aws4fetch/LICENSE'].map(path => readFile(path, 'utf8')));
const banner = '/*!\nTri Sync\n' + notices.join('\n\n') + '\n*/';
await build({entryPoints:['src/main.ts'],bundle:true,minify:true,legalComments:'inline',banner:{js:banner},external:['obsidian'],platform:'browser',format:'cjs',target:'es2020',outfile:'dist/tri-sync/main.js'});
await copyFile('manifest.json','dist/tri-sync/manifest.json');
await writeFile('dist/tri-sync/THIRD-PARTY-NOTICES.txt', notices.slice(1).join('\n\n'));
await copyFile('LICENSE', 'dist/tri-sync/LICENSE');
