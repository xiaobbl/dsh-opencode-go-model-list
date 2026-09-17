[![English](https://img.shields.io/badge/English-README-2ea44f?style=for-the-badge)](README.md) [![简体中文](https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-README-6e7681?style=for-the-badge)](README.zh.md)

# dsh-opencode-go-model-list

Keeps the harness's **own** `opencode-go` provider route on the model list opencode Go actually serves — no second provider, no `settings.yaml` edits, no credential handling, and no shipped model overwritten.

- Before: the `opencode-go` route lists 27 models (pi-ai's shipped snapshot)
- After: the same route lists 38 — adding `deepseek-v4.1-flash`, `kimi-k2.5`, `grok-4.5`, `glm-5`, `qwen3.5-plus`, `mimo-v2-pro/omni`, `minimax-m2.5`, `deepseek-flash`, `hy3-preview`, `union-alpha`

## The problem it closes

When opencode ships a model the harness snapshot predates (for example `deepseek-v4.1-flash`), the route cannot serve it, and adding it by configuration fails:

```text
llm-pi-ai: provider "opencode-go" model "deepseek-v4.1-flash" needs an api; the installed
catalog does not describe it, so set the route's api to the wire protocol its endpoint speaks
```

Every configuration path has a cost — see [discussion #6464](https://github.com/deepseek-ai/deepseek-harness/discussions/6464):

| Path | Cost |
|---|---|
| `providers.opencode-go.models` | **replaces** the route's whole catalog (all 27 shipped models), and every entry must restate `api`/`baseURL` |
| `modelOverrides` | only reshapes ids the catalog already describes; a new id is refused |
| a custom route | is not the built-in `opencode-go`, so balance/cost/session plugins no longer recognize it |

This plugin takes the third path: it contributes **into the catalog itself**, so a new model becomes a shipped model.

## How it works

1. **Catalog contribution** — missing models are added to pi-ai's `opencode-go` catalog object (`MODELS['opencode-go']`), which is exactly what `dsh-llm-pi-ai` reads while resolving the route (`getBuiltinModels('opencode-go')`). Settings surfaces, model validation, and request resolution therefore treat them as built-ins.
2. **Collection patch** — the pi-ai model collection's `getModels` is wrapped so a route that already resolved still sees entries that arrive later. A background refresh lands in the model picker and the request path **without a restart**.
3. **Cache** — a successful fetch is written to `$DSH_HOME/cache/opencode-go-model-list/catalog.json`, adopted synchronously on the next boot, and refreshed in the background. Offline hosts keep the last good list.

## Sources and inference rules

| Source | Role |
|---|---|
| `GET https://opencode.ai/zen/go/v1/models` | which models the plan **serves** (public, no auth; 38 at the time of writing) |
| `GET https://models.dev/api.json`, `opencode-go` slice | context/output limits, modalities, cost, reasoning options, `family` (37 records) |
| the shipped catalog | `api`, `baseUrl`, `compat` (vendor wire dialect), thinking-level spellings |

Each field is resolved on its own evidence:

- **protocol**: same-`family` shipped model → the SDK the provider itself declares (`provider.npm`) → the vendor's majority protocol → the route's majority protocol → `defaultApi`
- **compat**: the fields *every* shipped model of that protocol agrees on (route-level facts such as `supportsStore:false`), extended by a same-family model's own dialect (deepseek's `thinkingFormat: deepseek`) — never guessed across vendors
- **thinking levels**: the upstream's declared efforts, spelled the way a same-family model spells them; with no same-family model, undeclared levels are pinned explicitly
- **undescribed models** (`hy3-preview`): cloned from the nearest sibling by id prefix, named from the id

Fidelity regression against the shipped catalog itself (`test/fidelity.test.mjs`, each entry rebuilt with the model removed from the shipped set): `reasoning`/`input`/`contextWindow`/`maxTokens` match 27/27, `api` 26/27, `name` 26/27, `cost` 22/27, `compat`/`thinkingLevelMap` 21/27. The gaps are curated facts no listing endpoint discloses (price revisions, vendor dialects).

## Install

### Option 1: the standard `dsh plugin` command

```powershell
cd E:\path\to\dsh-opencode-go-model-list-fix
dsh plugin --profile web add .                       # link: dependency; node_modules points here
# or a packed, self-contained copy:
dsh plugin --profile web add file:E:\path\to\dsh-opencode-go-model-list-fix
```

`dsh plugin` forwards its arguments to pnpm inside the profile directory and then reconciles `dsh.profile.bundles` **against installed state**: any dependency whose package declares `dsh.bundle.patch` joins the profile layer stack. This package declares it, so one command covers dependency, `node_modules`, and bundle registration. Verified in an isolated home: both `link:` and `file:` registered the bundle and booted to 38 models. pnpm must be on PATH (11.17.0 here).

- `link:`: the profile's `node_modules` points at this checkout — edits apply immediately, but the directory must stay put.
- `file:`: pnpm packs a copy honoring `files`, self-contained; re-run `add` to update.
- If a run ever leaves the bundle unregistered (seen once in the first trial), `dsh plugin --profile web install` re-registers it from installed state.

### Option 2: `install.ps1` (no pnpm needed)

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1            # profile: web (default)
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profile tui
```

The script does exactly two things: copies the package to `$DSH_HOME/profiles/<profile>/node_modules/dsh-opencode-go-model-list`, and appends the package name to that profile's `dsh.profile.bundles`. It never writes into the dsh installation, `settings.yaml`, or the credential store. Verified that `pnpm install` / `pnpm add` do not prune such a copy (it sits outside pnpm's dependency graph, which is also why `update` will not upgrade it).

After a restart, expect:

```text
[opencode-go-model-list] mounted: route=opencode-go gateway=https://opencode.ai/zen/go/v1/models ...
[opencode-go-model-list] route "opencode-go" resolved against the installed catalog: 27 shipped models, ...
[opencode-go-model-list] gateway=38, catalog=37 → 11 contributed (27 already served) in 2641ms
```

Uninstall with `uninstall.ps1` (add `-RemoveCache` to drop the cache). Nothing on disk in the installation was ever modified, so removal restores the previous list exactly.

## Verify without touching your profile

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-in-isolated-home.ps1 -Proxy http://127.0.0.1:7897
```

It builds an isolated harness home under `.verify/dsh-home`, initializes a throwaway `headless` profile, links this package and a probe plugin into it, and boots dsh twice — with and without the plugin — while the probe asks the harness's own LLM service (`ctx.llm.listModels('opencode-go')`, `resolveModelInfo`) for the route's models. Observed output:

```text
===== without the plugin (shipped catalog) =====
[probe] count 27 after 24.5s
[probe] has-target deepseek-v4.1-flash=false kimi-k2.5=false
===== with the plugin (live catalog) =====
[probe] count 38 after 0.5s
[probe] has-target deepseek-v4.1-flash=true kimi-k2.5=true
[probe] resolve deepseek-v4.1-flash {"provider":"opencode-go","id":"deepseek-v4.1-flash","name":"DeepSeek V4.1 Flash",
  "inputModalities":["text","image"],"context":{"contextWindow":1000000},
  "reasoning":{"efforts":[{"id":"off",...},{"id":"low",...},{"id":"high",...},{"id":"max",...}]}}
```

## Configuration (all optional)

```yaml
- id: opencode-go-model-list
  name: 'dsh-opencode-go-model-list'
  config:
    provider: opencode-go                     # the route to extend (the built-in one by default)
    gatewayUrl: https://opencode.ai/zen/go/v1/models   # what the plan serves
    catalogUrl: https://models.dev/api.json   # metadata; empty means gateway + siblings only
    refreshIntervalMs: 21600000               # 6h; 0 fetches once per process start
    timeoutMs: 15000
    offline: false                            # cache only, no network
    includeDeprecated: true
    defaultApi: openai-completions
    updateExisting: false                     # true rewrites shipped entries with live metadata
    patchCollection: true                     # the live view that makes a refresh need no restart
    cachePath: ''                             # default: $DSH_HOME/cache/opencode-go-model-list/catalog.json
    extraModelIds: []
    models:                                   # per-model overrides, keyed by id
      deepseek-v4.1-flash:
        name: DeepSeek V4.1 Flash
        contextWindow: 1000000
      some-id:
        skip: true
    verbose: false
```

## Compatibility

- **Built-in route only**: the plugin never calls `llm.registerAdapter` and registers no provider. `opencode-go` stays the catalog provider `dsh-llm-pi-ai` reuses — same API implementations, same ambient credential discovery, same `apiKeyEnv`.
- **dsh-opencode-session-id**: it injects `x-opencode-session` and friends by route name plus URL host (`opencode.ai`). Contributed models use the same route and base URL, so session headers keep flowing.
- **dsh-cost-meter**: provider and model naming are unchanged, and every contributed entry carries `cost` (from models.dev). Whether its own price table covers a new model is that plugin's data question.
- **Reversible**: shipped entries are never overwritten unless `updateExisting: true`; unmounting withdraws exactly the contributed ids and restores the original collection method.

## Known limits

- Protocol and `compat` are inferred from the shipped catalog. If opencode ever puts a new model on a protocol none of its siblings use, name it explicitly with the per-model `api` override.
- models.dev prices and limits can differ from what opencode bills (the shipped catalog disagrees with it in places too); the gateway is the ground truth.
- The first run needs network access to `opencode.ai` and `models.dev`, through the process proxy environment the harness launcher already installs (`@deepseek-ai/dsh-http-proxy`) — no extra configuration here. When both fail, the shipped catalog is served unchanged.

## Layout and tests

```text
lib/index.js     plugin entry (cordis: name / inject / apply, plus a testable mount)
lib/config.js    configuration normalization and defaults
lib/sources.js   the two upstreams, fetched and parsed leniently
lib/mapping.js   upstream facts -> pi-ai catalog entries (every inference rule lives here)
lib/pi-ai.js     pi-ai module location, catalog contribute/withdraw, collection patch
lib/cache.js     cache read (sync) and write (atomic)
test/            unit, catalog integration, fidelity, end-to-end (35 cases)
scripts/         isolated-home verification script and its probe plugin
```

```powershell
npm test                    # standard node --test (spawns workers)
npm run test:in-process     # every suite in one process (works under a restricted sandbox)
```
