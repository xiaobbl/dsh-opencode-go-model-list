/**
 * Configuration normalization for `dsh-opencode-go-model-list`.
 *
 * Every field is optional: the plugin's whole point is to work with no
 * configuration at all. Normalization is deliberately tolerant — a cordis
 * patch layer, a settings-backed section, or a hand-written row may hand this
 * plugin any shape — so each key falls back to its default independently
 * instead of failing the mount.
 *
 * @module dsh-opencode-go-model-list/config
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The wire protocols a pi-ai catalog entry on this route may name. */
export const SUPPORTED_APIS = ['openai-completions', 'openai-responses', 'anthropic-messages']

/** Where the shipped catalog lives in an installed pi-ai. */
export const PI_AI_PACKAGE = '@earendil-works/pi-ai'

/** The default configuration; every key is overridable per plugin row. */
export const DEFAULTS = Object.freeze({
  /** Whether the plugin does anything at all. */
  enabled: true,
  /** Provider route to extend. The harness's own built-in route, by design. */
  provider: 'opencode-go',
  /** The plan's own served-model listing endpoint (the opencode Zen Go gateway). */
  gatewayUrl: 'https://opencode.ai/zen/go/v1/models',
  /** Metadata catalog (limits, modalities, cost). Empty string disables it. */
  catalogUrl: 'https://models.dev/api.json',
  /** Refresh interval in milliseconds; 0 refreshes once per process start. */
  refreshIntervalMs: 6 * 60 * 60 * 1000,
  /** Per-request network timeout. */
  timeoutMs: 15_000,
  /** Keep models the metadata catalog marks deprecated (the gateway still serves them). */
  includeDeprecated: true,
  /** Protocol assumed for a model neither the catalog nor a sibling can decide. */
  defaultApi: 'openai-completions',
  /** Rewrite shipped catalog entries with live metadata instead of only adding ids. */
  updateExisting: false,
  /** Patch the pi-ai model collection so a refresh needs no restart. */
  patchCollection: true,
  /** Cache file holding the last successful fetch; empty means the default path. */
  cachePath: '',
  /** Skip the network entirely (cache only; useful for air-gapped or metered hosts). */
  offline: false,
  /** Extra model ids to add beside the fetched ones, in listing order. */
  extraModelIds: [],
  /** Per-model overrides keyed by model id. */
  models: {},
  /** Log every decision, including the models already covered by the catalog. */
  verbose: false,
})

/** Keys a per-model override may set. Unknown keys are ignored, not fatal. */
export const MODEL_OVERRIDE_KEYS = Object.freeze([
  'name', 'api', 'baseUrl', 'contextWindow', 'maxTokens', 'input',
  'reasoning', 'cost', 'compat', 'thinkingLevelMap', 'skip',
])

/** Read the harness home exactly as the launcher resolves it. */
export function resolveDshHome(env = process.env) {
  const declared = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (declared.length > 0) return declared
  const home = typeof env.USERPROFILE === 'string' && env.USERPROFILE.length > 0 ? env.USERPROFILE : homedir()
  return join(home, '.dsh')
}

/** The default cache location inside the harness home. */
export function defaultCachePath(env = process.env) {
  return join(resolveDshHome(env), 'cache', 'opencode-go-model-list', 'catalog.json')
}

/** One trimmed, non-empty string, or the fallback. */
function stringOf(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

/** A non-negative finite number, or the fallback. */
function numberOf(value, fallback, { min = 0, integer = true } = {}) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < min) return fallback
  return integer ? Math.floor(parsed) : parsed
}

/** A list of unique non-empty strings. */
function stringList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed.length > 0) seen.add(trimmed)
  }
  return [...seen]
}

/** Per-model overrides, keeping only the keys the mapper understands. */
function modelOverrides(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out = {}
  for (const [id, raw] of Object.entries(value)) {
    if (typeof id !== 'string' || id.trim().length === 0) continue
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const entry = {}
    for (const key of MODEL_OVERRIDE_KEYS) if (raw[key] !== undefined) entry[key] = raw[key]
    out[id.trim()] = entry
  }
  return out
}

/**
 * Normalize one plugin row's configuration.
 * @param raw - whatever the patch layer supplied.
 * @param env - process environment (injectable for tests).
 * @returns the configuration the plugin runs with.
 */
export function normalizeConfig(raw = {}, env = process.env) {
  const source = typeof raw === 'object' && raw !== null ? raw : {}
  const api = stringOf(source.defaultApi, DEFAULTS.defaultApi)
  return Object.freeze({
    enabled: source.enabled !== false,
    provider: stringOf(source.provider, DEFAULTS.provider),
    gatewayUrl: typeof source.gatewayUrl === 'string' ? source.gatewayUrl.trim() : DEFAULTS.gatewayUrl,
    catalogUrl: typeof source.catalogUrl === 'string' ? source.catalogUrl.trim() : DEFAULTS.catalogUrl,
    refreshIntervalMs: numberOf(source.refreshIntervalMs, DEFAULTS.refreshIntervalMs),
    timeoutMs: numberOf(source.timeoutMs, DEFAULTS.timeoutMs, { min: 250 }),
    includeDeprecated: source.includeDeprecated !== false,
    defaultApi: SUPPORTED_APIS.includes(api) ? api : DEFAULTS.defaultApi,
    updateExisting: source.updateExisting === true,
    patchCollection: source.patchCollection !== false,
    cachePath: stringOf(source.cachePath, defaultCachePath(env)),
    offline: source.offline === true,
    extraModelIds: stringList(source.extraModelIds),
    models: modelOverrides(source.models),
    verbose: source.verbose === true,
  })
}
