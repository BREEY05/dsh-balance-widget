export const inject = ['credentials', 'webServer', 'connection'];

export function apply(ctx) {
  for (const [provider, key, url] of [
    ['aigocode', 'AIGOCODE_API_KEY', 'https://api.aigocode.dev/v1/usage'],
    ['taffy', 'TAFY_API_KEY', 'https://taffy.work/v1/usage'],
  ]) {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: `/api/${provider}-usage`,
      async handler(req, res) {
        const send = (status, body) => {
          res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(JSON.stringify(body));
        };
        const rejection = ctx.connection.requestRejection({ headers: req.headers });
        if (rejection !== undefined) return send(rejection, { error: 'unauthorized' });
        if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
        try {
          const credential = await ctx.credentials.resolve(key);
          if (!credential?.value) return send(503, { error: `${key} is not configured` });
          const upstream = await fetch(url, {
            headers: { Authorization: `Bearer ${credential.value}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(15000),
            redirect: 'error',
          });
          if (!upstream.ok) return send(502, { error: `${provider} usage HTTP ${upstream.status}` });
          const payload = await upstream.json();
          if (payload.is_active === false) return send(502, { error: `${provider} account is inactive` });
          const raw = provider === 'aigocode' ? payload.balance : (payload.remaining ?? payload.quota?.remaining ?? payload.balance);
          if ((typeof raw !== 'number' && typeof raw !== 'string') || String(raw).trim() === '' || !Number.isFinite(Number(raw))) {
            return send(502, { error: `${provider} response has no numeric balance` });
          }
          send(200, { balance: Number(raw), unit: 'USD', provider });
        } catch {
          send(502, { error: `${provider} balance request failed` });
        }
      },
    });
    ctx.effect(() => dispose);
  }
}
