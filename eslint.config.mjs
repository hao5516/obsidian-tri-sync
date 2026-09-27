import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';
import { PlainTextParser } from 'eslint-plugin-obsidianmd/dist/lib/plainTextParser.js';

export default defineConfig([
  { ignores: ['node_modules/**', 'dist/**', 'tests/**', 'build.mjs', 'scripts/**'] },
  ...obsidianmd.configs.recommended,
  { languageOptions: { parserOptions: { projectService: { allowDefaultProject: ['eslint.config.mjs'] } } } },
  { rules: { 'obsidianmd/ui/sentence-case': ['warn', { brands: ['WebDAV', 'Obsidian', '_TriSync', '_TriSync/incoming'], acronyms: ['NAS', 'MB', 'S3', 'HTTPS'] }] } },
  { files: ['manifest.json'], languageOptions: { parser: tseslint.parser, parserOptions: { projectService: false } }, rules: { 'obsidianmd/validate-manifest': 'error' } },
  { files: ['LICENSE'], languageOptions: { parser: PlainTextParser, parserOptions: { projectService: false } }, rules: { 'obsidianmd/validate-license': 'error' } },
]);
