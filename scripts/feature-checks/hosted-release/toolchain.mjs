import { build } from '../../../ui/node_modules/vite/dist/node/index.js';
import react from '../../../ui/node_modules/@vitejs/plugin-react/dist/index.js';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

export const repo = fileURLToPath(new URL('../../../', import.meta.url));
export const source = join(repo, 'ui/src/features/hosted-release');
export const generated = fileURLToPath(new URL('./generated/', import.meta.url));

export async function outputDirectory(prefix) {
  await mkdir(generated, { recursive: true });
  return mkdtemp(join(generated, prefix));
}

export async function loadCandidateParts() {
  const outDir = await outputDirectory('parts-');
  await build({ configFile: false, root: source, publicDir: false, logLevel: 'error',
    build: { outDir, emptyOutDir: false, target: 'es2022', minify: false,
      lib: { entry: join(source, 'package-entry.ts'), formats: ['es'], fileName: () => 'parts.mjs' } } });
  return import(pathToFileURL(join(outDir, 'parts.mjs')).href);
}

export async function buildPreview() {
  const outDir = await outputDirectory('preview-');
  await build({ configFile: false, root: source, base: './', publicDir: false, plugins: [react()], logLevel: 'error',
    build: { outDir, emptyOutDir: false, target: 'es2022', rolldownOptions: { input: join(source, 'preview.html') } } });
  return outDir;
}

export function requireOptIn(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== '--opt-in') throw new Error('Explicit opt-in required: use --opt-in. No work was started.');
}
