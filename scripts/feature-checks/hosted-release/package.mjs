import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo, loadCandidateParts, outputDirectory, requireOptIn } from './toolchain.mjs';

function exactCommit(ref) {
  const revision = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: repo, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Git did not return a full commit identity.');
  const type = execFileSync('git', ['cat-file', '-t', revision], { cwd: repo, encoding: 'utf8' }).trim();
  if (type !== 'commit') throw new Error('Source revision is not a commit.');
  return { revision, kind: 'git-commit' };
}

export async function writeCandidatePackage(parts, candidate, prior, directory) {
  const plan = await parts.promotionPlan(candidate, prior, parts.artifactIdentity(prior));
  for (const [name, value] of Object.entries({ 'manifest.json': candidate.manifest, 'candidate.json': candidate, 'prior.json': prior, 'plan.json': plan })) {
    await writeFile(join(directory, name), parts.canonicalBytes(value), { flag: 'wx' });
  }
  return plan;
}

async function main() {
  requireOptIn();
  const parts = await loadCandidateParts();
  const candidate = await parts.createCandidate(exactCommit('HEAD'));
  const prior = await parts.createCandidate(exactCommit('HEAD^'));
  const directory = await outputDirectory('package-');
  await writeCandidatePackage(parts, candidate, prior, directory);
  console.log(JSON.stringify({ output: relative(repo, directory), source: candidate.manifest.source,
    fingerprint: candidate.fingerprint, purpose: 'synthetic-dry-run', deployedRevision: 'MISSING',
    note: 'Source metadata identifies committed HEAD. This does not build or identify a deployed application, and excludes working-tree changes.' }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
