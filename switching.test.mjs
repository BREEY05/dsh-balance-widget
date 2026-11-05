import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------- client half

let api;
let source = fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8');
source = source.replace(
  "return { inject: ['slots'",
  "window.testApi = { createStore, makeWidget, PROVIDERS }; return { inject: ['slots'",
);
const storage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};
let requests = [];
let deferred;
const sandbox = {
  console,
  Date,
  Map,
  Set,
  Object,
  Number,
  String,
  Promise,
  setTimeout,
  clearTimeout,
  fetch: async (path) => {
    requests.push(path);
    if (deferred) return await deferred;
    if (path.startsWith('/api/provider-balance')) {
      return { ok: false, status: 502, json: async () => ({ error: 'example.com exposes no balance endpoint' }) };
    }
    if (path.includes('deepseek')) {
      return {
        ok: true,
        json: async () => ({
          provider: 'deepseek-official',
          label: 'DeepSeek',
          balance: 15.92,
          unit: 'CNY',
          balance_infos: [{ currency: 'CNY', total_balance: '15.92' }],
        }),
      };
    }
    return { ok: true, json: async () => ({ balance: path.includes('aigocode') ? 12 : 3, unit: 'USD' }) };
  },
  window: {
    localStorage: storage(),
    sessionStorage: storage(),
    __ModuleLoader__: { load: ({ factory }) => factory(() => ({ createElement: () => null })) },
  },
};
vm.runInNewContext(source, sandbox);
api = sandbox.window.testApi;
const ctx = {
  remote: {
    account: {
      getBalance: async () => ({
        ok: true,
        value: {
          status: 'ready',
          value: [{ currency: 'CNY', balance: '8' }],
          bonusWallets: [{ currency: 'CNY', balance: '2' }],
        },
      }),
    },
  },
};

const a = api.createStore(ctx, 'aigocode');
a.setSession('one');
await a.requestRead('manual');
assert.equal(a.getSnapshot().balances[0].micro, 12000000);

const t = api.createStore(ctx, 'tafy');
t.setSession('one');
await t.requestRead('manual');
assert.equal(t.getSnapshot().balances[0].micro, 3000000);
assert.equal(t.getSnapshot().sessionSpent.USD, undefined);

// The profile's current provider ids must each reach their own route instead of falling back.
const taffy = api.createStore(ctx, 'taffy');
await taffy.requestRead('manual');
assert.equal(taffy.getSnapshot().phase, 'ready');
assert.equal(taffy.getSnapshot().providerLabel, 'Taffy');
assert.equal(taffy.getSnapshot().balances[0].micro, 3000000);

const ds = api.createStore(ctx, 'ds');
await ds.requestRead('manual');
assert.equal(ds.getSnapshot().phase, 'ready');
assert.equal(ds.getSnapshot().providerLabel, 'Taffy');
assert.equal(ds.getSnapshot().balances[0].micro, 3000000);

// The official DeepSeek route bills CNY and reports balance_infos instead of a bare number.
const official = api.createStore(ctx, 'deepseek-official');
await official.requestRead('manual');
assert.equal(official.getSnapshot().phase, 'ready');
assert.equal(official.getSnapshot().providerLabel, 'DeepSeek');
assert.equal(official.getSnapshot().balances[0].currency, 'CNY');
assert.equal(official.getSnapshot().balances[0].micro, 15920000);

assert.deepEqual(requests, [
  '/api/aigocode-usage',
  '/api/tafy-usage',
  '/api/taffy-usage',
  '/api/ds-usage',
  '/api/deepseek-usage',
]);

const d = api.createStore(ctx, 'deepseek-account');
await d.requestRead('manual');
assert.equal(d.getSnapshot().balances[0].micro, 10000000);

// An unknown provider asks the Host to discover its endpoint instead of giving up locally.
const u = api.createStore(ctx, 'other');
await u.requestRead('manual');
assert.equal(u.getSnapshot().phase, 'unavailable');
assert.equal(u.getSnapshot().providerLabel, 'other');
assert.equal(u.getSnapshot().balances.length, 0);
assert.equal(requests.length, 6);
assert.equal(requests[5], '/api/provider-balance?provider=other');

let finish;
deferred = new Promise((r) => (finish = r));
const late = api.createStore(ctx, 'aigocode');
const read = late.requestRead('manual');
late.dispose();
finish({ ok: true, json: async () => ({ balance: 999 }) });
await read;
assert.equal(late.getSnapshot().balances.length, 0);
deferred = undefined;

late.activate();
await late.requestRead('manual');
assert.equal(late.getSnapshot().balances[0].micro, 12000000);
late.dispose();

d.setSession('account-session');
ctx.remote.account.getBalance = async () => ({ ok: true, value: { status: 'signed-out' } });
await d.requestRead('manual');
assert.equal(d.getSnapshot().balances.length, 0);

ctx.remote.account.getBalance = async () => ({ ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '1' }] } });
await d.requestRead('manual');
assert.equal(d.getSnapshot().sessionSpent.CNY, undefined);

for (const x of [a, t, taffy, ds, official, d, u]) x.dispose();
assert.match(source, /useProjection\('modelSelection', \(value\) => value\?\.next\)/);
assert.match(source, /\[provider, props.sessionId\]/);

// ------------------------------------------------------------- host half

const host = await import(new URL('./index.js', import.meta.url));
const clientIds = Object.keys(api.PROVIDERS);
const hostIds = Object.keys(host.SOURCES);
// Every host source needs a client route, and the only client-only entry is the account wallet.
assert.deepEqual(
  clientIds.filter((id) => id !== 'deepseek-account').sort(),
  hostIds.slice().sort(),
  'client provider ids must match host balance sources',
);

const paths = [];
host.apply({
  credentials: { resolve: async () => undefined },
  connection: { requestRejection: () => undefined },
  webServer: {
    register: (route) => {
      paths.push(route.path);
      return () => {};
    },
  },
  effect: (fn) => fn(),
});
assert.deepEqual(paths.sort(), [...hostIds.map((id) => host.SOURCES[id].path), '/api/provider-balance'].sort());

// Profile YAML is parsed just far enough to learn each provider's base URL and key ref.
const parsed = host.parseProviderBlocks(`
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      example:
        apiKeyEnv: EXAMPLE_API_KEY
        api: openai-completions
        baseURL: https://api.example.com
        models:
          - id: m
      other:
        baseURL: 'https://other.example.com'
- id: next
`);
assert.deepEqual(parsed.example, { id: 'example', apiKeyEnv: 'EXAMPLE_API_KEY', api: 'openai-completions', baseURL: 'https://api.example.com' });
assert.deepEqual(parsed.other, { id: 'other', baseURL: 'https://other.example.com' });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-balance-'));
fs.writeFileSync(
  path.join(dir, 'cordis.patch.yml'),
  'config:\n  providers:\n    example:\n      apiKeyEnv: EXAMPLE_API_KEY\n      baseURL: https://api.example.com\n',
);
const resolved = await host.resolveSource('example', [dir]);
assert.equal(resolved.baseURL, 'https://api.example.com');
assert.equal(resolved.apiKeyEnv, 'EXAMPLE_API_KEY');
assert.equal(await host.resolveSource('nope', [dir]), null);

const realFetch = globalThis.fetch;
let calls = [];
const stub = (payloadBuilder, status = 200) => {
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: status === 200, status, json: async () => payloadBuilder() };
  };
};
const discovered = { credentials: { resolve: async () => ({ value: 'k' }) } };

stub(() => ({ remaining: 42 }));
let outcome = await host.readUsage(discovered, { ...host.SOURCES.ds, id: 'ds' });
assert.equal(outcome.status, 200);
assert.deepEqual(outcome.body, { provider: 'ds', label: 'Taffy', balance: 42, unit: 'USD' });

stub(() => ({ quota: { remaining: '7.5' } }));
outcome = await host.readUsage(discovered, { ...host.SOURCES.taffy, id: 'taffy' });
assert.equal(outcome.status, 200);
assert.equal(outcome.body.balance, 7.5);

stub(() => ({ balance: 9 }));
outcome = await host.readUsage(discovered, { ...host.SOURCES.aigocode, id: 'aigocode' });
assert.equal(outcome.body.balance, 9);

// DeepSeek documents /user/balance and answers with balance_infos in CNY.
stub(() => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '15.92' }] }));
outcome = await host.readUsage(discovered, { ...host.SOURCES['deepseek-official'], id: 'deepseek-official' });
assert.equal(outcome.status, 200);
assert.deepEqual(outcome.body, { provider: 'deepseek-official', label: 'DeepSeek', balance: 15.92, unit: 'CNY' });

// An unknown provider is discovered by probing documented paths until one answers.
calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  if (String(url).endsWith('/v1/usage')) {
    return { ok: true, status: 200, json: async () => ({ balance: 5.5, unit: 'USD' }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};
const generic = await host.readUsage(discovered, { id: 'example', label: 'example', apiKeyEnv: 'EXAMPLE_API_KEY', baseURL: 'https://api.example.com' });
assert.equal(generic.status, 200);
assert.deepEqual(generic.body, { provider: 'example', label: 'example', balance: 5.5, unit: 'USD' });
assert.ok(calls[0].endsWith('/user/balance'), 'probes the documented DeepSeek path first');
assert.ok(calls.includes('https://api.example.com/v1/usage'));

// The winning endpoint is cached per origin, so polling does not re-probe every time.
const before = calls.length;
await host.readUsage(discovered, { id: 'example', label: 'example', apiKeyEnv: 'EXAMPLE_API_KEY', baseURL: 'https://api.example.com' });
assert.equal(calls.length - before, 1);

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
const missing = await host.readUsage(discovered, { id: 'nowhere', label: 'nowhere', apiKeyEnv: 'NOWHERE_API_KEY', baseURL: 'https://nowhere.example.com' });
assert.equal(missing.status, 502);
assert.match(missing.body.error, /no balance endpoint/i);

// A route whose key moved to a different ref must report the missing ref, not a fake zero.
outcome = await host.readUsage({ credentials: { resolve: async () => undefined } }, { ...host.SOURCES.ds, id: 'ds' });
assert.equal(outcome.status, 503);
assert.match(outcome.body.error, /DS_API_KEY/);

stub(() => ({ is_active: false, remaining: 1 }));
outcome = await host.readUsage(discovered, { ...host.SOURCES.ds, id: 'ds' });
assert.equal(outcome.status, 502);

stub(() => ({ remaining: 'not-a-number' }));
outcome = await host.readUsage(discovered, { ...host.SOURCES.ds, id: 'ds' });
assert.equal(outcome.status, 502);

stub(() => ({}), 500);
outcome = await host.readUsage(discovered, { ...host.SOURCES.ds, id: 'ds' });
assert.equal(outcome.status, 502);
assert.match(outcome.body.error, /HTTP 500/);

globalThis.fetch = realFetch;
fs.rmSync(dir, { recursive: true, force: true });

console.log('PASS: provider routes, wallet total, renamed provider ids, official DeepSeek wallet, generic discovery, profile parsing, isolated counters, disposed response, host balance sources');
