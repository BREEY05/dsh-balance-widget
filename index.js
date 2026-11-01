export const inject = ['credentials', 'webServer', 'connection'];

/**
 * One upstream balance read per model-provider id.
 *
 * A provider id is whatever `llm-pi-ai` calls the route, and several ids can bill the same
 * wallet with different credentials (`taffy`, `tafy`, and `ds` all point at tafty.work but are
 * configured with different API keys). Each row therefore names its own credential and route
 * so a newly added provider never silently loses its balance.
 *
 * `client.js` must keep the same id set; `switching.test.mjs` asserts the two agree.
 */
export const SOURCES = {
  aigocode: {
    label: 'AIGoCode',
    path: '/api/aigocode-usage',
    apiKeyEnv: 'AIGOCODE_API_KEY',
    usageUrl: 'https://api.aigocode.dev/v1/usage',
    balanceOf: (payload) => payload?.balance,
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
};

/** Taffy reports the wallet as `remaining`, `quota.remaining`, or `balance`, depending on plan. */
function taffyBalance(payload) {
  return payload?.remaining ?? payload?.quota?.remaining ?? payload?.balance;
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
  if (!credential?.value) {
    return { status: 503, body: { error: `${source.apiKeyEnv} is not configured`, provider: source.id } };
  }

  let upstream;
  try {
    upstream = await fetch(source.usageUrl, {
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
  if (payload?.is_active === false) {
    return { status: 502, body: { error: `${source.label} account is inactive`, provider: source.id } };
  }

  const raw = (source.balanceOf ?? taffyBalance)(payload);
  if ((typeof raw !== 'number' && typeof raw !== 'string') || String(raw).trim() === '' || !Number.isFinite(Number(raw))) {
    return { status: 502, body: { error: `${source.label} response has no numeric balance`, provider: source.id } };
  }
  return { status: 200, body: { provider: source.id, label: source.label, balance: Number(raw), unit: 'USD' } };
}

export function apply(ctx) {
  for (const [id, row] of Object.entries(SOURCES)) {
    const source = { ...row, id };
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: source.path,
      async handler(req, res) {
        const send = (status, body) => {
          res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(JSON.stringify(body));
        };
        const rejection = ctx.connection.requestRejection({ headers: req.headers });
        if (rejection !== undefined) return send(rejection, { error: 'unauthorized' });
        if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
        try {
          const outcome = await readUsage(ctx, source);
          send(outcome.status, outcome.body);
        } catch {
          send(502, { error: `${source.label} balance request failed`, provider: source.id });
        }
      },
    });
    ctx.effect(() => dispose);
  }
}
