# Changelog

## 1.2.0

- Follow the current session's selected provider via the modelSelection projection.
- Support AIGoCode, Taffy and DeepSeek account balances; explicitly mark other providers unavailable.
- Isolate spend by provider and session, discard late results after switching.
- Display the provider name and update bilingual plugin metadata and documentation.
- Add regression checks for provider endpoints, wallet totals, isolation and disposed requests.

## 1.1.0 (local development, unpublished)

- Read Taffy usage through a protected Host route using the local `TAFY_API_KEY` credential reference.
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
