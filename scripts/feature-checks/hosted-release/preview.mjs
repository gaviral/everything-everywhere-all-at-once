import { relative } from 'node:path';
import { buildPreview, repo, requireOptIn } from './toolchain.mjs';
import { servePreview } from './local-server.mjs';

async function main() {
  requireOptIn();
  const directory = await buildPreview();
  const server = await servePreview(directory);
  console.log(`Local synthetic preview: ${server.url}\nArtifact: ${relative(repo, directory)}\nSwitch starts OFF. Ctrl-C closes only this preview.`);
  const close = async () => { await server.close(); process.exitCode = 0; };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
