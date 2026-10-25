#!/usr/bin/env node
/**
 * agentic-commerce workspace CLI (platform repo). macOS & Linux, Node.js 22+, no dependencies.
 * Orchestrates the three repos that live side by side:  agentic-commerce/{platform,backend,frontend}
 *
 *   node platform/scripts/ac.mjs <command>      (alias suggestion: alias ac="node $PWD/platform/scripts/ac.mjs")
 *
 * Setup
 *   setup                 tools → repos → configure → infra up → infra init → install (+ libs publish) → build → doctor
 *   tools [--install]     check / install tools (Homebrew on macOS; prints commands on Linux)
 *   repos                 git-init (or clone from AC_BACKEND_REPO / AC_FRONTEND_REPO) the backend and frontend repos
 *   configure             platform/.env (secrets) → backend/.env, backend/services/<svc>/.env, frontend/apps/<zone>/.env.local
 *   install | build | test   in backend then frontend (install publishes backend libs to the local registry first)
 *   libs publish          build + publish versioned backend libs (@ac/contracts, @ac/money) to the local registry
 *   doctor                tools, repos, config, containers, endpoints, running services and zones
 *
 * Local infrastructure (platform/infra/docker-compose.yml)
 *   infra up [--llmops] [--tools] | init | status | logs [svc] | down | reset [--yes]
 *     init = per-service database + role, Kafka topics, OpenSearch index, Kong routes, registry account (idempotent)
 *
 * Development
 *   dev [backend|frontend|<service>|<zone> …]     watch mode; default: everything
 *   new service <name> [--port N] [--db name|--no-db]    → backend `pnpm gen service`
 *   new agent <id>                                         → backend `pnpm gen agent`
 *   new zone <name> --base /<path> [--port N]              → frontend `pnpm gen zone`
 *   docker build <service|zone-<zone>|edge> [--platform linux/arm64]   container image for one deployable (zones: zone-shell …)
 *   docker push <service|zone> --tag X [--env prod]       tag + push to the env's registry (ghcr)
 *   seed [service…]                 demo data: every service seeds ONLY its own database (deterministic world)
 *   token [realm] [user] [password]   dev access token (default customers buyer buyer)
 *   policy test | k6 [script] | stripe listen | kong [--k8s]
 *
 * Kubernetes (k3s on an Oracle Cloud VM, or k3s in Docker locally — platform/deploy)
 *   k8s local up|load [names…] [--infra]|down   k3s in Docker on this machine (ingress http://localhost:8088)
 *   k8s values                          regenerate the chart's service/zone catalogue from repo metadata
 *   k8s secrets <env>                   per-service/zone Secrets from deploy/envs/<env>.env (generated on first use)
 *   k8s deploy <env> [names…] [--tag X] [--infra] [--infra-only]   helm upgrade; with names only those Deployments change
 *   k8s rollback <env> <name>           restore the previous tag of one service/zone from <env>.tags.json
 *   k8s status <env> | k8s kubeconfig <env> | k8s seed <env> (demo data, runs each service's seed in its pod)
 *   tf oci <init|plan|apply|destroy|output>   Terraform for the OCI VM (platform/deploy/terraform/oci)
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// ───────────────────────────────────────────── basics
const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WS = dirname(PLATFORM);
const BACKEND = resolve(process.env.AC_BACKEND_DIR ?? join(WS, 'backend'));
const FRONTEND = resolve(process.env.AC_FRONTEND_DIR ?? join(WS, 'frontend'));
const P = {
  env: join(PLATFORM, '.env'),
  envEx: join(PLATFORM, '.env.example'),
  compose: join(PLATFORM, 'infra', 'docker-compose.yml'),
  kong: join(PLATFORM, 'infra', 'kong', 'kong.yml'),
  kongK8s: join(PLATFORM, 'infra', 'kong', 'kong.k8s.yml'),
  deploy: join(PLATFORM, 'deploy'),
  topics: join(PLATFORM, 'infra', 'kafka', 'topics.json'),
  osIndex: join(PLATFORM, 'infra', 'opensearch', 'products-index.json'),
  workspace: join(PLATFORM, 'workspace'),
};
const IS_MAC = process.platform === 'darwin';
if (process.platform === 'win32') {
  console.error('Windows is not supported — use macOS or Linux (WSL 2 works as Linux).');
  process.exit(1);
}
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const VALUE_FLAGS = ['--port', '--db', '--base', '--path', '--owner', '--title', '--platform', '--tag', '--env'];
const optVal = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]));
const command = positional[0] ?? 'setup';
const YES = flag('--yes') || !process.stdin.isTTY;

const paint = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint(1), dim = paint(2), green = paint(32), yellow = paint(33), red = paint(31), cyan = paint(36);
const ok = (m) => console.log(`  ${green('✔')} ${m}`);
const warn = (m) => console.log(`  ${yellow('!')} ${m}`);
const fail = (m) => console.log(`  ${red('✖')} ${m}`);
const info = (m) => console.log(`  ${dim('·')} ${m}`);
const step = (m) => console.log(`\n${bold(cyan('▸'))} ${bold(m)}`);
class CliError extends Error {}
const die = (m) => {
  throw new CliError(m);
};

function sh(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? WS,
    encoding: 'utf8',
    input: opts.input,
    env: { ...process.env, ...opts.env },
    stdio: opts.input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  });
  return { ok: r.status === 0, code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), missing: r.error?.code === 'ENOENT' };
}
function run(cmd, args = [], opts = {}) {
  if (!opts.quiet) info(dim(`$ ${opts.cwd && opts.cwd !== WS ? `(${relative(WS, opts.cwd)}) ` : ''}${[cmd, ...args].join(' ')}`));
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? WS, stdio: 'inherit', env: { ...process.env, ...opts.env } });
  if (r.error?.code === 'ENOENT') die(`${cmd} is not installed — run: ac tools --install`);
  if (r.status !== 0 && !opts.allowFail) die(`${cmd} ${args.join(' ')} failed (exit ${r.status})`);
  return r.status === 0;
}
const has = (cmd, args = ['--version']) => !sh(cmd, args).missing;
const secret = () => randomBytes(18).toString('hex');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

// ───────────────────────────────────────────── env files
function readEnv(file = P.env) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
function writeEnv(file, updates, header) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : header ? header.split('\n') : [];
  const seen = new Set();
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && m[1] in updates) {
      seen.add(m[1]);
      return `${m[1]}=${updates[m[1]] ?? ''}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k)) out.push(`${k}=${v ?? ''}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out.join('\n').replace(/\n*$/, '\n'));
}
function prompt(question, { hidden = false, def = '' } = {}) {
  if (YES) return Promise.resolve(def);
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const q = `  ${question}${def && !hidden ? dim(` [${def}]`) : ''}: `;
    if (hidden) rl._writeToOutput = (s) => rl.output.write(s.startsWith(q) ? q : s.includes('\n') ? '\n' : '*');
    rl.question(q, (a) => {
      rl.close();
      res(a.trim() || def);
    });
  });
}
const confirm = async (q, def = false) => (YES ? def : /^y/i.test(await prompt(`${q} ${def ? '[Y/n]' : '[y/N]'}`, { def: def ? 'y' : 'n' })));

// ───────────────────────────────────────────── repos & discovery
const repoOk = (dir) => existsSync(join(dir, 'package.json'));
function services() {
  const dir = join(BACKEND, 'services');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'package.json')))
    .map((d) => {
      const pkg = readJson(join(dir, d.name, 'package.json'));
      return { dir: d.name, path: join(dir, d.name), ...pkg.ac, hasSeed: Boolean(pkg.scripts?.seed) };
    })
    .sort((a, b) => a.port - b.port);
}
function zones() {
  const f = join(FRONTEND, 'zones.json');
  return existsSync(f) ? readJson(f).zones.map((z) => ({ ...z, path: join(FRONTEND, 'apps', z.name) })) : [];
}
const dbEnvKey = (db) => `DB_PASSWORD_${db.toUpperCase()}`;
/** Services that call others synchronously ("ac": { "calls": ["catalog", …] }) get the `services` client credentials
 *  (customers realm, realm role `service`) for client-credentials tokens; KONG_URL is shared config. */
const callerVals = (s, e) => (s.calls?.length ? { SERVICES_CLIENT_ID: 'services', SERVICES_CLIENT_SECRET: e.KEYCLOAK_SERVICES_CLIENT_SECRET, SERVICE_CALLS: s.calls.join(',') } : {});
/** Object store per service ("ac": { "objectStore": true }): bucket ac-<svc>, MinIO user svc-<svc> limited to it. */
const s3EnvKey = (svc) => `S3_SECRET_${svc.toUpperCase().replace(/-/g, '_')}`;
const s3Vals = (s, e, endpoint) => ({ S3_ENDPOINT: endpoint, S3_REGION: 'us-east-1', S3_BUCKET: `ac-${s.dir}`, S3_ACCESS_KEY: `svc-${s.dir}`, S3_SECRET_KEY: e[s3EnvKey(s.dir)] });

// ───────────────────────────────────────────── tools
const TOOLS = [
  { id: 'git', required: true, check: () => sh('git', ['--version']), brew: 'git', linux: 'sudo apt-get install -y git' },
  {
    id: 'node',
    required: true,
    check: () => ({ ok: Number(process.versions.node.split('.')[0]) >= 22, out: `v${process.versions.node}`, missing: false }),
    brew: 'node@24',
    linux: 'nvm install 24  (https://github.com/nvm-sh/nvm)',
  },
  { id: 'pnpm', required: true, check: () => sh('pnpm', ['--version']), npm: 'pnpm@12' },
  {
    id: 'docker',
    required: true,
    check: () => {
      const r = sh('docker', ['version', '--format', '{{.Server.Version}}']);
      if (r.missing || r.ok) return r;
      return { ok: false, missing: false, out: 'installed but the engine is not running — start Docker Desktop / OrbStack' };
    },
    cask: 'docker-desktop',
    linux: 'https://docs.docker.com/engine/install/ (with the compose plugin)',
  },
  { id: 'docker compose', required: true, check: () => sh('docker', ['compose', 'version', '--short']), linux: 'sudo apt-get install -y docker-compose-plugin' },
  { id: 'gh', check: () => sh('gh', ['--version']), brew: 'gh', linux: 'https://github.com/cli/cli/blob/trunk/docs/install_linux.md', note: 'PRs, CI, GitHub Packages' },
  { id: 'terraform', check: () => sh('terraform', ['version']), brew: 'hashicorp/tap/terraform', linux: 'https://developer.hashicorp.com/terraform/install', note: 'AWS environments' },
  { id: 'aws', check: () => sh('aws', ['--version']), brew: 'awscli', linux: 'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html', note: 'AWS deploys' },
  { id: 'claude', check: () => sh('claude', ['--version']), npm: '@anthropic-ai/claude-code', note: 'Claude Code (skills & agents in each repo .claude/)' },
];
const firstLine = (s) => (s ?? '').split('\n')[0].slice(0, 70);
function checkTools({ quiet = false } = {}) {
  const results = TOOLS.map((t) => ({ t, r: t.check() }));
  if (!quiet) {
    for (const { t, r } of results) {
      const label = `${t.id.padEnd(15)} ${t.required ? '' : dim('(optional) ')}`;
      if (r.ok) ok(`${label}${dim(firstLine(r.out))}`);
      else (t.required ? fail : warn)(`${label}${r.missing ? 'not found' : firstLine(r.out)}${t.note ? dim(` — ${t.note}`) : ''}`);
    }
    info('OPA, k6 and the Stripe CLI run through Docker (ac policy test | k6 | stripe listen) — nothing to install.');
  }
  return results;
}
function installTool(t) {
  if (t.npm) return run('npm', ['install', '-g', t.npm], { allowFail: true });
  if (IS_MAC) {
    if (!has('brew')) return warn('Homebrew is needed: https://brew.sh — then re-run: ac tools --install'), false;
    if (t.cask) return run('brew', ['install', '--cask', t.cask], { allowFail: true });
    if (t.brew) {
      const done = run('brew', ['install', t.brew], { allowFail: true });
      if (done && t.id === 'node') run('brew', ['link', '--overwrite', '--force', t.brew], { allowFail: true });
      return done;
    }
  }
  if (t.linux) warn(`${t.id}: ${t.linux}`);
  return false;
}
async function tools() {
  step(`Tools (${IS_MAC ? 'macOS' : 'Linux'})`);
  const missing = checkTools().filter(({ r }) => !r.ok);
  if (!missing.length) return;
  if (!(flag('--install') || (command === 'setup' && missing.some(({ t }) => t.required)))) {
    info('Install missing tools with: ac tools --install');
    return;
  }
  for (const { t, r } of missing) {
    if (!r.missing && t.id === 'docker') {
      warn('Docker is installed but not running: start Docker Desktop / OrbStack, then re-run.');
      continue;
    }
    if (await confirm(`Install ${t.id}${t.required ? '' : ' (optional)'}?`, t.required)) installTool(t);
  }
  const still = checkTools({ quiet: true }).filter(({ t, r }) => t.required && !r.ok);
  if (still.length) die(`Missing required tools: ${still.map(({ t }) => t.id).join(', ')} (open a new terminal if just installed)`);
}

// ───────────────────────────────────────────── repos
function repos() {
  step('Repositories');
  const env = readEnv();
  for (const [name, dir, url] of [
    ['platform', PLATFORM, null],
    ['backend', BACKEND, env.AC_BACKEND_REPO || process.env.AC_BACKEND_REPO],
    ['frontend', FRONTEND, env.AC_FRONTEND_REPO || process.env.AC_FRONTEND_REPO],
  ]) {
    if (!existsSync(dir)) {
      if (!url) die(`${name} repo missing at ${dir} — set AC_${name.toUpperCase()}_REPO=<git url> in platform/.env to clone it`);
      run('git', ['clone', url, dir]);
      ok(`${name}: cloned`);
      continue;
    }
    // its own repo, or a folder of the agentic-commerce monorepo (git root one level up) — never nest a new repo
    const top = sh('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
    if (existsSync(join(dir, '.git')) || (top.ok && top.out)) {
      ok(`${name}: git ${top.out && resolve(top.out) !== resolve(dir) ? 'monorepo folder' : 'repository'} ${dim(sh('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']).out || '')}`);
      continue;
    }
    run('git', ['init', '-b', 'main', dir], { quiet: true });
    ok(`${name}: initialised (no commit made — review and commit when ready)`);
  }
  // workspace-level guidance for tools (Claude Code) opened at agentic-commerce/
  for (const f of ['README.md', 'CLAUDE.md']) if (existsSync(join(P.workspace, f))) copyFileSync(join(P.workspace, f), join(WS, f));
  ok('workspace README.md / CLAUDE.md refreshed from platform/workspace/');
}

// ───────────────────────────────────────────── configure
async function validateOpenAI(key) {
  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    return r.ok ? null : `OpenAI rejected the key (HTTP ${r.status})`;
  } catch (e) {
    return `could not reach OpenAI (${e.message}) — saved unverified`;
  }
}
async function configure() {
  step('Configuration');
  if (!existsSync(P.env)) {
    copyFileSync(P.envEx, P.env);
    ok('created platform/.env from .env.example');
  }
  const example = readEnv(P.envEx);
  const env = readEnv();
  const updates = {};
  for (const [k, v] of Object.entries(example)) if (!(k in env)) updates[k] = v;
  for (const s of services()) if (s.database && !env[dbEnvKey(s.database)]) updates[dbEnvKey(s.database)] = secret();
  for (const s of services()) if (s.objectStore && !env[s3EnvKey(s.dir)]) updates[s3EnvKey(s.dir)] = secret();
  const merged = { ...env, ...updates };
  for (const [k, v] of Object.entries(merged)) {
    if (v === '__generate__') updates[k] = secret();
    else if (v === '__generate_hex64__') updates[k] = randomBytes(32).toString('hex');
    else if (v === '__generate_sk__') updates[k] = `sk-lf-${secret()}`;
  }
  const ask = async (key, label, validate) => {
    const current = merged[key] ?? '';
    if (process.env[key] && process.env[key] !== current) return (updates[key] = process.env[key]), ok(`${key} taken from the environment`);
    if (current) return ok(`${key} is set ${dim('(keep)')}`);
    const v = await prompt(`${label} ${dim('(Enter to skip)')}`, { hidden: true });
    if (!v) return warn(`${key} not set — run ac configure later to add it`);
    const problem = validate ? await validate(v) : null;
    if (problem) warn(problem);
    updates[key] = v;
    ok(`${key} saved`);
  };
  await ask('OPENAI_API_KEY', 'OpenAI API key (agents, search embeddings)', validateOpenAI);
  await ask('STRIPE_SECRET_KEY', 'Stripe TEST secret key sk_test_…');
  writeEnv(P.env, updates);
  const e = readEnv();

  if (repoOk(BACKEND)) {
    const shared = readEnv(join(BACKEND, '.env.example'));
    writeEnv(join(BACKEND, '.env'), { ...shared, KONG_URL: e.KONG_URL, OPA_URL: e.OPA_URL, OPENSEARCH_URL: e.OPENSEARCH_URL, REDIS_URL: `redis://:${e.REDIS_PASSWORD}@localhost:56379` }, '# GENERATED by `ac configure` (platform repo) — shared non-secret settings for all services');
    for (const s of services()) {
      const vals = { SERVICE_NAME: s.dir, PORT: s.port };
      if (s.database) vals.DATABASE_URL = `postgresql://svc_${s.database}:${e[dbEnvKey(s.database)]}@${e.POSTGRES_HOST}:${e.POSTGRES_PORT}/ac_${s.database}`;
      for (const k of s.secrets ?? []) vals[k] = e[k] ?? '';
      if (s.objectStore) Object.assign(vals, s3Vals(s, e, 'http://localhost:59000'));
      Object.assign(vals, callerVals(s, e));
      if ((s.secrets ?? []).includes('OPENAI_API_KEY')) for (const k of ['MODEL_PROVIDER', 'MODEL_FAST', 'MODEL_SMART', 'MODEL_VISION', 'MODEL_EMBED', 'EMBED_DIMENSIONS']) vals[k] = e[k];
      // the admin service probes every service's /health through Kong for the platform-health dashboard
      if (s.dir === 'admin') vals.PLATFORM_SERVICES = services().map((x) => x.dir).join(',');
      writeEnv(join(s.path, '.env'), vals, `# GENERATED by \`ac configure\` — ${s.dir} service only (own database, own secrets)`);
    }
    ok(`backend/.env + ${services().length} service .env files (each with its own DATABASE_URL and only its secrets)`);
  }
  if (repoOk(FRONTEND)) {
    const zs = zones();
    for (const z of zs) {
      // every zone reads the shared session cookie (AUTH_SECRET); the shell runs the OIDC login for both realms
      const vals = {
        KONG_URL: e.KONG_URL,
        NEXT_PUBLIC_APP_URL: e.NEXT_PUBLIC_APP_URL,
        AUTH_SECRET: e.AUTH_SECRET,
        AUTH_ISSUER_BASE: e.KEYCLOAK_URL,
        AUTH_CUSTOMERS_CLIENT_ID: 'web',
        AUTH_CUSTOMERS_CLIENT_SECRET: e.KEYCLOAK_WEB_CLIENT_SECRET,
        AUTH_STAFF_CLIENT_ID: 'web-admin',
        AUTH_STAFF_CLIENT_SECRET: e.KEYCLOAK_WEB_ADMIN_CLIENT_SECRET,
      };
      if (z.name === 'shell') for (const x of zs.filter((y) => y.basePath)) vals[`ZONE_${x.name.toUpperCase().replace(/-/g, '_')}_URL`] = `http://localhost:${x.port}`;
      writeEnv(join(z.path, '.env.local'), vals, `# GENERATED by \`ac configure\` — ${z.name} zone (server-side values)`);
    }
    ok(`${zs.length} zone .env.local files`);
  }
}

// ───────────────────────────────────────────── infra
const composeArgs = (...a) => ['compose', '-f', P.compose, '--env-file', P.env, ...a];
const ALL_PROFILES = ['--profile', 'llmops', '--profile', 'tools'];
const compose = (args, opts) => run('docker', composeArgs(...args), { cwd: PLATFORM, env: { AC_BACKEND_DIR: BACKEND }, ...opts });
const composeSh = (args, opts) => sh('docker', composeArgs(...args), { cwd: PLATFORM, env: { AC_BACKEND_DIR: BACKEND }, ...opts });
function ensureDocker() {
  const r = sh('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (r.missing) die('Docker is not installed — run: ac tools --install');
  if (!r.ok) die('Docker engine is not running — start Docker Desktop / OrbStack and retry');
  if (!existsSync(P.env)) die('platform/.env missing — run: ac configure');
}

/** target 'local' = services on the host (compose Kong); 'k8s' = Services in namespace ac-apps (cluster Kong). */
function generateKong(target = 'local', { origins: originsOverride } = {}) {
  const env = readEnv();
  const k8s = target === 'k8s';
  const origins = originsOverride ?? [env.NEXT_PUBLIC_APP_URL || 'http://localhost:3300'];
  const upstream = (s) => (k8s ? `http://${s.dir}.ac-apps.svc.cluster.local:${s.port}` : `http://host.docker.internal:${s.port}`);
  const file = k8s ? P.kongK8s : P.kong;
  const svcs = services();
  const lines = [
    '# GENERATED by `ac kong` / `ac infra up|init` from backend/services/*/package.json "ac" metadata — do not edit.',
    '# http://<kong>/api/<service>/v1/... → <service>/v1/...   JWTs are verified by every service (zero trust).',
    '_format_version: "3.0"',
    '_transform: true',
    svcs.length ? 'services:' : 'services: []',
  ];
  for (const s of svcs) {
    const isAgents = s.kind === 'agents';
    lines.push(
      `  - name: ${s.dir}`,
      `    url: ${upstream(s)}`,
      '    connect_timeout: 5000',
      `    read_timeout: ${isAgents ? 300000 : 30000}`,
      `    write_timeout: ${isAgents ? 300000 : 30000}`,
      '    routes:',
      `      - name: ${s.dir}`,
      `        paths: [/api/${s.dir}]`,
      '        strip_path: true',
      ...(isAgents ? ['        response_buffering: false', '        request_buffering: false'] : []),
      '    plugins:',
      '      - name: rate-limiting',
      `        config: { minute: ${isAgents ? 60 : 1200}, policy: local, limit_by: ip }`,
    );
  }
  lines.push(
    'plugins:',
    '  - name: correlation-id',
    '    config: { header_name: X-Request-ID, generator: uuid, echo_downstream: true }',
    '  - name: cors',
    `    config: { origins: ${JSON.stringify(origins)}, credentials: true, methods: [GET, POST, PUT, PATCH, DELETE, OPTIONS], headers: [Authorization, Content-Type, Idempotency-Key, If-Match, X-Request-ID, Accept], max_age: 3600 }`,
    '  - name: request-size-limiting',
    '    config: { allowed_payload_size: 20, size_unit: megabytes }',
  );
  const text = `${lines.join('\n')}\n`;
  const changed = !existsSync(file) || readFileSync(file, 'utf8') !== text;
  mkdirSync(dirname(file), { recursive: true });
  if (changed) writeFileSync(file, text);
  return changed;
}

async function infraUp() {
  step('Local infrastructure (docker compose up)');
  ensureDocker();
  if (process.platform === 'linux') {
    const mm = Number(sh('cat', ['/proc/sys/vm/max_map_count']).out || 0);
    if (mm && mm < 262144) warn('OpenSearch needs vm.max_map_count >= 262144: sudo sysctl -w vm.max_map_count=262144');
  }
  generateKong();
  const profiles = [...(flag('--llmops') ? ['--profile', 'llmops'] : []), ...(flag('--tools') ? ['--profile', 'tools'] : [])];
  compose([...profiles, 'up', '-d', '--wait', '--wait-timeout', '480']);
  ok('containers healthy');
}

/** Database per service: role svc_<db> + database ac_<db> owned by it, CONNECT revoked from everyone else. Idempotent. */
function dbBootstrapSql(env) {
  return services()
    .filter((s) => s.database)
    .map(({ database: d }) => {
      const pw = env[dbEnvKey(d)];
      if (!/^[A-Za-z0-9]+$/.test(pw ?? '')) die(`missing/invalid ${dbEnvKey(d)}`);
      return `SELECT format('CREATE ROLE svc_${d} LOGIN PASSWORD %L', '${pw}') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_${d}')\\gexec
ALTER ROLE svc_${d} PASSWORD '${pw}';
SELECT 'CREATE DATABASE ac_${d} OWNER svc_${d}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ac_${d}')\\gexec
REVOKE CONNECT, TEMPORARY ON DATABASE ac_${d} FROM PUBLIC;
GRANT CONNECT ON DATABASE ac_${d} TO svc_${d};`;
    })
    .join('\n');
}

/** MinIO: bucket + user + bucket-only policy per objectStore service. Runs inside a MinIO image (has mc). Idempotent. */
function objectStoreScript(env, endpoint = 'http://127.0.0.1:9000') {
  const svcs = services().filter((s) => s.objectStore);
  const lines = ['set -e', `until mc alias set ac ${endpoint} minio "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do sleep 2; done`];
  for (const s of svcs) {
    const key = env[s3EnvKey(s.dir)];
    if (!/^[A-Za-z0-9]+$/.test(key ?? '')) die(`missing/invalid ${s3EnvKey(s.dir)} — run: ac configure`);
    const b = `ac-${s.dir}`;
    const policy = JSON.stringify({ Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Action: ['s3:GetBucketLocation', 's3:ListBucket'], Resource: [`arn:aws:s3:::${b}`] },
      { Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], Resource: [`arn:aws:s3:::${b}/*`] }] });
    lines.push(
      `mc mb --ignore-existing ac/${b} >/dev/null`,
      `echo '${policy}' > /tmp/${b}.json`,
      `mc admin policy create ac svc-${s.dir} /tmp/${b}.json >/dev/null`,
      `mc admin user add ac svc-${s.dir} '${key}' >/dev/null`,
      `mc admin policy attach ac svc-${s.dir} --user svc-${s.dir} >/dev/null 2>&1 || true`,
      `echo "bucket ${b} + user svc-${s.dir}"`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function psql(sql) {
  const r = composeSh(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql });
  if (!r.ok) die(`psql failed: ${r.out}`);
  return r.out;
}

async function registryToken(env) {
  const base = env.AC_REGISTRY.replace(/\/?$/, '/');
  const r = await fetch(`${base}-/user/org.couchdb.user:${env.AC_REGISTRY_USER}`, {
    method: 'PUT',
    // Basic auth makes this a login when the user already exists (idempotent re-runs); a plain PUT registers it
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${env.AC_REGISTRY_USER}:${env.AC_REGISTRY_PASSWORD}`).toString('base64')}` },
    body: JSON.stringify({ name: env.AC_REGISTRY_USER, password: env.AC_REGISTRY_PASSWORD, email: `${env.AC_REGISTRY_USER}@example.com` }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) die(`registry login failed (${r.status}): ${JSON.stringify(j)}`);
  return j.token;
}

async function infraInit() {
  step('Initialise infrastructure');
  ensureDocker();
  const env = readEnv();
  // 1. Database per service: own database, own role/password, CONNECT revoked from everyone else
  const dbs = services().filter((s) => s.database);
  const missingPw = dbs.filter((s) => !/^[A-Za-z0-9]+$/.test(env[dbEnvKey(s.database)] ?? ''));
  if (missingPw.length) die(`missing DB passwords for ${missingPw.map((s) => s.dir).join(', ')} — run: ac configure`);
  const sql = dbBootstrapSql(env);
  if (sql) psql(sql);
  ok(`Postgres: ${dbs.length} isolated databases (${dbs.map((s) => `ac_${s.database}`).join(', ')})`);

  // 1b. Object store per service: own bucket + MinIO user limited to it
  const stores = services().filter((s) => s.objectStore);
  if (stores.length) {
    const missing = stores.filter((s) => !env[s3EnvKey(s.dir)]);
    if (missing.length) die(`missing ${missing.map((s) => s3EnvKey(s.dir)).join(', ')} — run: ac configure`);
    const r = composeSh(['exec', '-T', 'minio', 'sh'], { input: objectStoreScript(env) }) // the container has MINIO_ROOT_PASSWORD;
    if (!r.ok) die(`MinIO bootstrap failed: ${r.out}`);
    ok(`MinIO: ${stores.length} isolated bucket(s) (${stores.map((s) => `ac-${s.dir}`).join(', ')})`);
  }

  // 2. Kafka topics
  const { defaults, topics } = readJson(P.topics);
  const existing = composeSh(['exec', '-T', 'redpanda', 'rpk', 'topic', 'list']).out;
  let created = 0;
  for (const t of topics) {
    if (new RegExp(`^${t.name.replace('.', '\\.')}\\s`, 'm').test(existing)) continue;
    const r = composeSh(['exec', '-T', 'redpanda', 'rpk', 'topic', 'create', t.name, '-p', String(t.partitions ?? defaults.partitions), '-c', `retention.ms=${t.retentionMs ?? defaults.retentionMs}`]);
    if (!r.ok && !/already exists/i.test(r.out)) die(`topic ${t.name}: ${r.out}`);
    created++;
  }
  ok(`Kafka: ${topics.length} topics (${created} created)`);

  // 3. OpenSearch index (owned by the search service) behind alias "products"
  const alias = await fetch(`${env.OPENSEARCH_URL}/_alias/products`).catch(() => null);
  if (alias?.status === 200) ok('OpenSearch: alias products exists');
  else {
    const body = readJson(P.osIndex);
    body.aliases = { products: {} };
    const r = await fetch(`${env.OPENSEARCH_URL}/products-v1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) die(`OpenSearch index create failed: ${r.status} ${await r.text()}`);
    ok('OpenSearch: created products-v1 (alias products)');
  }

  // 4. Kong routes from service metadata
  if (generateKong()) {
    compose(['restart', 'kong'], { quiet: true });
    ok('Kong: routes regenerated and reloaded');
  } else ok(`Kong: ${services().length} routes up to date`);

  // 5. Local npm registry account for publishing versioned libs
  const token = await registryToken(env);
  writeEnv(P.env, { AC_REGISTRY_TOKEN: token });
  ok(`registry: ${env.AC_REGISTRY} (publisher ${env.AC_REGISTRY_USER})`);

  // 6. Keycloak realms are imported at container start
  for (const realm of ['customers', 'staff']) {
    const r = await fetch(`${env.KEYCLOAK_URL}/realms/${realm}/.well-known/openid-configuration`).catch(() => null);
    r?.ok ? ok(`Keycloak: realm ${realm}`) : warn(`Keycloak: realm ${realm} not reachable yet`);
  }
}

async function infra() {
  const sub = positional[1] ?? 'status';
  if (sub === 'up') return infraUp();
  if (sub === 'init') return infraInit();
  ensureDocker();
  if (sub === 'down') return compose([...ALL_PROFILES, 'down']);
  if (sub === 'logs') return compose(['logs', '-f', '--tail', '200', ...positional.slice(2)]);
  if (sub === 'status') return compose([...ALL_PROFILES, 'ps', '--format', 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'], { quiet: true });
  if (sub === 'reset') {
    if (!flag('--yes') && !(await confirm(red('Delete ALL local containers AND data volumes (databases, Kafka, registry, Keycloak)?'), false))) return info('cancelled');
    compose([...ALL_PROFILES, 'down', '-v', '--remove-orphans']);
    return ok('local infrastructure removed — run: ac infra up && ac infra init');
  }
  die(`unknown: infra ${sub}`);
}

// ───────────────────────────────────────────── install / build / test / libs
function requireRepos() {
  if (!repoOk(BACKEND)) die(`backend repo not found at ${BACKEND} — run: ac repos`);
  if (!repoOk(FRONTEND)) die(`frontend repo not found at ${FRONTEND} — run: ac repos`);
}
function libsPublish() {
  step('Versioned libraries → local registry');
  const env = readEnv();
  if (!env.AC_REGISTRY_TOKEN) die('no registry token — run: ac infra up && ac infra init');
  run('pnpm', ['exec', 'turbo', 'run', 'build', '--filter', './libs/*'], { cwd: BACKEND });
  run('pnpm', ['libs:publish'], { cwd: BACKEND, env: { AC_REGISTRY: env.AC_REGISTRY, AC_REGISTRY_TOKEN: env.AC_REGISTRY_TOKEN } });
}
function install() {
  requireRepos();
  step('Install — backend');
  run('pnpm', ['install'], { cwd: BACKEND });
  libsPublish();
  step('Install — frontend (consumes @ac/contracts, @ac/money from the registry)');
  run('pnpm', ['install'], { cwd: FRONTEND });
}
function build() {
  requireRepos();
  step('Build — backend');
  run('pnpm', ['exec', 'turbo', 'run', 'build'], { cwd: BACKEND });
  step('Build — frontend');
  run('pnpm', ['exec', 'turbo', 'run', 'build'], { cwd: FRONTEND });
}
function test() {
  requireRepos();
  step('Test — backend');
  run('pnpm', ['exec', 'turbo', 'run', 'test'], { cwd: BACKEND });
  step('Test — frontend');
  run('pnpm', ['exec', 'turbo', 'run', 'test'], { cwd: FRONTEND });
}

// ───────────────────────────────────────────── dev
async function dev() {
  requireRepos();
  const targets = positional.slice(1);
  const svc = new Set(services().map((s) => s.dir));
  const zn = new Set(zones().map((z) => z.name));
  const all = targets.length === 0;
  const backendFilters = all || targets.includes('backend') ? [] : targets.filter((t) => svc.has(t)).map((t) => `@ac/${t}`);
  const frontendFilters = all || targets.includes('frontend') ? [] : targets.filter((t) => zn.has(t)).map((t) => `@ac/zone-${t}`);
  for (const t of targets) if (!['backend', 'frontend'].includes(t) && !svc.has(t) && !zn.has(t)) die(`unknown service or zone: ${t}`);
  if (frontendFilters.length && !frontendFilters.includes('@ac/zone-shell')) {
    frontendFilters.push('@ac/zone-shell');
    info('adding the shell zone (it routes /shop, /account … on http://localhost:3300)');
  }
  const jobs = [];
  if (all || targets.includes('backend') || backendFilters.length) jobs.push([BACKEND, backendFilters]);
  if (all || targets.includes('frontend') || frontendFilters.length) jobs.push([FRONTEND, frontendFilters]);
  const children = jobs.map(([cwd, filters]) => {
    const args = ['exec', 'turbo', 'run', 'dev', '--concurrency=40', '--ui=stream', ...filters.flatMap((f) => ['--filter', `${f}...`])];
    info(dim(`$ (${relative(WS, cwd)}) pnpm ${args.join(' ')}`));
    return spawn('pnpm', args, { cwd, stdio: 'inherit' });
  });
  const stop = () => children.forEach((c) => c.kill('SIGINT'));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await Promise.all(children.map((c) => new Promise((r) => c.on('exit', r))));
}

// ───────────────────────────────────────────── doctor
async function probe(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).status;
  } catch {
    return 0;
  }
}
async function doctor() {
  step('Doctor');
  const req = checkTools({ quiet: true }).filter(({ t, r }) => t.required && !r.ok);
  req.length ? fail(`tools missing: ${req.map(({ t }) => t.id).join(', ')} (ac tools --install)`) : ok('required tools present');
  for (const [name, dir] of [['platform', PLATFORM], ['backend', BACKEND], ['frontend', FRONTEND]]) {
    const isPlatform = name === 'platform';
    if (!isPlatform && !repoOk(dir)) fail(`${name} repo missing (${dir})`);
    else ok(`${name} repo${existsSync(join(dir, '.git')) ? '' : yellow(' (not a git repo — ac repos)')}${isPlatform || existsSync(join(dir, 'node_modules')) ? '' : yellow(' (not installed)')}`);
  }
  if (!existsSync(P.env)) return fail('platform/.env missing (ac configure)');
  const env = readEnv();
  const bad = Object.entries(env).filter(([, v]) => v.startsWith('__generate')).map(([k]) => k);
  bad.length ? fail(`platform/.env has ungenerated secrets: ${bad.join(', ')}`) : ok('platform/.env configured');
  env.OPENAI_API_KEY ? ok('OPENAI_API_KEY set') : warn('OPENAI_API_KEY empty — LLM agents/embeddings disabled');
  const noEnv = services().filter((s) => !existsSync(join(s.path, '.env')));
  noEnv.length ? warn(`services without .env: ${noEnv.map((s) => s.dir).join(', ')} (ac configure)`) : ok(`${services().length} service .env files`);

  if (!sh('docker', ['info', '--format', '{{.ServerVersion}}']).ok) return fail('Docker engine not running');
  const ps = composeSh([...ALL_PROFILES, 'ps', '--format', '{{.Service}}|{{.State}}|{{.Health}}']).out.split('\n').filter(Boolean);
  if (!ps.length) warn('no containers running (ac infra up)');
  for (const line of ps) {
    const [svc, state, health] = line.split('|');
    (state === 'running' && (!health || health === 'healthy') ? ok : warn)(`container ${svc.padEnd(22)} ${state}${health ? ` (${health})` : ''}`);
  }
  for (const [name, url, good] of [
    ['Kong proxy', `${env.KONG_URL}/`, [404]],
    ['Keycloak', `${env.KEYCLOAK_URL}/realms/customers`, [200]],
    ['OpenSearch', `${env.OPENSEARCH_URL}/_cluster/health`, [200]],
    ['OPA', `${env.OPA_URL}/health`, [200]],
    ['Registry', `${env.AC_REGISTRY.replace(/\/?$/, '/')}-/ping`, [200]],
    ['Grafana', 'http://localhost:53000/api/health', [200]],
  ]) {
    const s = await probe(url);
    good.includes(s) ? ok(`${name.padEnd(12)} ${dim(url)}`) : warn(`${name.padEnd(12)} ${dim(url)} → ${s || 'unreachable'}`);
  }
  const svcUp = [];
  for (const s of services()) if ((await probe(`http://localhost:${s.port}/health`)) === 200) svcUp.push(`${s.dir}:${s.port}`);
  svcUp.length ? ok(`services running (${svcUp.length}/${services().length}): ${svcUp.join(', ')}`) : info('no services running (ac dev backend)');
  const zoneUp = [];
  for (const z of zones()) if ((await probe(`http://localhost:${z.port}${z.basePath}/api/health`)) === 200) zoneUp.push(`${z.name}:${z.port}`);
  zoneUp.length ? ok(`zones running (${zoneUp.length}/${zones().length}): ${zoneUp.join(', ')}`) : info('no zones running (ac dev frontend)');
  const opa = await fetch(`${env.OPA_URL}/v1/data/agents/tools/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: { agent: { id: 'assistant' }, tool: 'searchProducts', tool_tier: 'READ' } }),
  })
    .then((r) => r.json())
    .catch(() => null);
  opa?.result?.allow === true ? ok('OPA agent tool policy loaded (backend/policies)') : warn('OPA policy not answering');
}

// ───────────────────────────────────────────── generators (delegate to the owning repo)
async function generate() {
  const [, what, name] = positional;
  const pass = VALUE_FLAGS.filter((f) => !['--platform', '--tag', '--env'].includes(f)).flatMap((f) => (optVal(f) ? [f === '--path' ? '--base' : f, optVal(f)] : [])).concat(flag('--no-db') ? ['--no-db'] : []);
  if (what === 'service' || what === 'agent') {
    requireRepos();
    run('pnpm', ['gen', what, name ?? '', ...pass], { cwd: BACKEND });
    if (what === 'service') info('then: (backend) pnpm install → ac configure → ac infra init → ac dev ' + (name ?? ''));
  } else if (what === 'zone') {
    requireRepos();
    run('pnpm', ['gen', 'zone', name ?? '', ...pass], { cwd: FRONTEND });
    info('then: (frontend) pnpm install → ac configure → ac dev ' + (name ?? '') + '  (shell picks up the rewrite on restart)');
  } else die('usage: ac new <service|agent|zone> <name> …');
}

// ───────────────────────────────────────────── demo data
/** Each service seeds ONLY its own database from the shared deterministic demo world (@ac/demo-data). */
function seed() {
  requireRepos();
  const list = services().filter((s) => s.hasSeed && (positional.length < 2 || positional.slice(1).includes(s.dir)));
  step(`Seed demo data (${list.map((s) => s.dir).join(', ')})`);
  // A service running under `ac dev` keeps its own dist/ fresh; `nest build` would wipe that dist and crash it,
  // so for those we build only their dependencies (libs) and seed from the watcher's output.
  const running = (s) => spawnSync('lsof', ['-ti', `tcp:${s.port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout?.trim().length > 0;
  const filters = list.flatMap((s) => ['--filter', running(s) && existsSync(join(s.path, 'dist', 'seed.js')) ? `@ac/${s.dir}^...` : `@ac/${s.dir}...`]);
  run('pnpm', ['exec', 'turbo', 'run', 'build', ...filters], { cwd: BACKEND, quiet: true });
  for (const s of list) run('pnpm', ['--filter', `@ac/${s.dir}`, 'seed'], { cwd: BACKEND, quiet: true });
  ok(`seeded ${list.length} services — sign in as buyer/buyer, seller/seller or staff users to see their dashboards`);
}

// ───────────────────────────────────────────── misc commands
/** Deployable ids: services = <name>, zones = zone-<name> (same as their Kubernetes Deployments). */
function resolveDeployable(id) {
  const svc = services().find((s) => s.dir === id);
  if (svc) return { kind: 'service', name: id, image: id, svc };
  const zname = id?.startsWith('zone-') ? id.slice(5) : id;
  const zone = zones().find((z) => z.name === zname);
  if (zone) return { kind: 'zone', name: zname, image: `zone-${zname}`, zone };
  return null;
}

function dockerBuild() {
  ensureDocker();
  const name = positional[2];
  const platform = optVal('--platform') ? ['--platform', optVal('--platform')] : []; // e.g. linux/arm64 for Graviton ECS
  const d = resolveDeployable(name);
  const svc = d?.kind === 'service' ? d.svc : null;
  const zone = d?.kind === 'zone' ? d.zone : null;
  if (name === 'edge') {
    generateKong('k8s');
    copyFileSync(P.kongK8s, join(PLATFORM, 'infra', 'kong', 'kong.cloud.yml'));
    return run('docker', ['build', ...platform, '-t', 'ac/edge:local', '.'], { cwd: join(PLATFORM, 'infra', 'kong') });
  }
  if (svc) return run('docker', ['build', ...platform, '-f', `services/${name}/Dockerfile`, '-t', `ac/${name}:local`, '.'], { cwd: BACKEND });
  if (zone) {
    const env = readEnv();
    return run('docker', ['build', ...platform, '--add-host=host.docker.internal:host-gateway', '--build-arg', `AC_REGISTRY=${env.AC_REGISTRY.replace('localhost', 'host.docker.internal')}`, '-f', `apps/${zone.name}/Dockerfile`, '-t', `ac/zone-${zone.name}:local`, '.'], { cwd: FRONTEND });
  }
  die(`usage: ac docker build <service|zone-<zone>|edge> [--platform linux/arm64] — known: ${[...knownDeployables(), 'edge'].join(', ')}`);
}
async function token() {
  const env = readEnv();
  const [realm = 'customers', user = 'buyer', password = user] = positional.slice(1);
  const client = realm === 'staff' ? ['web-admin', env.KEYCLOAK_WEB_ADMIN_CLIENT_SECRET] : ['web', env.KEYCLOAK_WEB_CLIENT_SECRET];
  const r = await fetch(`${env.KEYCLOAK_URL}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: client[0], client_secret: client[1], username: user, password, scope: 'openid' }),
  });
  const j = await r.json();
  if (!r.ok) die(`token request failed: ${JSON.stringify(j)}`);
  console.log(j.access_token);
}
function policyTest() {
  ensureDocker();
  run('docker', ['run', '--rm', '-v', `${join(BACKEND, 'policies')}:/policies:ro`, 'openpolicyagent/opa:1.21.3', 'test', '/policies', '-v']);
}
function k6() {
  ensureDocker();
  const env = readEnv();
  // AC_K6_<NAME>=value in the caller's environment → __ENV.<NAME> inside the script (e.g. AC_K6_SERVICE_TOKEN)
  const extra = Object.entries(process.env).filter(([k]) => k.startsWith('AC_K6_')).flatMap(([k, v]) => ['-e', `${k.slice(6)}=${v}`]);
  run('docker', ['run', '--rm', '-i', '--add-host=host.docker.internal:host-gateway', '-v', `${join(PLATFORM, 'tests', 'load')}:/scripts:ro`, '-e', `BASE_URL=${env.KONG_URL.replace('localhost', 'host.docker.internal')}`, '-e', `WEB_URL=${env.NEXT_PUBLIC_APP_URL.replace('localhost', 'host.docker.internal')}`, ...extra, 'grafana/k6', 'run', `/scripts/${positional[1] ?? 'smoke.js'}`]);
}
function stripe() {
  ensureDocker();
  const env = readEnv();
  if (!env.STRIPE_SECRET_KEY) die('STRIPE_SECRET_KEY is empty — run ac configure');
  info('Copy the printed whsec_… into STRIPE_WEBHOOK_SECRET in platform/.env, then ac configure');
  run('docker', ['run', '--rm', '-it', '--add-host=host.docker.internal:host-gateway', 'stripe/stripe-cli', 'listen', '--api-key', env.STRIPE_SECRET_KEY, '--forward-to', 'host.docker.internal:58000/api/payment/v1/webhooks/stripe']);
}
function tf() {
  const [, target, action = 'plan'] = positional;
  if (target !== 'oci') die('usage: ac tf oci <init|plan|apply|destroy|output> (AWS Terraform is archived in platform/terraform-aws-archive)');
  const dir = join(P.deploy, 'terraform', 'oci');
  if (!has('terraform', ['version'])) die('terraform not installed — ac tools --install');
  if (['plan', 'apply', 'destroy'].includes(action) && !existsSync(join(dir, 'terraform.tfvars'))) die('copy deploy/terraform/oci/terraform.tfvars.example to terraform.tfvars and fill it in first');
  run('terraform', [`-chdir=${dir}`, action, ...positional.slice(3)]);
}

// ───────────────────────────────────────────── Kubernetes (k3s) — platform/deploy
const K = {
  envs: join(PLATFORM, 'deploy', 'envs'),
  infraChart: join(PLATFORM, 'deploy', 'helm', 'agentic-infra'),
  appsChart: join(PLATFORM, 'deploy', 'helm', 'agentic-commerce'),
  catalogue: join(PLATFORM, 'deploy', 'helm', 'agentic-commerce', 'values.services.yaml'),
  traefik: join(PLATFORM, 'deploy', 'k3s', 'traefik-config.yaml'),
  local: join(PLATFORM, 'deploy', '.local'),
  k3sImage: 'rancher/k3s:v1.34.12-k3s1',
  k3sName: 'ac-k3s',
};
const envCfg = (env) => {
  const f = join(K.envs, `${env}.json`);
  if (!existsSync(f)) die(`unknown environment "${env}" — create deploy/envs/${env}.json (see local.json / prod.json)`);
  return readJson(f);
};
const kubeconfig = (env) => join(K.envs, `${env}.kubeconfig`);
function kube(env, cmd, args, opts = {}) {
  const kc = kubeconfig(env);
  if (!existsSync(kc)) die(`no kubeconfig for ${env} — ${env === 'local' ? 'ac k8s local up' : `ac k8s kubeconfig ${env}`}`);
  return (opts.capture ? sh : run)(cmd, args, { ...opts, env: { KUBECONFIG: kc, ...opts.env } });
}
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const deepMerge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  return out;
};
const tmpJson = (name, obj) => {
  mkdirSync(K.local, { recursive: true });
  const f = join(K.local, name);
  writeFileSync(f, JSON.stringify(obj));
  return f;
};

/** chart catalogue (values.services.yaml) generated from backend service metadata + frontend/zones.json */
function k8sValues() {
  const lines = ['# GENERATED by `ac k8s values` from backend/services/*/package.json "ac" + frontend/zones.json — do not edit.', 'services:'];
  for (const s of services()) {
    lines.push(`  ${s.dir}:`, `    port: ${s.port}`, `    image: ${s.dir}`, `    database: ${s.database ? JSON.stringify(s.database) : 'null'}`, `    owner: ${JSON.stringify(s.owner ?? 'unknown')}`);
  }
  lines.push('zones:');
  for (const z of zones()) lines.push(`  ${z.name}:`, `    port: ${z.port}`, `    basePath: ${JSON.stringify(z.basePath)}`, `    image: zone-${z.name}`, `    owner: ${JSON.stringify(z.owner ?? 'unknown')}`);
  writeFileSync(K.catalogue, `${lines.join('\n')}\n`);
  return { services: services().length, zones: zones().length };
}

/** deploy/envs/<env>.env — secrets for one cluster. Generated with random values on first use. */
function k8sEnv(env) {
  const f = join(K.envs, `${env}.env`);
  const cur = readEnv(f);
  const upd = {};
  const gen = (k) => cur[k] || (upd[k] = secret());
  ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'KEYCLOAK_ADMIN_PASSWORD', 'KEYCLOAK_DB_PASSWORD', 'MINIO_ROOT_PASSWORD', 'AUTH_SECRET', 'KEYCLOAK_WEB_CLIENT_SECRET', 'KEYCLOAK_WEB_ADMIN_CLIENT_SECRET', 'KEYCLOAK_AGENTS_CLIENT_SECRET', 'KEYCLOAK_SERVICES_CLIENT_SECRET', 'KEYCLOAK_USER_SERVICE_CLIENT_SECRET'].forEach(gen);
  for (const s of services()) if (s.database) gen(dbEnvKey(s.database));
  for (const s of services()) if (s.objectStore) gen(s3EnvKey(s.dir));
  const local = readEnv(); // reuse local API keys for the local cluster only
  const example = readEnv(P.envEx);
  for (const k of new Set(services().flatMap((s) => s.secrets ?? []))) {
    if (k in cur || k in upd) continue;
    // secrets the platform generates itself (`__generate__` in .env.example, e.g. TESTPAY_WEBHOOK_SECRET) get a fresh value per cluster
    upd[k] = example[k] === '__generate__' ? secret() : env === 'local' ? (local[k] ?? '') : '';
  }
  if (env !== 'local') for (const k of ['GHCR_USER', 'GHCR_TOKEN', 'ACME_EMAIL', 'SSH_HOST', 'SSH_USER']) if (!(k in cur)) upd[k] = k === 'SSH_USER' ? 'ubuntu' : '';
  if (Object.keys(upd).length) {
    writeEnv(f, upd, `# ${env} cluster secrets — GENERATED by \`ac k8s secrets ${env}\`; NEVER commit. Fill API keys (OPENAI_API_KEY, STRIPE_*, GHCR_TOKEN …) by hand.`);
    ok(`deploy/envs/${env}.env: ${Object.keys(upd).length} values added`);
  }
  return { file: f, values: readEnv(f) };
}

function k8sSecrets(env) {
  step(`Secrets → ${env}`);
  const cfg = envCfg(env);
  const { file, values: e } = k8sEnv(env);
  const pub = cfg.publicUrl;
  const secretObj = (ns, name, data, type = 'Opaque') => ({ apiVersion: 'v1', kind: 'Secret', type, metadata: { name, namespace: ns, labels: { 'app.kubernetes.io/part-of': 'agentic-commerce' } }, stringData: data });
  const items = [
    { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'ac-infra' } },
    { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'ac-apps' } },
    secretObj('ac-infra', 'ac-infra', Object.fromEntries(['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'KEYCLOAK_ADMIN_PASSWORD', 'KEYCLOAK_DB_PASSWORD', 'MINIO_ROOT_PASSWORD'].map((k) => [k, e[k]]))),
    secretObj('ac-apps', 'ac-db-bootstrap', { POSTGRES_PASSWORD: e.POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD: e.MINIO_ROOT_PASSWORD, 'bootstrap.sql': `${dbBootstrapSql(e)}\n`, 'objectstore.sh': objectStoreScript(e, 'http://minio.ac-infra.svc.cluster.local:9000') }),
  ];
  for (const s of services()) {
    const data = {};
    if (s.database) data.DATABASE_URL = `postgresql://svc_${s.database}:${e[dbEnvKey(s.database)]}@postgres.ac-infra.svc.cluster.local:5432/ac_${s.database}`;
    if (s.objectStore) Object.assign(data, s3Vals(s, e, 'http://minio.ac-infra.svc.cluster.local:9000'));
    Object.assign(data, callerVals(s, e));
    for (const k of s.secrets ?? []) data[k] = e[k] ?? '';
    items.push(secretObj('ac-apps', `svc-${s.dir}`, data)); // ONLY this service's database and declared secrets
  }
  for (const z of zones()) {
    items.push(secretObj('ac-apps', `zone-${z.name}`, {
      AUTH_SECRET: e.AUTH_SECRET,
      AUTH_ISSUER_BASE: `${pub}/auth`,
      AUTH_INTERNAL_BASE: 'http://keycloak.ac-infra.svc.cluster.local:8080/auth',
      AUTH_CUSTOMERS_CLIENT_ID: 'web',
      AUTH_CUSTOMERS_CLIENT_SECRET: e.KEYCLOAK_WEB_CLIENT_SECRET,
      AUTH_STAFF_CLIENT_ID: 'web-admin',
      AUTH_STAFF_CLIENT_SECRET: e.KEYCLOAK_WEB_ADMIN_CLIENT_SECRET,
    }));
  }
  if (e.GHCR_TOKEN) {
    const auth = Buffer.from(`${e.GHCR_USER}:${e.GHCR_TOKEN}`).toString('base64');
    items.push({ ...secretObj('ac-apps', 'ghcr', {}, 'kubernetes.io/dockerconfigjson'), stringData: { '.dockerconfigjson': JSON.stringify({ auths: { 'ghcr.io': { auth } } }) } });
  }
  const r = sh('kubectl', ['apply', '-f', '-'], { input: JSON.stringify({ apiVersion: 'v1', kind: 'List', items }), env: { KUBECONFIG: kubeconfig(env) } });
  if (!r.ok) die(`kubectl apply failed: ${r.out}`);
  ok(`${items.length - 2} secrets applied (per service: svc-<name> = own DATABASE_URL + declared secrets only)`);
  return createHashFor(readFileSync(file, 'utf8'));
}
const createHashFor = (text) => {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
};

/** release manifest deploy/envs/<env>.tags.json: { current: {name: tag}, history: [...] } */
function tagsFile(env) {
  const f = join(K.envs, `${env}.tags.json`);
  const t = existsSync(f) ? readJson(f) : { current: {}, history: [] };
  return { f, t, save: () => writeFileSync(f, `${JSON.stringify(t, null, 2)}\n`) };
}
const knownDeployables = () => [...services().map((s) => s.dir), ...zones().map((z) => `zone-${z.name}`)];

function realmsFor(cfg, e) {
  const out = {};
  for (const realm of ['customers', 'staff']) {
    let json = readFileSync(join(PLATFORM, 'infra', 'keycloak', `realm-${realm}.json`), 'utf8')
      .replaceAll('http://localhost:3300', cfg.publicUrl)
      .replaceAll('dev-web-admin-secret', e.KEYCLOAK_WEB_ADMIN_CLIENT_SECRET)
      .replaceAll('dev-web-secret', e.KEYCLOAK_WEB_CLIENT_SECRET)
      .replaceAll('dev-agents-secret', e.KEYCLOAK_AGENTS_CLIENT_SECRET)
      .replaceAll('dev-services-secret', e.KEYCLOAK_SERVICES_CLIENT_SECRET)
      .replaceAll('dev-user-service-secret', e.KEYCLOAK_USER_SERVICE_CLIENT_SECRET);
    if (!cfg.publicUrl.startsWith('https://')) json = json.replace(/"sslRequired": "[a-z]+"/, '"sslRequired": "none"');
    else json = json.replace(/"sslRequired": "[a-z]+"/, '"sslRequired": "external"');
    out[`realm-${realm}.json`] = json;
  }
  return out;
}

function opaBundleB64() {
  ensureDocker();
  mkdirSync(K.local, { recursive: true });
  run('docker', ['run', '--rm', '-v', `${join(BACKEND, 'policies')}:/policies:ro`, '-v', `${K.local}:/out`, 'openpolicyagent/opa:1.21.3', 'build', '-b', '/policies', '-o', '/out/agents.tar.gz'], { quiet: true });
  return readFileSync(join(K.local, 'agents.tar.gz')).toString('base64');
}

async function k8sDeploy(env) {
  const cfg = envCfg(env);
  const names = positional.slice(3);
  for (const n of names) if (!knownDeployables().includes(n)) die(`unknown service/zone: ${n}`);
  const tag = optVal('--tag');
  if (tag && !names.length) die('--tag needs explicit names: ac k8s deploy <env> <name…> --tag X');
  step(`Deploy → ${env}${names.length ? ` (${names.join(', ')})` : ' (everything)'}`);
  const counts = k8sValues();
  ok(`catalogue: ${counts.services} services, ${counts.zones} zones (values.services.yaml)`);
  const secretsVersion = k8sSecrets(env);
  const e = readEnv(join(K.envs, `${env}.env`));

  const tags = tagsFile(env);
  if (tag) {
    for (const n of names) {
      const from = tags.t.current[n] ?? cfg.defaultTag;
      if (from !== tag) tags.t.history.push({ at: new Date().toISOString(), name: n, from, to: tag });
      tags.t.current[n] = tag;
    }
    tags.save();
    ok(`release manifest: ${names.map((n) => `${n}=${tag}`).join(', ')} (deploy/envs/${env}.tags.json)`);
  }
  const tagValues = { services: {}, zones: {} };
  for (const [n, t] of Object.entries(tags.t.current)) {
    const d = resolveDeployable(n);
    if (d) (d.kind === 'service' ? tagValues.services : tagValues.zones)[d.name] = { tag: t };
  }

  const tls = cfg.tls ? { secretName: cfg.tls.secretName } : null;
  const annotations = cfg.tls?.clusterIssuer ? { 'cert-manager.io/cluster-issuer': cfg.tls.clusterIssuer } : {};
  if (!names.length || flag('--infra')) {
    const infraValues = deepMerge(
      {
        publicUrl: cfg.publicUrl,
        host: cfg.host ?? '',
        tls: tls && { host: cfg.host, secretName: tls.secretName },
        ingressAnnotations: annotations,
        keycloak: { realms: realmsFor(cfg, e) },
        kafkaTopics: readFileSync(P.topics, 'utf8'),
        opensearchIndex: readFileSync(P.osIndex, 'utf8'),
      },
      cfg.infra,
    );
    kube(env, 'helm', ['upgrade', '--install', 'agentic-infra', K.infraChart, '-n', 'ac-infra', '--create-namespace', '-f', tmpJson(`${env}-infra.json`, infraValues), '--wait', '--timeout', '15m']);
    ok('agentic-infra ready');
    if (flag('--infra-only')) return;
  }
  generateKong('k8s', { origins: [cfg.publicUrl] });
  const appValues = deepMerge(
    deepMerge(
      {
        global: {
          publicUrl: cfg.publicUrl,
          host: cfg.host ?? '',
          imageRegistry: cfg.imageRegistry,
          defaultTag: cfg.defaultTag,
          imagePullPolicy: env === 'local' ? 'Never' : 'IfNotPresent',
          imagePullSecrets: e.GHCR_TOKEN && cfg.imagePullSecret ? [cfg.imagePullSecret] : [],
          secretsVersion,
          tls,
          ingressAnnotations: annotations,
        },
        serviceEnv: { PLATFORM_SERVICES: services().map((x) => x.dir).join(',') },
        edge: { config: readFileSync(P.kongK8s, 'utf8') },
        opa: { bundle: opaBundleB64() },
      },
      tagValues,
    ),
    cfg.apps,
  );
  kube(env, 'helm', ['upgrade', '--install', 'agentic-commerce', K.appsChart, '-n', 'ac-apps', '--create-namespace', '-f', K.catalogue, '-f', tmpJson(`${env}-apps.json`, appValues), '--wait', '--timeout', '15m']);
  ok(`agentic-commerce deployed → ${cfg.publicUrl}/`);
}

function k8sRollback(env) {
  const name = positional[3];
  if (!name) die('usage: ac k8s rollback <env> <name>');
  const tags = tagsFile(env);
  const last = [...tags.t.history].reverse().find((h) => h.name === name && tags.t.current[name] === h.to);
  if (!last) die(`no previous release of ${name} in deploy/envs/${env}.tags.json — use: kubectl rollout undo deployment/<name> -n ac-apps`);
  info(`${name}: ${last.to} → ${last.from}`);
  positional.splice(3, positional.length - 3, name);
  argv.push('--tag', last.from);
  return k8sDeploy(env);
}

async function k8sLocal() {
  const sub = positional[2] ?? 'up';
  ensureDocker();
  if (sub === 'down') {
    sh('docker', ['rm', '-f', K.k3sName]);
    return ok('local k3s removed');
  }
  if (sub === 'up') {
    step('Local k3s (in Docker)');
    mkdirSync(K.local, { recursive: true });
    if (!sh('docker', ['inspect', K.k3sName]).ok) {
      run('docker', ['run', '-d', '--name', K.k3sName, '--privileged', '--restart', 'unless-stopped', '-p', '6445:6443', '-p', '8088:80', '-e', 'K3S_KUBECONFIG_OUTPUT=/output/kubeconfig.yaml', '-e', 'K3S_KUBECONFIG_MODE=666', '-v', `${K.local}:/output`, K.k3sImage, 'server', '--tls-san', '127.0.0.1']);
    }
    const kcSrc = join(K.local, 'kubeconfig.yaml');
    for (let i = 0; i < 60 && !existsSync(kcSrc); i++) await new Promise((r) => setTimeout(r, 2000));
    if (!existsSync(kcSrc)) die('k3s did not write a kubeconfig — docker logs ac-k3s');
    writeFileSync(kubeconfig('local'), readFileSync(kcSrc, 'utf8').replace(/https:\/\/127\.0\.0\.1:6443/, 'https://127.0.0.1:6445'));
    for (let i = 0; i < 60; i++) {
      if (kube('local', 'kubectl', ['get', 'nodes'], { capture: true }).out.includes(' Ready')) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    kube('local', 'kubectl', ['apply', '-f', K.traefik], { quiet: true });
    return ok('k3s ready — kubeconfig deploy/envs/local.kubeconfig, ingress http://localhost:8088 · next: ac k8s local load && ac k8s deploy local');
  }
  if (sub === 'load') {
    if (flag('--infra')) {
      // third-party images already in Docker (from `ac infra up`) → straight into k3s, no second download
      const imgs = new Set();
      for (const chart of [K.infraChart, K.appsChart]) for (const m of readFileSync(join(chart, 'values.yaml'), 'utf8').matchAll(/^\s+image: ([^\s#]+)/gm)) imgs.add(m[1]);
      for (const img of [...imgs, 'curlimages/curl:8.17.0']) {
        const ref = img.includes(':') ? img : `${img}:latest`;
        if (!sh('docker', ['image', 'inspect', ref]).ok) {
          info(`not in Docker, k3s will pull it: ${ref}`);
          continue;
        }
        const r = spawnSync('sh', ['-c', `docker save ${ref} | docker exec -i ${K.k3sName} ctr -n k8s.io images import -`], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
        r.status === 0 ? ok(`loaded ${ref}`) : warn(`could not import ${ref}: ${r.stderr.slice(0, 200)}`);
      }
      if (!positional.slice(3).length) return;
    }
    const wanted = positional.slice(3).length ? positional.slice(3) : knownDeployables();
    for (const n of wanted) {
      const d = resolveDeployable(n) ?? die(`unknown: ${n}`);
      const image = `ac/${d.image}:local`;
      if (!sh('docker', ['image', 'inspect', image]).ok) {
        info(`building ${image}`);
        positional.splice(2, positional.length - 2, n);
        dockerBuild();
      }
      const save = spawnSync('sh', ['-c', `docker save ${image} | docker exec -i ${K.k3sName} ctr -n k8s.io images import -`], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
      if (save.status !== 0) die(`import ${image} failed: ${save.stderr}`);
      ok(`loaded ${image} into k3s`);
    }
    return;
  }
  die('usage: ac k8s local up|load [names…]|down');
}

async function k8sKubeconfig(env) {
  const { values: e } = k8sEnv(env);
  if (!e.SSH_HOST) die(`set SSH_HOST (VM public IP, from: ac tf oci output) in deploy/envs/${env}.env`);
  const r = sh('ssh', ['-o', 'StrictHostKeyChecking=accept-new', `${e.SSH_USER || 'ubuntu'}@${e.SSH_HOST}`, 'sudo cat /etc/rancher/k3s/k3s.yaml']);
  if (!r.ok) die(`could not read the kubeconfig over SSH: ${r.out}`);
  writeFileSync(kubeconfig(env), r.out.replace(/https:\/\/127\.0\.0\.1:6443/, `https://${e.SSH_HOST}:6443`), { mode: 0o600 });
  ok(`wrote deploy/envs/${env}.kubeconfig (API reachable only from admin_cidr)`);
}

async function k8s() {
  const sub = positional[1];
  const env = positional[2];
  if (sub === 'local') return k8sLocal();
  if (sub === 'values') {
    const c = k8sValues();
    return ok(`values.services.yaml: ${c.services} services, ${c.zones} zones`);
  }
  if (!env) die('usage: ac k8s <secrets|deploy|rollback|status|kubeconfig> <env> …  (envs: deploy/envs/*.json)');
  if (sub === 'secrets') return void k8sSecrets(env);
  if (sub === 'deploy') return k8sDeploy(env);
  if (sub === 'rollback') return k8sRollback(env);
  if (sub === 'kubeconfig') return k8sKubeconfig(env);
  if (sub === 'seed') {
    if (env === 'prod' && !flag('--yes')) die('refusing to seed demo data into prod without --yes');
    for (const s of services().filter((x) => x.hasSeed)) {
      kube(env, 'kubectl', ['exec', '-n', 'ac-apps', `deploy/${s.dir}`, '--', 'node', 'dist/seed.js'], { quiet: true });
      ok(`seeded ${s.dir} (inside its own pod, own database)`);
    }
    return;
  }
  if (sub === 'status') {
    kube(env, 'helm', ['list', '-A'], { quiet: true });
    return kube(env, 'kubectl', ['get', 'pods', '-n', 'ac-infra', '-o', 'wide'], { quiet: true }), kube(env, 'kubectl', ['get', 'pods', '-n', 'ac-apps', '-o', 'wide'], { quiet: true });
  }
  die(`unknown: k8s ${sub}`);
}

function dockerPush() {
  const name = positional[2];
  const tag = optVal('--tag');
  const env = optVal('--env') ?? 'prod';
  if (!name || !tag) die('usage: ac docker push <service|zone> --tag X [--env prod]');
  const cfg = envCfg(env);
  const image = (resolveDeployable(name) ?? die(`unknown: ${name} (zones: zone-<name>)`)).image;
  const target = `${cfg.imageRegistry}/${image}:${tag}`;
  run('docker', ['tag', `ac/${image}:local`, target]);
  run('docker', ['push', target]);
  ok(`pushed ${target} — deploy it with: ac k8s deploy ${env} ${name} --tag ${tag}`);
}

// ───────────────────────────────────────────── setup
async function setup() {
  console.log(bold(`\nagentic-commerce workspace setup — ${IS_MAC ? 'macOS' : 'Linux'}\n${dim(WS)}\n`));
  await tools();
  repos();
  await configure();
  if (!flag('--no-infra')) {
    await infraUp();
    await infraInit();
  }
  install();
  if (!flag('--no-build')) build();
  await doctor();
  console.log(`
${bold('Next steps')}
  ac dev                       all services + all zones → http://localhost:3300 (zones: /shop /account /seller /admin)
  ac dev catalog storefront    a subset (the shell is added automatically)
  ac doctor                    health of tools, repos, infra, services and zones
  Consoles: Kong :58000 · Redpanda http://localhost:58080 · Keycloak http://localhost:58180 · Registry http://localhost:54873
  Claude Code: open any repo (or the workspace root) — each repo has CLAUDE.md + .claude/skills + .claude/agents
`);
}

// ───────────────────────────────────────────── main
try {
  switch (command) {
    case 'setup': await setup(); break;
    case 'tools': await tools(); break;
    case 'repos': repos(); break;
    case 'configure': await configure(); break;
    case 'install': install(); break;
    case 'build': build(); break;
    case 'test': test(); break;
    case 'libs': if (positional[1] !== 'publish') die('usage: ac libs publish'); libsPublish(); break;
    case 'infra': await infra(); break;
    case 'doctor': await doctor(); break;
    case 'seed': seed(); break;
    case 'dev': await dev(); break;
    case 'new': await generate(); break;
    case 'docker': positional[1] === 'push' ? dockerPush() : dockerBuild(); break;
    case 'token': await token(); break;
    case 'policy': policyTest(); break;
    case 'k6': k6(); break;
    case 'stripe': stripe(); break;
    case 'tf': tf(); break;
    case 'kong': {
      const k8s = flag('--k8s') || flag('--cloud');
      generateKong(k8s ? 'k8s' : 'local');
      ok(`wrote ${relative(WS, k8s ? P.kongK8s : P.kong)}`);
      break;
    }
    case 'k8s': await k8s(); break;
    case 'help': case '-h':
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
      break;
    default: die(`unknown command "${command}" — run: ac help`);
  }
} catch (e) {
  if (e instanceof CliError) {
    fail(e.message);
    process.exit(1);
  }
  throw e;
}
