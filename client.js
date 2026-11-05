window.__ModuleLoader__.load({
  id: '@breey05/dsh-balance-widget',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace shared by the registration and the dictionaries below. */
    const NS = 'api-balance';
    /** Identifies our stylesheet element and is unique to this package. */
    const STYLE_TAG = '@breey05/dsh-balance-widget/api-balance.css';
    /** localStorage key for per-day observed spend. */
    const TODAY_KEY = 'dsh.api-balance.providers.today.v2.';
    /** sessionStorage key for per-session observed spend, so a reload keeps the label honest. */
    const SESSIONS_KEY = 'dsh.api-balance.providers.sessions.v2.';
    /** Idle polling cadence: the Platform account summary is rate-limited, so this is slow. */
    const POLL_MS = 300000;
    /** Reads scheduled after a new chat node settles (usage is billed at request completion). */
    const BURST_MS = [30000, 90000];
    /** How long the fresh-spend highlight stays on the pill. */
    const FLASH_MS = 2600;
    /** Below this amount a wallet is highlighted. */
    const LOW_MICRO = 5000000;
    /** Currency amounts are tracked in millionths of one unit to avoid float drift. */
    const MICRO = 1000000;
    /** Minimum spacing between non-manual reads, in milliseconds. */
    const READ_GAP_MS = 45000;
    /** Backoff after a failed read; the account summary rejects aggressive polling with HTTP 429. */
    const RETRY_DELAYS_MS = [120000, 300000, 600000, 900000];

    const DICT = {
      en: {
        'pill.title': 'API balance {balance}, spent {spent} in this session',
        'pill.loading': 'Balance …',
        'pill.unavailable': 'Balance unavailable',
        'pill.signedOut': 'Not signed in · balance',
        'pill.error': 'Balance read failed',
        'panel.title': 'API balance',
        'label.total': 'Available',
        'label.balance': 'Recharge balance',
        'label.bonus': 'Bonus credit',
        'label.sessionSpent': 'This session',
        'label.todaySpent': 'Today',
        'label.updatedAt': 'Updated {time}',
        'action.refresh': 'Refresh',
        'action.usage': 'Usage',
        'action.topup': 'Top up',
        'note.spend': 'Spend is inferred from balance drops; it updates after each request settles.',
        'note.signIn': 'Sign in under Settings → Account to show the balance here.',
        'note.loading': 'Reading the account balance…',
        'error.failed': 'Could not read the balance.',
      },
      zh: {
        'pill.title': 'API 余额 {balance}，本会话消耗 {spent}',
        'pill.loading': '余额 …',
        'pill.unavailable': '余额不可用',
        'pill.signedOut': '未登录 · 余额',
        'pill.error': '余额读取失败',
        'panel.title': 'API 余额',
        'label.total': '剩余额度',
        'label.balance': '充值余额',
        'label.bonus': '赠金',
        'label.sessionSpent': '本会话消耗',
        'label.todaySpent': '今日消耗',
        'label.updatedAt': '更新于 {time}',
        'action.refresh': '刷新',
        'action.usage': '用量明细',
        'action.topup': '充值',
        'note.spend': '消耗额度按余额下降推算，请求结算后更新。',
        'note.signIn': '请先在 设置 → 账号 中登录 DeepSeek 账号。',
        'note.loading': '正在读取账号余额…',
        'error.failed': '无法读取余额。',
      },
    };

    const CSS = [
      '.dsbw-anchor{min-width:0;display:inline-flex;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '.dsbw-pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;max-width:100%;cursor:pointer}',
      '.dsbw-pill:hover,.dsbw-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.dsbw-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsbw-pill svg{flex:none;width:14px;height:14px}',
      '.dsbw-pill[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}',
      '.dsbw-pill[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '.dsbw-label{overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.dsbw-sep{color:var(--dsw-alias-separator-primary);margin:0 2px}',
      '.dsbw-delta{color:var(--dsw-alias-label-tertiary)}',
      '.dsbw-delta[data-flash=true]{color:var(--dsw-alias-state-warn-primary);animation:dsbw-pop .9s ease-out}',
      '@keyframes dsbw-pop{0%{transform:translateY(1px);opacity:.45}100%{transform:translateY(0);opacity:1}}',
      '.dsbw-panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);padding:16px;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay));backdrop-filter:var(--dsw-menu-backdrop-filter);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:default}',
      '.dsbw-panel-title{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500}',
      '.dsbw-title-label{display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.dsbw-title-label svg{flex:none;width:14px;height:14px}',
      '.dsbw-title-value{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}',
      '.dsbw-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}',
      '.dsbw-details{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;color:var(--dsw-alias-label-tertiary)}',
      '.dsbw-details dt,.dsbw-details dd{margin:0;min-width:0}',
      '.dsbw-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}',
      '.dsbw-details dd[data-low=true]{color:var(--dsw-alias-state-warn-primary)}',
      '.dsbw-details dd[data-total=true]{color:var(--dsw-alias-label-primary)}',
      '.dsbw-note{margin:10px 0 0;color:var(--dsw-alias-label-tertiary)}',
      '.dsbw-error{margin:8px 0 0;color:var(--dsw-alias-state-error-primary)}',
      '.dsbw-actions{display:flex;gap:6px;margin-top:12px;align-items:center;flex-wrap:wrap}',
      '.dsbw-action{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;text-decoration:none}',
      '.dsbw-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsbw-action:disabled{opacity:.55;cursor:default;background:0 0}',
      '@media (prefers-reduced-motion:reduce){.dsbw-delta[data-flash=true]{animation:none}}',
    ].join('');

    // ------------------------------------------------------------------ numbers

    /** Parse a decimal string (exponents allowed) into integer millionths. */
    function toMicro(text) {
      if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text * MICRO) : null;
      if (typeof text !== 'string' || text.trim() === '') return null;
      const value = Number(text);
      return Number.isFinite(value) ? Math.round(value * MICRO) : null;
    }

    function symbolOf(currency) {
      return currency === 'USD' ? '$' : '¥';
    }

    /** Two-decimal display; positive sub-cent values read as `<0.01` like the account page. */
    function formatBalance(micro, currency) {
      if (micro === null || micro === undefined || !Number.isFinite(micro)) return '—';
      const symbol = symbolOf(currency);
      const value = micro / MICRO;
      if (value < 0) return '-' + symbol + Math.max(0.01, Math.abs(value)).toFixed(2);
      if (value > 0 && value < 0.01) return symbol + '<0.01';
      return symbol + value.toFixed(2);
    }

    /** Spend display: keep two decimals, add up to two more while the amount is tiny. */
    function formatSpent(micro, currency) {
      const symbol = symbolOf(currency);
      if (!micro || micro <= 0) return symbol + '0.00';
      const value = micro / MICRO;
      const text = value < 0.01 ? value.toFixed(4) : value.toFixed(2);
      return symbol + text;
    }

    function localDateKey() {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    }

    function formatClock(timestamp) {
      try {
        return new Date(timestamp).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
      } catch {
        return new Date(timestamp).toLocaleTimeString();
      }
    }

    function describeError(error) {
      if (error === null || error === undefined) return 'unknown error';
      if (typeof error === 'string') return error;
      const message = typeof error.message === 'string' ? error.message : '';
      const code = typeof error.code === 'string' ? error.code : '';
      if (code && message) return code + ': ' + message;
      return message || code || String(error);
    }

    /** Remote unary calls resolve to `{ ok, value } | { ok: false, error }`. */
    function unwrapRemoteResult(result) {
      if (result !== null && typeof result === 'object' && typeof result.ok === 'boolean') {
        if (result.ok) return result.value;
        throw result.error ?? new Error('remote call failed');
      }
      return result;
    }

    /** Normalize a wallet array to `[{ currency, micro }]`, dropping malformed rows. */
    function normalizeWallets(wallets) {
      const rows = [];
      if (!Array.isArray(wallets)) return rows;
      for (const wallet of wallets) {
        if (wallet === null || typeof wallet !== 'object') continue;
        const currency = wallet.currency === 'USD' ? 'USD' : wallet.currency === 'CNY' ? 'CNY' : undefined;
        if (currency === undefined) continue;
        const micro = toMicro(wallet.balance);
        if (micro === null) continue;
        rows.push({ currency, micro });
      }
      return rows;
    }

    /** Prefer CNY, otherwise the first available wallet. */
    function primaryWallet(wallets) {
      if (!Array.isArray(wallets) || wallets.length === 0) return undefined;
      return wallets.find((wallet) => wallet.currency === 'CNY') ?? wallets[0];
    }

    /** Sum the recharge and bonus wallets into the spendable total per currency. */
    function mergeWallets(recharge, bonus) {
      const totals = new Map();
      for (const wallet of recharge) totals.set(wallet.currency, (totals.get(wallet.currency) ?? 0) + wallet.micro);
      for (const wallet of bonus) totals.set(wallet.currency, (totals.get(wallet.currency) ?? 0) + wallet.micro);
      return [...totals.entries()].map(([currency, micro]) => ({ currency, micro }));
    }

    function amountFor(rows, currency) {
      let total = 0;
      for (const row of rows) if (row.currency === currency) total += row.micro;
      return total;
    }

    function readToday(provider) {
      const fallback = { date: localDateKey(), micro: {} };
      try {
        const raw = window.localStorage.getItem(TODAY_KEY + provider);
        if (raw === null) return fallback;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return fallback;
        if (parsed.date !== fallback.date) return fallback;
        const micro = {};
        if (parsed.micro !== null && typeof parsed.micro === 'object') {
          for (const [currency, value] of Object.entries(parsed.micro)) {
            if (typeof value === 'number' && Number.isFinite(value) && value > 0) micro[currency] = Math.round(value);
          }
        }
        return { date: fallback.date, micro };
      } catch {
        return fallback;
      }
    }

    function writeToday(provider, today, currency, increment) {
      const fresh = readToday(provider);
      const localBefore = today.date === fresh.date ? today.micro[currency] ?? 0 : 0;
      fresh.micro[currency] = (fresh.micro[currency] ?? 0) + increment;
      try {
        // Fresh read preserves sequential writes by other stores. localStorage has no
        // cross-tab transaction: simultaneous observations can still race or duplicate.
        window.localStorage.setItem(TODAY_KEY + provider, JSON.stringify(fresh));
        today.date = fresh.date;
        today.micro = fresh.micro;
      } catch {
        today.date = fresh.date;
        today.micro = { ...today.micro, [currency]: Math.max(localBefore + increment, fresh.micro[currency]) };
        // Storage may be unavailable; the daily figure is then page-local only.
      }
    }

    // Remember each store's committed amounts without adding fields to persisted JSON.
    const persistedSessions = new WeakMap();

    function readSessionSpend(provider) {
      const stored = new Map();
      persistedSessions.set(stored, new Map());
      try {
        const raw = window.sessionStorage.getItem(SESSIONS_KEY + provider);
        if (raw === null) return stored;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return stored;
        for (const [sessionId, amounts] of Object.entries(parsed)) {
          if (amounts === null || typeof amounts !== 'object') continue;
          const micro = new Map();
          for (const [currency, value] of Object.entries(amounts)) {
            if (typeof value === 'number' && Number.isFinite(value) && value > 0) micro.set(currency, Math.round(value));
          }
          if (micro.size > 0) stored.set(sessionId, micro);
        }
      } catch {
        return new Map();
      }
      persistedSessions.set(stored, new Map([...stored].map(([id, amounts]) => [id, new Map(amounts)])));
      return stored;
    }

    function writeSessionSpend(provider, bySession) {
      const previous = persistedSessions.get(bySession) ?? new Map();
      const merged = readSessionSpend(provider);
      for (const [sessionId, amounts] of bySession) {
        for (const [currency, amount] of amounts) {
          const delta = amount - (previous.get(sessionId)?.get(currency) ?? 0);
          if (delta <= 0) continue;
          let target = merged.get(sessionId);
          if (target === undefined) merged.set(sessionId, target = new Map());
          target.set(currency, (target.get(currency) ?? 0) + delta);
        }
      }
      try {
        const payload = {};
        for (const [sessionId, amounts] of [...merged].slice(-50)) {
          payload[sessionId] = Object.fromEntries(amounts);
        }
        window.sessionStorage.setItem(SESSIONS_KEY + provider, JSON.stringify(payload));
        bySession.clear();
        for (const [sessionId, amounts] of merged) bySession.set(sessionId, amounts);
        persistedSessions.set(bySession, new Map([...bySession].map(([id, amounts]) => [id, new Map(amounts)])));
      } catch {
        // Keep the old commit baseline so the next write retries these increments.
      }
    }

    // -------------------------------------------------------------------- store

    /**
     * Page-lifetime holder of the latest balance reading, the per-session and per-day spend
     * ledgers, and the read scheduler. The component only renders it.
     */
    /**
     * Provider id -> balance source. Keys must match `SOURCES` in index.js (asserted by the test):
     * `taffy`, `tafy`, and `ds` all bill the same wallet under different credentials, and a
     * missing id is what silently blanked the pill when the profile renamed its providers.
     */
    const PROVIDERS = {
      aigocode: { label: 'AIGoCode', path: '/api/aigocode-usage' },
      taffy: { label: 'Taffy', path: '/api/taffy-usage' },
      tafy: { label: 'Taffy', path: '/api/tafy-usage' },
      ds: { label: 'Taffy', path: '/api/ds-usage' },
      'deepseek-official': { label: 'DeepSeek', path: '/api/deepseek-usage' },
      'deepseek-account': { label: 'DeepSeek Account', account: true },
    };

    /**
     * Any other provider id is resolved by the Host, which reads the profile's `baseURL` and
     * probes the documented balance endpoints itself. That keeps a newly configured provider
     * working without a new release of this plugin.
     */
    function adapterFor(provider) {
      const known = PROVIDERS[provider];
      if (known !== undefined) return known;
      if (typeof provider !== 'string' || provider === '') return null;
      return { label: provider, path: '/api/provider-balance?provider=' + encodeURIComponent(provider), generic: true };
    }

    function createStore(ctx, provider) {
      let listeners = new Set();
      let timers = new Set();
      let inflight = null;
      let retryCount = 0;
      let lastReadAt = 0;
      let snapshot = null;
      let disposed = false;

      const today = readToday(provider);
      const state = {
        phase: provider ? 'loading' : 'unavailable',
        provider,
        providerLabel: PROVIDERS[provider]?.label ?? provider ?? '—',
        balances: [],
        recharge: [],
        bonus: [],
        links: null,
        updatedAt: null,
        message: null,
        sessionId: undefined,
        sessionSpent: readSessionSpend(provider),
        today,
        flash: null,
        flashAt: 0,
        inflight: false,
      };
      /** Last observed wallet balances, used only to measure drops. */
      let lastWallets = null;

      function build() {
        const session = state.sessionId !== undefined ? state.sessionSpent.get(state.sessionId) : undefined;
        return Object.freeze({
          phase: state.phase,
          provider: state.provider,
          providerLabel: state.providerLabel,
          balances: state.balances,
          recharge: state.recharge,
          bonus: state.bonus,
          links: state.links,
          updatedAt: state.updatedAt,
          message: state.message,
          sessionId: state.sessionId,
          sessionSpent: session === undefined ? Object.freeze({}) : Object.freeze(Object.fromEntries(session)),
          todaySpent: Object.freeze({ ...state.today.micro }),
          flash: state.flash,
          inflight: state.inflight,
        });
      }

      function emit() {
        snapshot = build();
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch (error) {
            console.error('[api-balance] state listener failed', error);
          }
        }
      }

      function clearTimers() {
        for (const id of timers) clearTimeout(id);
        timers.clear();
      }

      function later(fn, ms) {
        if (disposed) return;
        const id = setTimeout(() => {
          timers.delete(id);
          fn();
        }, ms);
        timers.add(id);
        return id;
      }

      function scheduleFlashClear() {
        const at = state.flashAt;
        later(() => {
          if (state.flashAt !== at) return;
          state.flash = null;
          emit();
        }, FLASH_MS);
      }

      function accountMetadata() {
        let locale = undefined;
        try {
          const localeService = ctx.get('locale');
          locale = localeService === undefined ? undefined : localeService.getSnapshot().active;
        } catch {
          locale = undefined;
        }
        let version = '0.0.0';
        try {
          version = window.__DSH_BOOT__?.release?.version ?? version;
        } catch {
          version = '0.0.0';
        }
        return {
          version,
          locale: typeof locale === 'string' && locale !== '' ? locale : 'en',
          timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
        };
      }

      function addToday(currency, micro) {
        if (state.today.date !== localDateKey()) state.today = { date: localDateKey(), micro: {} };
        writeToday(provider, state.today, currency, micro);
      }

      function applyBalances(balances) {
        if (lastWallets !== null && state.sessionId !== undefined) {
          const deltas = [];
          for (const wallet of balances) {
            const before = lastWallets.get(wallet.currency);
            if (before === undefined) continue;
            const drop = before - wallet.micro;
            if (drop > 0) deltas.push([wallet.currency, drop]);
          }
          if (deltas.length > 0) {
            let session = state.sessionSpent.get(state.sessionId);
            if (session === undefined) {
              session = new Map();
              state.sessionSpent.set(state.sessionId, session);
            }
            for (const [currency, drop] of deltas) {
              session.set(currency, (session.get(currency) ?? 0) + drop);
              addToday(currency, drop);
            }
            writeSessionSpend(provider, state.sessionSpent);
            state.flash = { currency: deltas[0][0], micro: deltas[0][1] };
            state.flashAt = Date.now();
            scheduleFlashClear();
          }
        }
        lastWallets = new Map(balances.map((wallet) => [wallet.currency, wallet.micro]));
      }

      function succeed(outcome) {
        if (disposed) return;
        const recharge = normalizeWallets(outcome.value);
        const bonus = normalizeWallets(outcome.bonusWallets);
        const balances = mergeWallets(recharge, bonus);
        applyBalances(balances);
        state.balances = balances;
        state.recharge = recharge;
        state.bonus = bonus;
        state.phase = 'ready';
        state.message = null;
        state.updatedAt = Date.now();
        retryCount = 0;
      }

      function fail(phase, message) {
        state.phase = phase;
        state.message = message;
        retryCount += 1;
        const delay = RETRY_DELAYS_MS[Math.min(retryCount - 1, RETRY_DELAYS_MS.length - 1)];
        later(() => {
          void requestRead('retry');
        }, delay);
      }

      async function readOnce() {
        const adapter = adapterFor(provider);
        if (!adapter) {
          state.phase = 'unavailable';
          state.message = '当前供应商尚未接入余额接口 / No balance adapter: ' + (provider ?? 'unknown');
          return;
        }
        if (adapter.account) {
          const outcome = unwrapRemoteResult(await ctx.remote.account.getBalance(accountMetadata()));
          if (outcome?.status === 'failed') {
            fail('error', 'DeepSeek account balance request failed');
          } else if (outcome === null || outcome?.status === 'signed-out') {
            state.phase = 'signed-out';
            state.balances = [];
            state.recharge = [];
            state.bonus = [];
            lastWallets = null;
            state.updatedAt = Date.now();
          } else if (Array.isArray(outcome?.value)) {
            succeed(outcome);
          } else {
            fail('unavailable', 'DeepSeek account balance unavailable');
          }
          return;
        }
        let response;
        try {
          response = await fetch(adapter.path, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          });
        } catch (error) {
          fail('error', describeError(error));
          return;
        }
        if (response.status === 401 || response.status === 403) {
          state.phase = 'signed-out';
          state.message = 'The local DSH request was not authorized';
          state.balances = [];
          state.recharge = [];
          state.bonus = [];
          lastWallets = null;
          state.updatedAt = Date.now();
          return;
        }
        if (!response.ok) {
          let detail = `${adapter.label} usage request failed (${response.status})`;
          try {
            const errorBody = await response.json();
            if (typeof errorBody?.error === 'string') detail = errorBody.error;
          } catch {
            // Keep the status-based diagnostic.
          }
          fail(adapter.generic ? 'unavailable' : 'error', detail);
          return;
        }
        let payload;
        try {
          payload = await response.json();
        } catch (error) {
          fail('error', adapter.label + ' returned invalid JSON: ' + describeError(error));
          return;
        }
        const info = Array.isArray(payload?.balance_infos) ? payload.balance_infos[0] : undefined;
        const remaining =
          payload?.remaining ??
          payload?.quota?.remaining ??
          payload?.balance ??
          payload?.data?.balance ??
          payload?.data?.remaining ??
          info?.total_balance;
        const numeric = toMicro(remaining);
        if (numeric === null) {
          fail('error', adapter.label + ' usage response has no numeric remaining balance');
          return;
        }
        const rawUnit = payload?.unit ?? payload?.quota?.unit ?? payload?.currency ?? info?.currency ?? 'USD';
        const currency = String(rawUnit).toUpperCase() === 'CNY' ? 'CNY' : 'USD';
        succeed({
          value: [{ currency, balance: numeric / MICRO }],
          bonusWallets: [],
        });
      }

      function requestRead(reason) {
        if (disposed) return Promise.resolve();
        const now = Date.now();
        if (inflight !== null) return inflight;
        if (reason !== 'manual' && now - lastReadAt < READ_GAP_MS) return Promise.resolve();
        lastReadAt = now;
        state.inflight = true;
        emit();
        inflight = (async () => {
          try {
            await readOnce();
          } catch (error) {
            fail('error', describeError(error));
          } finally {
            inflight = null;
            state.inflight = false;
            emit();
          }
        })();
        return inflight;
      }

      function setSession(sessionId) {
        if (state.sessionId === sessionId) return false;
        state.sessionId = sessionId;
        state.flash = null;
        emit();
        return true;
      }

      function subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }

      function getSnapshot() {
        if (snapshot === null) snapshot = build();
        return snapshot;
      }

      function dispose() {
        disposed = true;
        clearTimers();
        listeners = new Set();
      }

      return {
        activate() { disposed = false; },
        getSnapshot,
        subscribe,
        requestRead,
        setSession,
        dispose,
      };
    }

    // ---------------------------------------------------------------------- view

    function useStoreSnapshot(store) {
      const subscribe = React.useCallback((listener) => store.subscribe(listener), [store]);
      const get = React.useCallback(() => store.getSnapshot(), [store]);
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(subscribe, get, get);
      }
      const [snap, setSnap] = React.useState(get);
      React.useEffect(() => subscribe(() => setSnap(get())), [subscribe, get]);
      return snap;
    }

    function useAnchoredPanel(open, anchorRef, panelRef) {
      const [pos, setPos] = React.useState(null);
      React.useLayoutEffect(() => {
        if (!open) {
          setPos(null);
          return undefined;
        }
        let frame = 0;
        const place = () => {
          if (typeof window.requestAnimationFrame === 'function') {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(measure);
          } else {
            measure();
          }
        };
        const measure = () => {
          const anchor = anchorRef.current;
          const panel = panelRef.current;
          if (anchor === null || panel === null) return;
          const a = anchor.getBoundingClientRect();
          const p = panel.getBoundingClientRect();
          const margin = 12;
          const gap = 8;
          let left = a.left + a.width / 2 - p.width / 2;
          left = Math.max(margin, Math.min(left, window.innerWidth - margin - p.width));
          let top = a.top - gap - p.height;
          if (top < margin) top = a.bottom + gap;
          top = Math.max(margin, Math.min(top, window.innerHeight - margin - p.height));
          setPos({ left: Math.round(left), top: Math.round(top) });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
          window.removeEventListener('resize', place);
          window.removeEventListener('scroll', place, true);
          if (frame !== 0 && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame);
        };
      }, [open, anchorRef, panelRef]);
      return pos;
    }

    function IconCoin() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', 'aria-hidden': true, focusable: 'false' },
        h('circle', { cx: 8, cy: 8, r: 6.3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', {
          d: 'M5.7 4.9 8 8l2.3-3.1M8 8v3.2M5.4 8.9h5.2M5.4 10.6h5.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.05,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    function makeTranslate(props, ctx, dict) {
      const active = (() => {
        try {
          const localeService = ctx.get('locale');
          return localeService === undefined ? undefined : localeService.getSnapshot().active;
        } catch {
          return undefined;
        }
      })();
      const primary = typeof active === 'string' ? active.split('-')[0].toLowerCase() : 'en';
      const fallbackDict = dict[primary] ?? dict.en;
      return (key, params) => {
        let text;
        if (typeof props.t === 'function') {
          try {
            text = props.t(key, params);
          } catch {
            text = undefined;
          }
        }
        if (typeof text !== 'string' || text === key) {
          text = fallbackDict[key] ?? dict.en[key] ?? key;
        }
        if (params !== undefined) {
          text = text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
        }
        return text;
      };
    }

    /**
     * Build the registered component. `renderSlot` is not used: the widget is one self-contained
     * dock cell, and the popover is positioned with fixed coordinates so no ancestor clipping
     * affects it.
     */
    function makeWidget(ctx) {
      function ApiBalanceWidget(props) {
        const selection = props.useProjection('modelSelection', (value) => value?.next);
        const [defaultProvider, setDefaultProvider] = React.useState(undefined);
        React.useEffect(() => {
          let active = true;
          ctx.remote.session.modelCatalog().then((result) => {
            if (active && result.ok) setDefaultProvider(result.value.default?.provider);
          }).catch(() => {});
          return () => { active = false; };
        }, []);
        const provider = selection?.provider ?? defaultProvider;
        const store = React.useMemo(() => createStore(ctx, provider), [provider, props.sessionId]);
        const snap = useStoreSnapshot(store);
        React.useEffect(() => {
          store.activate();
          return () => store.dispose();
        }, [store]);
        const t = makeTranslate(props, ctx, DICT);
        const [open, setOpen] = React.useState(false);
        const rootRef = React.useRef(null);
        const panelRef = React.useRef(null);
        const pos = useAnchoredPanel(open, rootRef, panelRef);
        const sessionId = props.sessionId;

        React.useEffect(() => {
          if (store.setSession(sessionId)) store.requestRead('session');
        }, [sessionId, store]);

        React.useEffect(() => {
          store.requestRead('mount');
          const intervalId = window.setInterval(() => {
            if (document.visibilityState === 'visible') store.requestRead('interval');
          }, POLL_MS);
          const onVisibility = () => {
            if (document.visibilityState === 'visible') store.requestRead('visible');
          };
          const onFocus = () => store.requestRead('focus');
          document.addEventListener('visibilitychange', onVisibility);
          window.addEventListener('focus', onFocus);
          return () => {
            window.clearInterval(intervalId);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('focus', onFocus);
          };
        }, [store]);

        const nodeCount = props.useChat === undefined ? 0 : props.useChat((chat) => chat.legacy.nodes.length);
        const lastNodeCount = React.useRef(nodeCount);
        React.useEffect(() => {
          if (nodeCount > lastNodeCount.current) {
            lastNodeCount.current = nodeCount;
            const ids = BURST_MS.map((ms) => window.setTimeout(() => store.requestRead('message'), ms));
            return () => {
              for (const id of ids) window.clearTimeout(id);
            };
          }
          if (nodeCount < lastNodeCount.current) lastNodeCount.current = nodeCount;
          return undefined;
        }, [nodeCount, store]);

        React.useEffect(() => {
          if (!open) return undefined;
          const onPointerDown = (event) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (rootRef.current?.contains(target) === true) return;
            if (panelRef.current?.contains(target) === true) return;
            setOpen(false);
          };
          const onKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false);
          };
          document.addEventListener('pointerdown', onPointerDown, true);
          document.addEventListener('keydown', onKeyDown);
          return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
          };
        }, [open]);

        const primary = primaryWallet(snap.balances);
        const sessionSpent = primary === undefined ? 0 : snap.sessionSpent[primary.currency] ?? 0;
        const low = primary !== undefined && primary.micro > -1 && primary.micro < LOW_MICRO;
        /** A failed refresh keeps showing the last settled figure instead of blanking the pill. */
        const stale = snap.phase === 'error' && primary !== undefined;

        let stateLabel = null;
        if (snap.phase === 'loading') stateLabel = t('pill.loading');
        else if (snap.phase === 'signed-out') stateLabel = t('pill.signedOut');
        else if (snap.phase === 'unavailable') stateLabel = t('pill.unavailable');
        else if (snap.phase === 'error' && !stale) stateLabel = t('pill.error');

        const balanceText = primary === undefined ? '' : formatBalance(primary.micro, primary.currency);
        const spentText = primary === undefined ? '' : formatSpent(sessionSpent, primary.currency);
        const aria = stateLabel !== null ? stateLabel : t('pill.title', { balance: balanceText, spent: spentText });
        const tone =
          snap.phase === 'error' || snap.phase === 'unavailable' || stale ? 'warn' : low ? 'warn' : undefined;

        const pillContent = [h(IconCoin, { key: 'icon' }), h('span', { key: 'provider' }, snap.providerLabel)];
        if (stateLabel === null && primary !== undefined) {
          pillContent.push(h('span', { key: 'balance', className: 'dsbw-label' }, balanceText));
          if (sessionSpent > 0) {
            pillContent.push(h('span', { key: 'sep', className: 'dsbw-sep', 'aria-hidden': true }, '·'));
            pillContent.push(
              h('span', { key: 'spent', className: 'dsbw-delta', 'data-flash': snap.flash === null ? 'false' : 'true' }, '-' + spentText),
            );
          }
        } else if (stateLabel === null) {
          pillContent.push(h('span', { key: 'state', className: 'dsbw-label' }, '—'));
        } else {
          pillContent.push(h('span', { key: 'state', className: 'dsbw-label' }, stateLabel));
        }

        const rows = [];
        const multiCurrency = snap.balances.length > 1;
        for (const wallet of snap.balances) {
          const suffix = multiCurrency ? ' ' + wallet.currency : '';
          const rechargeMicro = amountFor(snap.recharge, wallet.currency);
          const bonusMicro = amountFor(snap.bonus, wallet.currency);
          rows.push(
            h('dt', { key: 'dt-total-' + wallet.currency }, t('label.total') + suffix),
            h(
              'dd',
              { key: 'dd-total-' + wallet.currency, 'data-total': 'true', 'data-low': wallet.micro < LOW_MICRO ? 'true' : 'false' },
              formatBalance(wallet.micro, wallet.currency),
            ),
            h('dt', { key: 'dt-balance-' + wallet.currency }, t('label.balance') + suffix),
            h('dd', { key: 'dd-balance-' + wallet.currency }, formatBalance(rechargeMicro, wallet.currency)),
          );
          if (bonusMicro > 0) {
            rows.push(
              h('dt', { key: 'dt-bonus-' + wallet.currency }, t('label.bonus') + suffix),
              h('dd', { key: 'dd-bonus-' + wallet.currency }, formatBalance(bonusMicro, wallet.currency)),
            );
          }
        }
        if (primary !== undefined) {
          rows.push(
            h('dt', { key: 'dt-session' }, t('label.sessionSpent')),
            h('dd', { key: 'dd-session' }, formatSpent(sessionSpent, primary.currency)),
            h('dt', { key: 'dt-today' }, t('label.todaySpent')),
            h('dd', { key: 'dd-today' }, formatSpent(snap.todaySpent[primary.currency] ?? 0, primary.currency)),
          );
        }

        const actions = [];
        actions.push(
          h(
            'button',
            {
              key: 'refresh',
              type: 'button',
              className: 'dsbw-action',
              disabled: snap.inflight,
              onClick: () => {
                void store.requestRead('manual');
              },
            },
            t('action.refresh'),
          ),
        );
        const links = snap.links;
        if (links !== null && typeof links === 'object' && typeof links.usageUrl === 'string') {
          actions.push(
            h('a', { key: 'usage', className: 'dsbw-action', href: links.usageUrl, target: '_blank', rel: 'noreferrer noopener' }, t('action.usage')),
          );
        }
        if (links !== null && typeof links === 'object' && typeof links.topUpUrl === 'string') {
          actions.push(
            h('a', { key: 'topup', className: 'dsbw-action', href: links.topUpUrl, target: '_blank', rel: 'noreferrer noopener' }, t('action.topup')),
          );
        }

        const panel = open
          ? h(
              'div',
              {
                ref: panelRef,
                className: 'dsbw-panel',
                role: 'dialog',
                'aria-label': t('panel.title'),
                style:
                  pos === null
                    ? { left: 0, top: 0, visibility: 'hidden' }
                    : { left: pos.left + 'px', top: pos.top + 'px' },
              },
              h(
                'div',
                { className: 'dsbw-panel-title' },
                h('span', { className: 'dsbw-title-label' }, h(IconCoin, {}), snap.providerLabel + ' · ' + t('panel.title')),
                snap.updatedAt === null ? null : h('span', { className: 'dsbw-title-value' }, formatClock(snap.updatedAt)),
              ),
              h('div', { className: 'dsbw-rule', 'aria-hidden': true }),
              rows.length > 0 ? h('dl', { className: 'dsbw-details' }, rows) : null,
              snap.phase === 'signed-out' ? h('p', { className: 'dsbw-note' }, t('note.signIn')) : null,
              snap.phase === 'loading' ? h('p', { className: 'dsbw-note' }, t('note.loading')) : null,
              snap.phase === 'error' || snap.phase === 'unavailable'
                ? h('p', { className: 'dsbw-error' }, (snap.message ?? t('error.failed')) + '')
                : null,
              h('p', { className: 'dsbw-note' }, t('note.spend')),
              h('div', { className: 'dsbw-actions' }, actions),
            )
          : null;

        return h(
          'span',
          { className: 'dsbw-anchor', ref: rootRef, 'data-balance-widget': '', 'data-balance-provider': provider ?? '', 'data-balance-session': sessionId === undefined ? '' : String(sessionId) },
          h(
            'button',
            {
              type: 'button',
              className: 'dsbw-pill',
              'data-tone': tone,
              'data-composer-stat': 'api-balance',
              'aria-haspopup': 'dialog',
              'aria-expanded': open,
              'aria-label': aria,
              title: aria,
              onClick: () => setOpen((value) => !value),
            },
            pillContent,
          ),
          panel,
        );
      }

      ApiBalanceWidget.displayName = 'ApiBalanceWidget';
      return ApiBalanceWidget;
    }

    // --------------------------------------------------------------------- apply

    function installStyles() {
      if (typeof document === 'undefined') return () => {};
      const selector = 'style[data-plugin-css="' + STYLE_TAG + '"]';
      if (document.querySelector(selector) !== null) return () => {};
      const tag = document.createElement('style');
      tag.dataset.plugin = '@breey05/dsh-balance-widget';
      tag.dataset.pluginCss = STYLE_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => {
        tag.remove();
      };
    }

    function apply(ctx) {
      ctx.effect(() => installStyles());
      ctx.effect(() => ctx.locale.register(NS, DICT));
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'api-balance',
            order: 2,
            locale: NS,
          },
          makeWidget(ctx),
        ),
      );
    }

    return { inject: ['slots', 'locale', 'remote', 'remote.account', 'remote.session'], apply };
  },
});


