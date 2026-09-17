/**
 * Turning upstream facts into pi-ai catalog entries.
 *
 * A contributed model must be indistinguishable from a shipped one, because
 * that is what makes it work everywhere the shipped ones do: the same route,
 * endpoint, protocol, wire quirks, capacities, modalities, and cost. The
 * shipped catalog is therefore the template. Three of its facts are not
 * interchangeable between vendors and are each resolved on their own evidence:
 *
 *  * **protocol** — the upstream product line first (a shipped entry of the same
 *    catalog family), then the SDK the provider itself declares, then what the
 *    rest of the vendor's shipped models speak;
 *  * **wire compat** — the fields every shipped model of that protocol agrees on
 *    (route-level facts), extended by a same-family entry's own switches (the
 *    vendor dialect), and never guessed across vendors;
 *  * **thinking levels** — what the upstream declares, spelled the way a
 *    same-family entry spells it, or pinned explicitly when nothing declares it.
 *
 * Everything else comes from live metadata, and an id no upstream describes yet
 * still gets a usable entry from its nearest shipped sibling.
 *
 * @module dsh-opencode-go-model-list/mapping
 */
import { effortValues, apiFromNpm } from './sources.js'

/** Every thinking level pi-ai knows, in escalation order. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** The route's endpoints by protocol, used only when nothing shipped decides. */
export const FALLBACK_BASE_URLS = Object.freeze({
  'openai-completions': 'https://opencode.ai/zen/go/v1',
  'openai-responses': 'https://opencode.ai/zen/go/v1',
  'anthropic-messages': 'https://opencode.ai/zen/go',
})

/** Vendor spellings a bare id cannot carry. */
const VENDOR_NAMES = Object.freeze({
  deepseek: 'DeepSeek', glm: 'GLM', kimi: 'Kimi', qwen: 'Qwen', minimax: 'MiniMax', mimo: 'MiMo',
  grok: 'Grok', gpt: 'GPT', hy: 'Hy', claude: 'Claude', gemini: 'Gemini', longcat: 'LongCat',
  omen: 'Omen', union: 'Union', ox: 'Ox', muse: 'Muse',
})

/** The first id segment, which is a model's vendor for every id on this route. */
export function vendorToken(id) {
  const [first] = String(id).split(/[-_.]/)
  return (first ?? '').toLowerCase()
}

/** A readable display name for an id no upstream named. */
export function titleize(id) {
  return String(id)
    .split(/[-_]/)
    .filter((token) => token.length > 0)
    .map((token, index) => {
      const lower = token.toLowerCase()
      if (index === 0 && VENDOR_NAMES[lower] !== undefined) return VENDOR_NAMES[lower]
      if (/^[a-z]/.test(token)) return token[0].toUpperCase() + token.slice(1)
      return token
    })
    .join(' ')
}

/** Case-insensitive length of the shared leading run of two ids. */
export function commonPrefixLength(left, right) {
  const a = String(left).toLowerCase()
  const b = String(right).toLowerCase()
  const max = Math.min(a.length, b.length)
  let index = 0
  while (index < max && a[index] === b[index]) index += 1
  return index
}

/** The closest of a candidate set by shared id prefix, preserving catalog order for ties. */
function closest(id, candidates) {
  let best = candidates[0]
  let bestScore = commonPrefixLength(id, best.id)
  for (const candidate of candidates.slice(1)) {
    const score = commonPrefixLength(id, candidate.id)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

/** The shipped entry whose protocol most of the route shares. */
function dominantApiSibling(entries) {
  const counts = new Map()
  for (const entry of entries) counts.set(entry.api, (counts.get(entry.api) ?? 0) + 1)
  let winner = entries[0]
  let winnerCount = -1
  for (const entry of entries) {
    const count = counts.get(entry.api) ?? 0
    if (count > winnerCount) {
      winner = entry
      winnerCount = count
    }
  }
  return winner
}

/**
 * The shipped model of the same upstream product line, when the route has one.
 *
 * This is the strongest evidence available about a model no configuration has
 * seen: the same family ships with one protocol and one wire dialect.
 * @param id - the model being added.
 * @param record - its metadata record.
 * @param installed - shipped entries.
 * @param records - metadata records for every route model, shipped ones included.
 * @returns the same-family entry, or \`undefined\`.
 */
export function familyTwinOf(id, record, installed, records) {
  const family = record?.family
  if (typeof family !== 'string' || family.length === 0) return undefined
  return installed.find((entry) => entry.id !== id && records.get(entry.id)?.family === family)
}

/**
 * The shipped model a new one should otherwise be modeled on.
 * @returns the template entry, or \`undefined\` when the route ships nothing.
 */
export function pickSibling(id, record, installed, records) {
  const entries = [...installed]
  if (entries.length === 0) return undefined
  const twin = familyTwinOf(id, record, entries, records)
  if (twin !== undefined) return twin
  const near = entries
    .map((entry) => ({ entry, score: commonPrefixLength(id, entry.id) }))
    .filter((candidate) => candidate.score >= 3)
    .sort((left, right) => right.score - left.score)
  if (near.length > 0) return near[0].entry
  const vendor = vendorToken(id)
  const sameVendor = entries.filter((entry) => vendorToken(entry.id) === vendor)
  if (sameVendor.length > 0) return closest(id, sameVendor)
  return dominantApiSibling(entries)
}

/** The protocol most of one vendor's shipped models speak. */
export function vendorMajorityApi(id, installed) {
  const vendor = vendorToken(id)
  const counts = new Map()
  for (const entry of installed) {
    if (vendorToken(entry.id) !== vendor) continue
    counts.set(entry.api, (counts.get(entry.api) ?? 0) + 1)
  }
  let winner
  let winnerCount = -1
  for (const [api, count] of counts) {
    if (count > winnerCount) {
      winner = api
      winnerCount = count
    }
  }
  return winner
}

/**
 * The compat switches every shipped model of one protocol agrees on.
 *
 * These are route-level facts rather than vendor dialect — for this route, that
 * chat-completions models do not store responses and cap output with
 * \`max_tokens\` — so a new model may safely start from them.
 * @param installed - shipped entries.
 * @param api - the protocol being described.
 * @returns the agreed switches, or \`undefined\` when the route ships none.
 */
export function baselineCompat(installed, api) {
  const peers = installed.filter((entry) => entry.api === api && entry.compat !== undefined)
  if (peers.length === 0) return undefined
  const fields = new Set()
  for (const peer of peers) for (const field of Object.keys(peer.compat)) fields.add(field)
  const agreed = {}
  for (const field of fields) {
    const values = new Set(peers.map((peer) => JSON.stringify(peer.compat[field] ?? null)))
    if (values.size === 1) agreed[field] = JSON.parse([...values][0])
  }
  return Object.keys(agreed).length > 0 ? agreed : undefined
}

/** A finite non-negative rate, or the fallback. */
function rate(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/** pi-ai's cost shape, filled from live metadata, a template, or zero. */
function costOf(record, template, override) {
  const source = override ?? record?.cost
  const base = template?.cost
  if (source === undefined) return base === undefined ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } : { ...base }
  return {
    input: rate(source.input, base?.input ?? 0),
    output: rate(source.output, base?.output ?? 0),
    cacheRead: rate(source.cache_read ?? source.cacheRead, base?.cacheRead ?? 0),
    cacheWrite: rate(source.cache_write ?? source.cacheWrite, base?.cacheWrite ?? 0),
  }
}

/** pi-ai's modality list, narrowed to what its providers can carry. */
function inputModalities(record, template, override) {
  if (Array.isArray(override) && override.length > 0) {
    const declared = override.filter((value) => value === 'text' || value === 'image')
    if (declared.length > 0) return [...new Set(declared)]
  }
  const declared = record?.modalities?.input
  if (Array.isArray(declared)) {
    const mapped = declared.filter((value) => value === 'text' || value === 'image')
    if (mapped.length > 0) return [...new Set(mapped)]
  }
  return Array.isArray(template?.input) && template.input.length > 0 ? [...template.input] : ['text']
}

/**
 * pi-ai's thinking-level map for a model.
 *
 * The map is what makes a reasoning selector honest: a level it names is
 * offered, a level pinned to \`null\` is not, and a level left out keeps pi-ai's
 * own default. Live effort declarations decide which levels exist and a
 * same-family entry decides how each is spelled — the spelling is the vendor's
 * dialect, which no listing endpoint discloses. With no same-family entry to
 * copy, undeclared levels are pinned explicitly rather than left to pi-ai's
 * asymmetric defaulting, so the selector offers exactly what was declared.
 * @param record - metadata record, when one exists.
 * @param template - the same-family entry's map, when one exists.
 * @param override - a configured map, or \`null\` to remove one.
 * @returns the map, or \`undefined\` to leave pi-ai's defaulting alone.
 */
export function thinkingLevelMapOf(record, template, override) {
  if (override !== undefined) return override === null ? undefined : { ...override }
  const values = effortValues(record)
  if (values.length === 0) return template === undefined ? undefined : { ...template }
  const map = {}
  for (const level of THINKING_LEVELS) {
    const declared = values.includes(level)
    if (level === 'off') {
      if (values.includes('none')) map.off = typeof template?.off === 'string' ? template.off : 'none'
      else if (template !== undefined && 'off' in template) map.off = template.off
      else if (template === undefined) map.off = null
      continue
    }
    if (declared) {
      const wire = template?.[level]
      map[level] = typeof wire === 'string' && wire.length > 0 ? wire : level
      continue
    }
    if (level === 'xhigh' || level === 'max') {
      if (template === undefined || level in template) map[level] = null
      continue
    }
    map[level] = null
  }
  return Object.keys(map).length > 0 ? map : undefined
}

/**
 * Build one catalog entry.
 * @param spec - id, metadata record, template entry, same-family entry, route, config.
 * @returns a pi-ai \`Model\` object ready to drop into the installed catalog.
 */
export function buildModelEntry({ id, record, sibling, familyTwin, provider, config, installed = [] }) {
  const override = config?.models?.[id] ?? {}
  const api = override.api
    ?? (sibling !== undefined && sibling.api === familyTwin?.api ? familyTwin.api : undefined)
    ?? familyTwin?.api
    ?? apiFromNpm(record)
    ?? vendorMajorityApi(id, installed)
    ?? sibling?.api
    ?? config?.defaultApi
    ?? 'openai-completions'
  const template = sibling !== undefined && sibling.api === api ? sibling : installed.find((entry) => entry.api === api)
  const baseUrl = override.baseUrl
    ?? (familyTwin !== undefined && familyTwin.api === api ? familyTwin.baseUrl : undefined)
    ?? template?.baseUrl
    ?? FALLBACK_BASE_URLS[api]
  const reasoning = override.reasoning ?? (record === undefined ? template?.reasoning : record.reasoning) ?? template?.reasoning ?? false
  const entry = {
    id,
    // A model is never named after its template: the id is the only true
    // statement about a model no upstream has described yet.
    name: override.name ?? record?.name ?? titleize(id),
    api,
    provider,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    reasoning: reasoning === true,
    input: inputModalities(record, template, override.input),
    cost: costOf(record, template, override.cost),
  }
  const dialect = familyTwin !== undefined && familyTwin.api === api ? familyTwin.compat : undefined
  const compat = override.compat ?? (dialect === undefined ? baselineCompat(installed, api) : { ...baselineCompat(installed, api), ...dialect })
  if (compat !== undefined && Object.keys(compat).length > 0) entry.compat = compat
  entry.contextWindow = override.contextWindow
    ?? (record?.limit?.context !== undefined ? record.limit.context : template?.contextWindow ?? 262144)
  entry.maxTokens = override.maxTokens
    ?? (record?.limit?.output !== undefined ? record.limit.output : template?.maxTokens ?? 32768)
  const levels = reasoning === true
    ? thinkingLevelMapOf(record, familyTwin !== undefined && familyTwin.api === api ? familyTwin.thinkingLevelMap : undefined, override.thinkingLevelMap)
    : undefined
  if (levels !== undefined) entry.thinkingLevelMap = levels
  return entry
}

/**
 * The models this plugin contributes to one route.
 *
 * The served-model listing decides membership; the metadata catalog only
 * describes. A model both the gateway and the shipped catalog already carry is
 * left exactly as shipped unless \`updateExisting\` asks for a metadata refresh.
 * @param spec - provider, shipped entries, metadata records, served ids, config.
 * @returns the entries to contribute, the ids skipped, and why.
 */
export function buildModelEntries({ provider, installed, records, servedIds = [], config }) {
  const installedById = new Map(installed.map((entry) => [entry.id, entry]))
  const candidates = []
  const seen = new Set()
  const add = (id) => {
    if (typeof id !== 'string') return
    const trimmed = id.trim()
    if (trimmed.length === 0 || seen.has(trimmed)) return
    seen.add(trimmed)
    candidates.push(trimmed)
  }
  servedIds.forEach(add)
  if (servedIds.length === 0) for (const id of records.keys()) add(id)
  config.extraModelIds.forEach(add)

  const entries = []
  const skipped = []
  for (const id of candidates) {
    const record = records.get(id)
    const override = config.models[id] ?? {}
    if (override.skip === true) {
      skipped.push({ id, reason: 'skip' })
      continue
    }
    if (record?.status === 'deprecated' && !config.includeDeprecated) {
      skipped.push({ id, reason: 'deprecated' })
      continue
    }
    const shipped = installedById.get(id)
    if (shipped !== undefined && !config.updateExisting) {
      skipped.push({ id, reason: 'already-served' })
      continue
    }
    const twin = shipped ?? familyTwinOf(id, record, installed, records)
    const sibling = shipped ?? pickSibling(id, record, installed, records)
    entries.push(buildModelEntry({ id, record, sibling, familyTwin: twin, provider, config, installed }))
  }
  return { entries, skipped }
}
