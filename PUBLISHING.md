# Maintainer notes

This repository is also the installable package: the repository root is the package root, so
users install it by Git URL (see [README.md](README.md#install)).

- Repository: <https://github.com/BREEY05/dsh-balance-widget>
- Package name: `@breey05/dsh-balance-widget` (scoped because the unscoped npm name
  `dsh-balance-widget` belongs to a different plugin)
- Release tag: `v1.0.0`
- Install specs: `@breey05/dsh-balance-widget@1.0.0` (npm) or
  `git+https://github.com/BREEY05/dsh-balance-widget.git#v1.0.0` (Git)

## Published releases

| Version | Registry | Published |
|---|---|---|
| `1.0.0` | npm — <https://www.npmjs.com/package/@breey05/dsh-balance-widget> | 2026-10-21 |

Publishing notes for this account: npm now requires **2FA (OTP)** or a granular access token
with **Bypass 2FA** to publish; a plain `npm login` session token is refused with HTTP 403.
Direct publishing with a bypass-2FA token is scheduled for removal in **January 2027** — after
that use `npm stage publish` plus an approval step, or enable 2FA. A new package's first
publish is accepted with HTTP 202 and becomes readable a few minutes later; mirrors sync
afterwards (the Tencent mirror had it within minutes, npmmirror later).

## Publish a release

```bash
npm version patch          # or minor / major: bumps package.json and creates the tag
git push origin main --follow-tags
```

If `npm version` created the tag, `--follow-tags` pushes it. Otherwise push it explicitly:

```bash
git push origin main
git push origin v1.0.1
```

Keep `engines.dsh` in sync with the DSH release you tested against. DSH checks `engines.dsh`
(and DSH peer dependencies) at install time; for a Git or tarball spec the check runs after the
fetch and rolls the profile back on refusal.

## Push troubleshooting (GitHub behind a proxy)

If `git push` reports `Recv failure: Connection was reset` while the GitHub website loads, the
system proxy is not applied to Git. Push through it explicitly:

```bash
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push origin main
```

or persist it for this repository only (not committed):

```bash
git config --local http.proxy http://127.0.0.1:7890
git config --local https.proxy http://127.0.0.1:7890
```

Use the proxy address your system actually uses; remove those two settings when it changes.

The DSH installer performs the same GitHub check (`git ls-remote`) and fetch that your Git
configuration governs, so a machine that needs a proxy to reach GitHub also needs one for
Git-based installation. If GitHub is generally unreachable for your audience, publish the
package to npm instead — DSH falls back to the npmmirror registry when the default is
unreachable.

## Optional: npm publishing

The package is scoped and `publishConfig.access` is already `public`, so a normal publish is
enough once the npm account owns the `@breey05` scope:

```bash
npm login            # an account that owns (or is a member of) the @breey05 scope
npm publish
```

If your npm account is named differently, rename the package to your own scope first. The name
appears in exactly three runtime places:

1. `package.json` `"name"`
2. `client.js` `window.__ModuleLoader__.load({ id })`
3. the stylesheet's `data-plugin` value in `client.js`

Then update the `name` in `cordis.patch.yml` and the README. Users then install
`@<scope>/dsh-balance-widget@<version>` through the plugin dialog.

Do not publish with a `private: true` manifest.

## Optional: a plugin-market index

DSH can also list the plugin in its **Discover** tab when a user adds a
[plugin market index](https://github.com/deepseek-ai/deepseek-harness) URL (format 1 JSON).
That file is a separate hosted artifact; it lists the plugin's display metadata and an install
target per version (`name@version` for npm, or a commit-pinned
`git+https://github.com/BREEY05/dsh-balance-widget.git#<commit>` for Git). Only add this once the
repository has stable tagged releases — direct Git installation above works without it.
