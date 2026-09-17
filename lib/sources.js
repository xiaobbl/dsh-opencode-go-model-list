/**
 * The two upstreams that describe the opencode Go plan.
 *
 * Neither is a harness API, so both are read defensively: the gateway listing
 * decides *which* models the plan serves, and the metadata catalog decides what
 * each of them can do. A payload in an unexpected shape is a miss, never a
 * throw — the plugin keeps whatever the installed catalog already serves.
 *
 * Requests go through the global `fetch`, which the harness launcher has
 * already routed according to the process's proxy environment
 * (`@deepseek-ai/dsh-http-proxy`), so a deployment behind a proxy needs
 * nothing here.
 *
 * @module dsh-opencode-go-model-list/sources
 */
import { SUPPORTED_APIS } from './config.js'

/** The user agent every request carries, so opencode's logs can attribute it. */
export const USER_AGENT = 'dsh-opencode-go-model-list/0.1.0'

/**
 * One JSON GET with a bounded timeout.
 * @param url - absolute endpoint.
 * @param options - timeout, fetch implementation, and an optional abort signal.
 * @returns the parsed payload.
 * @throws Error naming the endpoint when the request or the parse fails.
 */
export async function fetchJson(url, { timeoutMs = 15_000, fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('no fetch implementation is available in this process')
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    signal: combined,
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  return await response.json()
}

/**
 * Model ids a listing endpoint advertises, in endpoint order.
 *
 * Accepts the OpenAI `{ data: [{ id }] }` shape, the enriched `{ models: {...} }`
 * map some compatible gateways expose, a bare array, and a bare id list.
 * @param payload - the decoded response body.
 * @returns unique ids; empty when the payload advertises nothing readable.
 */
export function gatewayModelIds(payload) {
  const ids = []
  const push = (value) => {
    if (typeof value === 'string' && value.trim().length > 0) ids.push(value.trim())
  }
  const collect = (entry) => {
    if (typeof entry === 'string') return push(entry)
    if (typeof entry !== 'object' || entry === null) return
    if (typeof entry.id === 'string') return push(entry.id)
    if (typeof entry.name === 'string') return push(entry.name)
  }
  if (Array.isArray(payload)) payload.forEach(collect)
  else if (typeof payload === 'object' && payload !== null) {
    if (Array.isArray(payload.data)) payload.data.forEach(collect)
    if (Array.isArray(payload.models)) payload.models.forEach(collect)
    else if (typeof payload.models === 'object' && payload.models !== null) Object.keys(payload.models).forEach(push)
  }
  return [...new Set(ids)]
}

/**
 * The metadata catalog slice for one provider.
 *
 * `models.dev/api.json` is a `{ [providerId]: { name, api, env, models } }`
 * document; only the requested provider is kept, and only the model fields the
 * mapper reads are copied, so the 4–5 MB document does not stay reachable from
 * this plugin's state.
 * @param payload - the decoded `api.json`.
 * @param provider - provider route key.
 * @returns the provider facts and a `Map` of model records by id.
 */
export function providerCatalog(payload, provider) {
  const entry = typeof payload === 'object' && payload !== null ? payload[provider] : undefined
  if (typeof entry !== 'object' || entry === null) return { provider: undefined, models: new Map() }
  const records = new Map()
  const models = typeof entry.models === 'object' && entry.models !== null ? entry.models : {}
  for (const [id, record] of Object.entries(models)) {
    if (typeof record !== 'object' || record === null) continue
    records.set(id, {
      id,
      name: typeof record.name === 'string' ? record.name : undefined,
      family: typeof record.family === 'string' ? record.family : undefined,
      status: typeof record.status === 'string' ? record.status : undefined,
      reasoning: record.reasoning === true,
      reasoningOptions: Array.isArray(record.reasoning_options) ? record.reasoning_options : [],
      modalities: record.modalities,
      limit: record.limit,
      cost: record.cost,
      npm: typeof record.provider === 'object' && record.provider !== null ? record.provider.npm : undefined,
    })
  }
  return {
    provider: {
      name: typeof entry.name === 'string' ? entry.name : undefined,
      api: typeof entry.api === 'string' ? entry.api : undefined,
      env: Array.isArray(entry.env) ? entry.env.filter((value) => typeof value === 'string') : undefined,
    },
    models: records,
  }
}

/**
 * The reasoning-effort levels one metadata record declares.
 * @param record - one metadata record, when the catalog described the model.
 * @returns the declared effort spellings, in declared order.
 */
export function effortValues(record) {
  const options = record?.reasoningOptions
  if (!Array.isArray(options)) return []
  for (const option of options) {
    if (typeof option === 'object' && option !== null && option.type === 'effort' && Array.isArray(option.values)) {
      return option.values.filter((value) => typeof value === 'string' && value.length > 0)
    }
  }
  return []
}

/**
 * The protocol a metadata record's own SDK implies.
 *
 * A last resort only: the catalog's per-model SDK disagrees with the shipped
 * catalog for models pi-ai curates by hand (`minimax-m2.7` declares
 * `@ai-sdk/anthropic` yet ships as `openai-completions`), which is why a
 * shipped sibling always wins over this hint.
 * @param record - one metadata record.
 * @returns a supported protocol, or `undefined` when the SDK implies none.
 */
export function apiFromNpm(record) {
  const npm = record?.npm
  if (typeof npm !== 'string') return undefined
  if (npm.includes('anthropic')) return 'anthropic-messages'
  if (npm === '@ai-sdk/openai') return 'openai-responses'
  if (npm.startsWith('@ai-sdk/openai')) return 'openai-completions'
  return undefined
}

/** Every protocol the shipped catalog is allowed to have named. */
export const KNOWN_APIS = [...SUPPORTED_APIS]
