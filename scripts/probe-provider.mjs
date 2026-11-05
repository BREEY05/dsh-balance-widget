// Provider onboarding probe.
//
// Given a provider's base URL (and the env var holding its key), discover what the plugin and the
// profile need: the API protocol, the model list, and a working balance endpoint. Run it before
// adding a provider so nothing has to be guessed or asked of the user.
//
//   node scripts/probe-provider.mjs --id aigocode --base https://api.aigocode.dev --key-env AIGOCODE_API_KEY
//
// Keys come from the environment first, then from the DSH credential store. Nothing is written.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readUsage, discoverUsage } from '../index.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  args.set(key, process.argv[i + 1]);
}
const base = (args.get('base') || '').replace(/\/+$/, '');
if (!base) {
  console.error('usage: node scripts/probe-provider.mjs --id <provider-id> --base <baseURL> [--key-env NAME]');
  process.exit(2);
}
const id = args.get('id') || new URL(base).hostname.split('.')[0];
const keyEnv = args.get('key-env') || `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;

function loadCredentials() {
  const out = {};
  for (const file of ['.credentials.yaml', 'credentials.yaml']) {
    const full = path.join(os.homedir(), '.dsh', file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
      const m = /^\s{2}([A-Z0-9_]+):\s*(.+?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

const key = process.env[keyEnv] || loadCredentials()[keyEnv] || '';
const log = (label, value) => console.log(label.padEnd(12) + value);

async function fetchJson(url, init = {}, timeoutMs = 15000) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 300);
    }
    return { status: res.status, ok: res.ok, body };
  } catch (error) {
    return { status: 0, ok: false, body: String(error?.message || error) };
  }
}

// 1. Which model catalogue answers? OpenAI-compatible gateways serve /v1/models.
const modelCandidates = [...new Set([`${base}/v1/models`, `${base}/models`])];
let models = [];
let modelPath = '';
for (const url of modelCandidates) {
  const res = await fetchJson(url, { headers: { Authorization: `Bearer ${key}` } });
  const list = res.body?.data || res.body?.models;
  if (res.ok && Array.isArray(list)) {
    models = list.map((m) => m.id || m.name || m.model).filter(Boolean);
    modelPath = url;
    break;
  }
}
log('models', modelPath ? `${models.length} via ${modelPath}` : 'not listed (gateway may hide /v1/models)');
if (models.length) log('', models.slice(0, 12).join(', ') + (models.length > 12 ? ` … (+${models.length - 12})` : ''));

// 2. Which protocol actually answers a completion?
const model = args.get('model') || models[0] || 'gpt-4o-mini';
let api = 'unknown';
{
  const res = await fetchJson(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
  });
  if (res.ok || /model|token|parameter/i.test(JSON.stringify(res.body))) api = 'openai-completions';
}
if (api === 'unknown') {
  // Taffy-style gateways speak the Responses API; Anthropic-compatible ones need /v1/messages.
  const responses = await fetchJson(`${base}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: 'ping' }),
  });
  if (responses.ok || /model|input/i.test(JSON.stringify(responses.body))) api = 'openai-responses';
}
if (api === 'unknown') {
  const messages = await fetchJson(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  });
  if (messages.ok || /model/i.test(JSON.stringify(messages.body))) api = 'anthropic-messages';
}
log('api', api);

// 3. Where does the balance live? Same probing order the plugin uses at runtime.
const discovered = await discoverUsage(key, base);
if (discovered?.usageUrl) log('balance', `${discovered.value} ${discovered.unit || ''} via ${discovered.usageUrl}`);
else log('balance', discovered?.error || 'no endpoint answered');
if (discovered?.tried?.length) log('', discovered.tried.map((t) => `${t.url} ${t.result}`).join('\n'.padEnd(13)));

// 4. Emit the profile block. Paste under llm-pi-ai's `config.providers`, then restart or remount.
console.log('\n# --- cordis.patch.yml: llm-pi-ai config.providers ---');
console.log(`${id}:`);
console.log(`  apiKeyEnv: ${keyEnv}`);
console.log(`  api: ${api === 'unknown' ? 'openai-completions' : api}`);
console.log(`  baseURL: ${base}`);
if (models.length) {
  console.log('  models:');
  for (const m of models.slice(0, 40)) console.log(`    - id: ${m}`);
}
console.log('\n# The balance plugin needs no entry for this provider: it reads baseURL/apiKeyEnv from the');
console.log('# profile and probes the usage endpoint itself. Add a SOURCES row only if the balance');
console.log('# endpoint is not one of the documented paths above.');
