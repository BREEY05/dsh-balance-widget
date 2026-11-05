import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const inject = ['credentials', 'webServer', 'connection'];

/**
 * Known balance sources, keyed by model-provider id.
 *
 * A provider id is whatever the profile calls the route, and several ids can bill the same
 * wallet with different credentials (`taffy`, `tafy`, and `ds` all point at taffy.work but are
 * configured with different API keys). Each row names its own credential and route so a newly
 * added provider never silently loses its balance.
 *
 * Rows are only a shortcut: unknown ids fall through to `discoverUsage`, which reads the profile
 * config for that provider's `baseURL` and probes the documented balance endpoints itself, so
 * adding a provider to the profile never requires editing this table.
 *
 * `client.js` keeps a matching label map; `switching.test.mjs` asserts the two agree.
 */
export const SOURCES = {
  aigocode: {
    label: 'AIGoCode',
    path: '/api/aigocode-usage',
    apiKeyEnv: 'AIGOCODE_API_KEY',
    usageUrl: 'https://api.aigocode.dev/v1/usage',
  },
  taffy: {
    label: 'Taffy',
    path: '/api/taffy-usage',
    apiKeyEnv: 'TAFFY_API_KEY',
    usageUrl: 'https://taffy.work/v1/usage',
  },
  tafy: {
    label: 'Taffy',
    path: '/api/tafy-usage',
    apiKeyEnv: 'TAFFY_API_KEY',
    usageUrl: 'https://taffy.work/v1/usage',
  },
  ds: {
    label: 'Taffy',
    path: '/api/ds-usage',
    apiKeyEnv: 'DS_API_KEY',
    usageUrl: 'https://taffy.work/v1/usage',
  },
  'deepseek-official': {
    label: 'DeepSeek',
    path: '/api/deepseek-usage',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    usageUrl: 'https://api.deepseek.com/user/balance',
  },
};

/** Endpoint paths documented by the provider families this plugin meets in practice. */
export const USAGE_PATHS = [
  '/user/balance', // DeepSeek platform
  '/v1/usage', // AIGoCode, Taffy and most OpenAI-compatible gateways
  '/v1/credits', // OpenRouter style
  '/v1/dashboard/billing/subscription', // OpenAI style
  '/api/user/self', // One-API / New-API style
  '/v1/balance',
  '/api/usage',
  '/usage',
];

const BALANCE_KEYS = [
  'balance',
  'remaining',
  'remaining_balance',
  'total_balance',
  'total_available',
  'available_balance',
  'available',
  'credits',
  'amount',
];

function numeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function unitOf(value, fallback = 'USD') {
  const text = typeof value === 'string' && value.trim() !== '' ? value : fallback;
  return text.toUpperCase() === 'CNY' ? 'CNY' : 'USD';
}

/**
 * Pull a remaining balance out of a usage payload without knowing the provider in advance.
 * @returns {{ value: number, unit: string } | null}
 */
export function extractBalance(payload) {
  if (payload === null || typeof payload !== 'object') return null;
  const infos = payload.balance_infos ?? payload.data?.balance_infos;
  if (Array.isArray(infos) && infos.length > 0) {
    const value = numeric(infos[0]?.total_balance);
    if (value !== null) return { value, unit: unitOf(infos[0]?.currency) };
  }
  const bags = [payload, payload.data, payload.quota, payload.data?.quota];
  for (const bag of bags) {
    if (bag === null || typeof bag !== 'object') continue;
    for (const key of BALANCE_KEYS) {
      const value = numeric(bag[key]);
      if (value !== null) return { value, unit: unitOf(payload.unit ?? payload.currency ?? bag.unit ?? bag.currency) };
    }
  }
  // One-API keeps quota in units of 1/500000 USD.
  const quota = numeric(payload.data?.quota);
  if (quota !== null) return { value: quota / 500000, unit: 'USD' };
  return null;
}

function baseOf(source) {
  const raw = source.baseURL ?? source.usageUrl;
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Probe every documented balance endpoint under one base URL until one answers with a number. */
export async function discoverUsage(apiKey, baseURL) {
  let origin;
  try {
    origin = new URL(baseURL).origin;
  } catch {
    return { error: `${baseURL} is not a URL`, tried: [] };
  }
  const tried = [];
  for (const path of USAGE_PATHS) {
    const url = origin + path;
    let response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
        redirect: 'error',
      });
    } catch {
      tried.push({ url, result: 'unreachable' });
      continue;
    }
    if (!response.ok) {
      tried.push({ url, result: `HTTP ${response.status}` });
      continue;
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      tried.push({ url, result: 'not JSON' });
      continue;
    }
    const found = extractBalance(payload);
    if (found !== null) return { usageUrl: url, ...found, tried };
    tried.push({ url, result: 'no numeric balance' });
  }
  return { error: `no balance endpoint found under ${origin}`, tried };
}

/** Profile files, in the order a patch layer applies. */
async function profileDirs() {
  const root = join(homedir(), '.dsh', 'profiles');
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
}

/**
 * Read `providers:` blocks out of the profile's Cordis YAML without a YAML dependency.
 * Only `id -> { baseURL, apiKeyEnv, api }` is needed here.
 */
export function parseProviderBlocks(text) {
  const lines = String(text).split(/\r?\n/);
  const found = {};
  let base = -1;
  let current = null;
  for (const line of lines) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (/^providers:\s*$/.test(line.trim())) {
      base = indent;
      current = null;
      continue;
    }
    if (base === -1) continue;
    if (indent <= base) {
      base = -1;
      current = null;
      continue;
    }
    if (indent === base + 2) {
      const head = line.trim().match(/^([A-Za-z0-9_.-]+):\s*$/);
      if (head !== null) {
        current = { id: head[1] };
        found[head[1]] = current;
        continue;
      }
    }
    if (current === null) continue;
    const field = line.trim().match(/^(baseURL|apiKeyEnv|api|displayName):\s*(.+)$/);
    if (field !== null && indent > base + 2) {
      current[field[1]] = field[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return found;
}

/** Union of every provider block declared by the installed profiles. */
export async function readProfileProviders(dirs) {
  const list = Array.isArray(dirs) ? dirs : await profileDirs();
  const merged = {};
  for (const dir of list) {
    for (const name of ['cordis.patch.yml', 'cordis.yml']) {
      let text;
      try {
        text = await readFile(join(dir, name), 'utf8');
      } catch {
        continue;
      }
      Object.assign(merged, parseProviderBlocks(text));
    }
  }
  return merged;
}

/** Resolve a provider id to a balance source: known shortcut first, then the profile config. */
export async function resolveSource(providerId, dirs) {
  if (typeof providerId !== 'string' || providerId.trim() === '') return null;
  const id = providerId.trim();
  if (SOURCES[id] !== undefined) return { ...SOURCES[id], id };
  const providers = await readProfileProviders(dirs);
  const config = providers[id];
  if (config === undefined || config.baseURL === undefined) return null;
  const apiKeyEnv = config.apiKeyEnv ?? `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
  return { id, label: config.displayName ?? id, apiKeyEnv, baseURL: config.baseURL };
}

/** Remember which endpoint answered for which origin so polling stays cheap. */
const discovered = new Map();

/**
 * Read one provider's remaining balance.
 * @returns {{ status: number, body: Record<string, unknown> }}
 */
export async function readUsage(ctx, source) {
  let credential;
  try {
    credential = await ctx.credentials.resolve(source.apiKeyEnv);
  } catch {
    credential = undefined;
  }
  if (credential?.value === undefined || credential.value === '') {
    return { status: 503, body: { error: `${source.apiKeyEnv} is not configured`, provider: source.id } };
  }

  let usageUrl = source.usageUrl;
  let known;
  if (usageUrl === undefined) {
    const origin = baseOf(source);
    if (origin === null) {
      return { status: 422, body: { error: `${source.id} has no base URL in the profile`, provider: source.id } };
    }
    known = discovered.get(origin);
    usageUrl = known?.usageUrl;
    if (usageUrl === undefined) {
      const probe = await discoverUsage(credential.value, origin);
      if (probe.error !== undefined) {
        return {
          status: 502,
          body: { error: `${source.label} exposes no balance endpoint`, provider: source.id, tried: probe.tried },
        };
      }
      discovered.set(origin, probe);
      known = probe;
      usageUrl = probe.usageUrl;
    }
  }

  let upstream;
  try {
    upstream = await fetch(usageUrl, {
      headers: { Authorization: `Bearer ${credential.value}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch {
    return { status: 502, body: { error: `${source.label} balance request failed`, provider: source.id } };
  }
  if (!upstream.ok) {
    return { status: 502, body: { error: `${source.label} usage HTTP ${upstream.status}`, provider: source.id } };
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch {
    return { status: 502, body: { error: `${source.label} usage response is not JSON`, provider: source.id } };
  }
  if (payload?.is_active === false || payload?.isValid === false) {
    return { status: 502, body: { error: `${source.label} account is inactive`, provider: source.id } };
  }

  const raw = source.balanceOf?.(payload);
  const found = raw === undefined ? (known ?? extractBalance(payload)) : { value: raw, unit: 'USD' };
  if (found === null || found === undefined) {
    return { status: 502, body: { error: `${source.label} response has no numeric balance`, provider: source.id } };
  }
  const value = numeric(found.value);
  if (value === null) {
    return { status: 502, body: { error: `${source.label} response has no numeric balance`, provider: source.id } };
  }
  return { status: 200, body: { provider: source.id, label: source.label, balance: value, unit: found.unit ?? 'USD' } };
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function handlerFor(ctx, resolve) {
  return async (req, res) => {
    const rejection = ctx.connection.requestRejection({ headers: req.headers });
    if (rejection !== undefined) return send(res, rejection, { error: 'unauthorized' });
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    try {
      const source = await resolve(req, res);
      if (source === 'handled') return undefined;
      if (source === null) return send(res, 404, { error: 'unknown provider' });
      const outcome = await readUsage(ctx, source);
      return send(res, outcome.status, outcome.body);
    } catch {
      return send(res, 502, { error: 'balance request failed' });
    }
  };
}

export function apply(ctx) {
  for (const [id, row] of Object.entries(SOURCES)) {
    const source = { ...row, id };
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: source.path,
      handler: handlerFor(ctx, async () => source),
    });
    ctx.effect(() => dispose);
  }

  // One generic endpoint resolves any provider id, including ids added to the profile later.
  const dispose = ctx.webServer.register({
    kind: 'exact',
    path: '/api/provider-balance',
    handler: handlerFor(ctx, async (req) => {
      let providerId = null;
      try {
        providerId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('provider');
      } catch {
        providerId = null;
      }
      return resolveSource(providerId);
    }),
  });
  ctx.effect(() => dispose);
}
