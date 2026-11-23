# Changelog

## 1.4.9

- Show estimated spend for the latest user message using the change in reported billing, key usage or wallet balance. Shared-key activity can affect the estimate; without a baseline the panel shows a dash.
- Remove the redundant key quota note and restore the original menu surface without decorations on the title and action rows.

## 1.4.8

- Fix: the popover showed two stray bordered bands, one behind the title row and one behind the
  action row. The panel is portaled to `document.body` and painted with the menu background token
  plus the menu backdrop blur, so the composer underneath bled through as faint rectangles. The
  panel now uses the opaque `--dsw-alias-bg-layer-1` surface with no blur, and the title and action
  rows explicitly reset border, outline, background and shadow.

## 1.4.7

- Balance endpoints are now discovered instead of hard-coded: an unknown provider whose site
  publishes `/api/status` with a quota conversion is probed for a key-scoped quota endpoint without
  any configuration, and the verified endpoint is cached per origin for ten minutes.
- An `auth` answer (401/403) stops the probe immediately instead of walking every candidate path, and
  an unrecognised site reports `no balance endpoint recognized`.

## 1.4.6

- New API style sites (a key-scoped quota instead of an account wallet) now display in the pill and
  the panel: remaining, granted and used quota, converted only when the site's own `/api/status`
  publishes a conversion and display unit, and shown in raw quota units otherwise. The key is only
  ever sent to the site's quota endpoint, and quota usage never counts as this conversation's spend.

## 1.4.5

- Fix: the pill disappeared completely after 1.4.4. The renderer read `snap.cost` while the store's
  snapshot never published a `cost` field, so every render threw a `TypeError` and the composer dock
  slot rendered nothing.
- `build()` now publishes `cost`, and the popover reads it with optional chaining, so a snapshot
  without provider pricing can never take the widget down again.
- New test: the suite statically compares every `snap.<field>` read in the renderer against the
  fields `build()` publishes, so a future field cannot be read before it exists.

## 1.4.4

- The widget now says what the **open conversation** cost. When the provider reports a billed total
  (`usage.total.actual_cost`, `daily_usage[]`, `model_stats[]`, or a flat `total_cost`), the Host
  passes it through and the client attributes the growth since the conversation started to that
  conversation. A top-up, an expiring bonus, or a price change therefore no longer looks like spend.
- Providers that expose only a balance keep the previous behaviour: spend is estimated from the
  balance drop.
- New protected route `GET /api/session-usage?session=<id>` folds the session log's
  `assistant/message` events, so the panel shows real input/output token counts and the request count
  for the conversation (de-duplicated by message id, grouped per provider/model). No price table is
  involved and nothing is estimated.
- The popover gained `本对话消耗` / `输入 / 输出 token` / `本对话请求数` rows; the pill keeps showing the
  balance plus the conversation spend.
- Switching conversations resets the per-conversation baseline and token totals, and drops the
  stale wallet snapshot used for drop tracking.

## 1.4.3

- The popover now cancels the offset a transformed/filtered ancestor introduces: placement measures
  where the panel actually lands and subtracts that drift, so `position: fixed` inside such a
  containing block no longer shifts the panel away from the pill.
- Placement runs synchronously on open, again after paint, and twice more while the composer settles;
  a panel that is not laid out yet is retried instead of staying hidden, which is why the click
  sometimes appeared to do nothing.
- The React portal import is now guarded against a loader that returns no module, and a portal that
  throws falls back to inline rendering.
## 1.4.2

- Fixed the popover opening offset from the pill: the panel is now rendered through a React portal
  into `document.body`, so ancestors of the composer that clip overflow or create a containing block
  (`transform`, `backdrop-filter`) no longer shift its `position: fixed` coordinates.
- The panel is re-measured with a `ResizeObserver`, so it stays anchored when its height changes after
  the balance settles (loading note replaced by the detail rows).

## 1.4.1

- Added `scripts/probe-provider.mjs`: given a provider base URL and its key env name it reports the API
  protocol, the model catalogue and a working balance endpoint, then prints the `llm-pi-ai` profile
  block. Onboarding a provider no longer needs anyone to supply endpoint details up front.
- README documents that workflow.

## 1.4.0

- Balance sources are discovered instead of hard-coded: an unknown provider ID is resolved from the
  profile's `baseURL`/`apiKeyEnv`, then the Host probes the documented balance paths (`/user/balance`,
  `/v1/usage`, `/v1/credits`, `/v1/dashboard/billing/subscription`, `/api/user/self`, `/v1/balance`,
  `/api/usage`, `/usage`) and caches the winning endpoint per origin.
- Added the official DeepSeek route `deepseek-official`, which reads `balance_infos[].total_balance` (CNY)
  from `https://api.deepseek.com/user/balance`.
- Response parsing accepts nested `data`/`quota` shapes and `balance_infos`, so a CNY wallet no longer
  shows up as a blank pill.
- New generic Host route `GET /api/provider-balance?provider=<id>` backs every provider without an
  explicit source entry; the client falls back to it instead of reporting the balance as unavailable.

## 1.3.1

- Documentation-only release: 1.3.0 shipped a tarball whose README still told readers to install
  `@breey05/dsh-balance-widget@1.2.0`, so the npm page showed a stale version. The install snippet and
  provider table now describe 1.3.0 behaviour.

## 1.3.0

- Fix the balance going blank after a profile renamed or added provider IDs: `taffy` (renamed from `tafy`) and `ds` are now mapped, so the pill shows the balance instead of “余额不可用”.
- Each provider ID resolves its own credential (`TAFFY_API_KEY` for `taffy`/`tafy`, `DS_API_KEY` for `ds`), so two routes to the same wallet no longer share one key.
- Host routes are generated from one `SOURCES` table; `npm test` asserts the client `PROVIDERS` map and the host table list the same IDs.
- Report a missing credential ref, a non-JSON response, and an inactive account as distinct errors instead of a generic failure.

## 1.2.0

- Follow the current session's selected provider via the modelSelection projection.
- Support AIGoCode, Taffy and DeepSeek account balances; explicitly mark other providers unavailable.
- Isolate spend by provider and session, discard late results after switching.
- Display the provider name and update bilingual plugin metadata and documentation.
- Add regression checks for provider endpoints, wallet totals, isolation and disposed requests.

## 1.1.0 (local development, unpublished)

- Read Taffy usage through a protected Host route using the local `TAFFY_API_KEY` credential reference.
- Removed the browser-side DeepSeek account Remote dependency.
- Normalize Taffy remaining balance and preserve spend tracking.

## 1.0.0 — first public release

Published to npm as [`@breey05/dsh-balance-widget@1.0.0`](https://www.npmjs.com/package/@breey05/dsh-balance-widget).

- Composer-dock pill showing the signed-in DeepSeek account's available balance and the
  current conversation's observed spend.
- Details popover with recharge/bonus wallets, per-conversation and per-day spend, refresh
  action, and Platform usage/top-up links.
- Conservative read scheduling with long failure backoff; English and Chinese copy; light and
  dark themes; original icon.
