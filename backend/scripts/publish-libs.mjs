#!/usr/bin/env node
/**
 * Publish versioned libraries that other repos consume (libs/* with "private": false).
 * Versions that already exist in the registry are skipped — bump with `pnpm changeset && pnpm libs:version`.
 *   Local:  AC_REGISTRY=http://localhost:54873/ AC_REGISTRY_TOKEN=… pnpm libs:publish   (ac libs publish does this)
 *   CI:     AC_REGISTRY=https://npm.pkg.github.com/ AC_REGISTRY_TOKEN=$GITHUB_TOKEN
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = (process.env.AC_REGISTRY ?? 'http://localhost:54873/').replace(/\/?$/, '/');
const token = process.env.AC_REGISTRY_TOKEN;
const host = registry.replace(/^https?:/, '');

let failed = false;
for (const dir of readdirSync(join(ROOT, 'libs'))) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'libs', dir, 'package.json'), 'utf8'));
  if (pkg.private) continue;
  const meta = await fetch(`${registry}${pkg.name.replace('/', '%2f')}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (meta?.versions?.[pkg.version]) {
    console.log(`  · ${pkg.name}@${pkg.version} already published — skip`);
    continue;
  }
  const r = spawnSync('pnpm', ['publish', '--registry', registry, '--no-git-checks', '--access', 'restricted'], {
    cwd: join(ROOT, 'libs', dir),
    stdio: 'inherit',
    env: { ...process.env, ...(token ? { [`npm_config_${host}:_authToken`]: token } : {}) },
  });
  if (r.status === 0) console.log(`  ✔ published ${pkg.name}@${pkg.version} → ${registry}`);
  else failed = true;
}
process.exit(failed ? 1 : 0);
