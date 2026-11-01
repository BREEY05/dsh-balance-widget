import vm from 'node:vm';
import fs from 'node:fs';
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

assert.deepEqual(requests, [
  '/api/aigocode-usage',
  '/api/tafy-usage',
  '/api/taffy-usage',
  '/api/ds-usage',
]);

const d = api.createStore(ctx, 'deepseek-account');
await d.requestRead('manual');
assert.equal(d.getSnapshot().balances[0].micro, 10000000);

const u = api.createStore(ctx, 'other');
await u.requestRead('manual');
assert.equal(u.getSnapshot().phase, 'unavailable');
assert.equal(u.getSnapshot().balances.length, 0);
assert.equal(requests.length, 4);

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

for (const x of [a, t, taffy, ds, d, u]) x.dispose();
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
assert.deepEqual(paths.sort(), hostIds.map((id) => host.SOURCES[id].path).sort());

const realFetch = globalThis.fetch;
const stub = (payloadBuilder, status = 200) => {
  globalThis.fetch = async () => ({ ok: status === 200, status, json: async () => payloadBuilder() });
};

stub(() => ({ remaining: 42 }));
let outcome = await host.readUsage({ credentials: { resolve: async () => ({ value: 'k' }) } }, { ...host.SOURCES.ds, id: 'ds' });
assert.equal(outcome.status, 200);
assert.deepEqual(outcome.body, { provider: 'ds', label: 'Taffy', balance: 42, unit: 'USD' });

stub(() => ({ quota: { remaining: '7.5' } }));
outcome = await host.readUsage({ credentials: { resolve: async () => ({ value: 'k' }) } }, { ...host.SOURCES.taffy, id: 'taffy' });
assert.equal(outcome.status, 200);
assert.equal(outcome.body.balance, 7.5);

stub(() => ({ balance: 9 }));
outcome = await host.readUsage({ credentials: { resolve: async () => ({ value: 'k' }) } }, { ...host.SOURCES.aigocode, id: 'aigocode' });
assert.equal(outcome.body.balance, 9);

// A route whose key moved to a different ref must report the missing ref, not a fake zero.
outcome = await host.readUsage({ credentials: { resolve: async () => undefined } }, { ...host.SOURCES.ds, id: 'ds' });
assert.equal(outcome.status, 503);
assert.match(outcome.body.error, /DS_API_KEY/);

stub(() => ({ is_active: false, remaining: 1 }));
outcome = await host.readUsage({ credentials: { resolve: async () => ({ value: 'k' }) } }, { ...host.SOURCES.ds, id: 'ds' });
assert.equal(outcome.status, 502);

stub(() => ({ remaining: 'not-a-number' }));
outcome = await host.readUsage({ credentials: { resolve: async () => ({ value: 'k' }) } }, { ...host.SOURCES.ds, id: 'ds' });
assert.equal(outcome.status, 502);

stub(() => ({}), 500);
outcome = await host.readUsage({ credentials: { resolve: async () => ({ value: 'k' }) } }, { ...host.SOURCES.ds, id: 'ds' });
assert.equal(outcome.status, 502);
assert.match(outcome.body.error, /HTTP 500/);

globalThis.fetch = realFetch;

console.log('PASS: provider routes, wallet total, renamed provider ids, account wallet, isolated counters, disposed response, host balance sources');
