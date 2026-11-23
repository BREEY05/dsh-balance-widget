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

// Verified New API deployments only. A /v1 model prefix does not identify a quota API.
const NEW_API_ORIGINS = new Set(['https://api.bbkkb.cfd']);

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

// New API quotas are key-scoped integers, not wallet balances or per-session charges.
function keyQuotaFrom(payload, status) {
  const data = payload?.data;
  if (payload?.success === false || typeof data?.unlimited_quota !== 'boolean') return null;
  const available = numeric(data.total_available);
  if (!data.unlimited_quota && available === null) return null;
  const divisor = numeric(status?.data?.quota_per_unit);
  const money = status?.success !== false && divisor > 0 && status?.data?.quota_display_type === 'USD';
  const scale = value => value !== null && money ? value / divisor : value;
  return {
    available: data.unlimited_quota ? null : scale(available), granted: scale(numeric(data.total_granted)),
    used: scale(numeric(data.total_used)), unlimited: data.unlimited_quota, unit: money ? 'USD' : 'QUOTA',
  };
}

const COST_KEYS = ['actual_cost', 'cost', 'total_cost', 'totalCost', 'spent', 'used_amount', 'used'];

/** Read one provider-reported money figure out of an aggregate bag, in whatever unit it uses. */
function costOf(bag) {
  if (bag === null || typeof bag !== 'object') return null;
  for (const key of COST_KEYS) {
    const value = numeric(bag[key]);
    if (value !== null) return value;
  }
  return null;
}

function sumCosts(rows) {
  let sum = null;
  for (const row of rows) {
    const value = costOf(row);
    if (value === null) continue;
    sum = (sum ?? 0) + value;
  }
  return sum;
}

/**
 * Pull the provider's own billed spend out of a usage payload.
 *
 * The balance tells how much is left; this tells how much was actually charged, which is the only
 * figure that can answer "what did this conversation cost" without inventing per-token prices.
 * Gateways disagree on where they keep it: `usage.total` / `usage.today` (sourcesdata style),
 * per-day rows (`daily_usage`), per-model rows (`model_stats`), or one flat `total_cost`.
 *
 * @returns {{ total: number | null, today: number | null, unit: string } | null}
 */
export function extractCost(payload) {
  if (payload === null || typeof payload !== 'object') return null;
  const usage = payload.usage ?? payload.data?.usage;
  const unit = unitOf(payload.unit ?? payload.currency ?? usage?.unit ?? payload.data?.unit);
  const total = costOf(usage?.total) ?? costOf(payload.total);
  const today = costOf(usage?.today) ?? costOf(payload.today);
  if (total !== null || today !== null) return { total, today, unit };
  for (const rows of [payload.daily_usage ?? payload.data?.daily_usage, payload.model_stats ?? payload.data?.model_stats]) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const sum = sumCosts(rows);
    if (sum !== null) return { total: sum, today: null, unit };
  }
  const flat = costOf(payload.data) ?? costOf(payload);
  if (flat !== null) return { total: flat, today: null, unit };
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
      if ([401, 403].includes(response.status)) return { error: `configured key rejected (HTTP ${response.status})`, reason: 'auth', tried };
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

// Only cache public conversion metadata after the private quota payload confirms the adapter.
const confirmedQuotas = new Map();
async function publicQuotaStatus(origin) {
  try {
    const response = await fetch(origin + '/api/status', {
      headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const data = payload?.data;
    if (payload?.success === false || !(numeric(data?.quota_per_unit) > 0) ||
        typeof data?.quota_display_type !== 'string' || !data.quota_display_type.trim()) return null;
    return { data: { quota_per_unit: data.quota_per_unit, quota_display_type: data.quota_display_type } };
  } catch { return null; }
}

async function readKeyQuota(source, origin, key, status) {
  const fail = (reason, message) => ({ status: 502, body: { provider: source.id, reason, error: source.label + ': ' + message } });
  const get = (path, headers) => fetch(origin + path, {
    headers: { Accept: 'application/json', ...headers }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  let response;
  try { response = await get('/api/usage/token/', { Authorization: 'Bearer ' + key }); }
  catch { return fail('network', 'key quota request failed (network error or blocked redirect)'); }
  const code = response.status;
  if (code === 401 || code === 403) return fail('auth', 'configured key rejected (HTTP ' + code + ')');
  if (code === 404 || code === 405) return fail('no-endpoint', 'key quota endpoint unavailable (HTTP ' + code + ')');
  if (!response.ok) return fail('http', 'key quota HTTP ' + code);
  let payload;
  try { payload = await response.json(); } catch { return fail('invalid', 'quota response is not JSON'); }
  const keyQuota = keyQuotaFrom(payload, status);
  if (!keyQuota) return fail('fields', 'quota response missing or invalid: unlimited_quota / total_available');
  return { status: 200, body: { provider: source.id, label: source.label, keyQuota } };
}

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
  const origin = source.usageUrl === undefined ? baseOf(source) : null;
  const cached = confirmedQuotas.get(origin);
  const fresh = cached && cached.until > Date.now();
  const status = origin && !discovered.has(origin) ? (fresh ? cached.status : await publicQuotaStatus(origin)) : null;
  const quotaCandidate = NEW_API_ORIGINS.has(origin) || cached || status;
  if (credential?.value === undefined || credential.value === '') {
    return { status: 503, body: { error: `${source.apiKeyEnv} is not configured`, provider: source.id } };
  }

  if (quotaCandidate) {
    const result = await readKeyQuota(source, origin, credential.value, status);
    if (result.status === 200 && !fresh && !NEW_API_ORIGINS.has(origin)) {
      confirmedQuotas.set(origin, { status, until: Date.now() + 10 * 60_000 });
    }
    if (result.body.reason === 'no-endpoint') confirmedQuotas.delete(origin);
    return result; // Includes 401/403: never try the same key on additional paths.
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
          body: { error: probe.reason === 'auth' ? probe.error : `${source.label}: no balance endpoint recognized`, provider: source.id, tried: probe.tried },
        };
      }
      discovered.set(origin, { usageUrl: probe.usageUrl });
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
  const found = raw === undefined ? extractBalance(payload) : { value: raw, unit: 'USD' };
  if (found === null || found === undefined) {
    return { status: 502, body: { error: `${source.label} response has no numeric balance`, provider: source.id } };
  }
  const value = numeric(found.value);
  if (value === null) {
    return { status: 502, body: { error: `${source.label} response has no numeric balance`, provider: source.id } };
  }
  const body = { provider: source.id, label: source.label, balance: value, unit: found.unit ?? 'USD' };
  const spent = extractCost(payload);
  if (spent !== null) body.spent = spent;
  return { status: 200, body };
}

const TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'];

function emptyTokens() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0 };
}

/**
 * Add up the token usage this session actually reported, per provider/model route.
 *
 * Every completed model call appends an `assistant/message` event carrying the provider's own
 * `usage`, so this is measured, not estimated: no price table and no balance arithmetic. Retried
 * attempts can append the same message twice, so events are de-duplicated by message id.
 *
 * @returns {{ requests: number, tokens: Record<string, number>, models: Array<Record<string, unknown>> }}
 */
export function foldSessionUsage(events) {
  const totals = emptyTokens();
  const models = new Map();
  const seen = new Set();
  let requests = 0;
  for (const event of Array.isArray(events) ? events : []) {
    if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue;
    const data = event.data;
    const usage = data?.usage;
    if (usage === null || usage === undefined || typeof usage !== 'object') continue;
    const messageId = data?.message?.id;
    if (typeof messageId === 'string') {
      if (seen.has(messageId)) continue;
      seen.add(messageId);
    }
    requests += 1;
    const source = data?.message?.source ?? {};
    const provider = typeof source.provider === 'string' ? source.provider : '';
    const model = typeof source.model === 'string' ? source.model : '';
    const key = provider + '\u0000' + model;
    let row = models.get(key);
    if (row === undefined) {
      row = { provider, model, requests: 0, ...emptyTokens() };
      models.set(key, row);
    }
    row.requests += 1;
    for (const field of TOKEN_FIELDS) {
      const value = numeric(usage[field]);
      if (value === null) continue;
      row[field] += value;
      totals[field] += value;
    }
  }
  if (totals.totalTokens === 0 && (totals.inputTokens > 0 || totals.outputTokens > 0)) {
    totals.totalTokens = totals.inputTokens + totals.outputTokens;
  }
  return { requests, tokens: totals, models: [...models.values()] };
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

  // What the open conversation has spent so far, straight out of the session log: real token
  // counts per provider/model plus the provider's own billed cost when it reports one.
  const sessionDispose = ctx.webServer.register({
    kind: 'exact',
    path: '/api/session-usage',
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection({ headers: req.headers });
      if (rejection !== undefined) return send(res, rejection, { error: 'unauthorized' });
      if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
      let sessionId = null;
      try {
        sessionId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('session');
      } catch {
        sessionId = null;
      }
      if (sessionId === null || sessionId === '') return send(res, 400, { error: 'session is required' });

      let session;
      try {
        const store = ctx.get('sessions');
        session = store === undefined ? undefined : store.get(sessionId);
      } catch {
        session = undefined;
      }
      // A conversation that already ended keeps its balance behaviour and just reports no tokens.
      if (session === undefined) {
        return send(res, 200, { session: sessionId, live: false, ...foldSessionUsage([]) });
      }
      let events;
      try {
        events = session.snapshotEvents();
      } catch {
        return send(res, 200, { session: sessionId, live: false, ...foldSessionUsage([]) });
      }
      return send(res, 200, { session: sessionId, live: true, ...foldSessionUsage(events) });
    },
  });
  ctx.effect(() => sessionDispose);
}
