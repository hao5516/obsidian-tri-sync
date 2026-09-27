import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/tri-sync', { recursive: true });
await build({entryPoints:['src/main.ts'],bundle:true,external:['obsidian'],platform:'browser',format:'cjs',target:'es2020',outfile:'dist/tri-sync/main.js'});
await copyFile('manifest.json','dist/tri-sync/manifest.json');
