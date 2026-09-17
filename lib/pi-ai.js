/**
 * Reaching into the pi-ai catalog the harness already serves.
 *
 * The harness's `@deepseek-ai/dsh-llm-pi-ai` adapter answers "which models does
 * the `opencode-go` route serve?" from pi-ai's installed catalog: it reads the
 * provider's shipped model map while resolving each route, and it hands the
 * resulting entries to the model collection every request and every model
 * picker read goes through. This module contributes to those two places and
 * nowhere else:
 *
 *  1. the shipped catalog object itself, so a contributed model is a catalog
 *     model — same settings surfaces, same validation, same protocol;
 *  2. the model collection's `getModels`, so a contribution made after the
 *     route resolved (a background refresh) is still visible without restarting
 *     the harness.
 *
 * `@deepseek-ai/dsh-llm-pi-ai` imports pi-ai by bare specifier from inside the
 * dsh installation, and a profile plugin resolves the same specifier to the
 * same real file through the installation's module fallback, so both hold the
 * same module instance — contributing here is contributing there.
 *
 * @module dsh-opencode-go-model-list/pi-ai
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PI_AI_PACKAGE } from './config.js'

/** Marks an entry this plugin contributed, without ever reaching the wire. */
export const CONTRIBUTED = Symbol.for('dsh-opencode-go-model-list:contributed')

/** The pi-ai entry points the adapter itself imports. */
export const CORE_SPECIFIER = PI_AI_PACKAGE
export const ALL_SPECIFIER = `${PI_AI_PACKAGE}/providers/all`

/** `opencode-go` → `opencode-go.models`, the shipped catalog module for a route. */
export function catalogSpecifier(provider) {
  return `${PI_AI_PACKAGE}/providers/${provider}.models`
}

/** True when a value looks like a shipped provider catalog (id-keyed models). */
function looksLikeCatalog(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const values = Object.values(value)
  if (values.length === 0) return false
  return values.every((entry) => typeof entry === 'object' && entry !== null
    && typeof entry.id === 'string' && typeof entry.api === 'string')
}

/**
 * Import the pi-ai modules the adapter uses.
 * @returns the core module (collection factory) and the catalog helpers.
 */
/** Anchor files whose node_modules chain may hold the dsh installation. */
function installationAnchors() {
  const anchors = []
  const override = typeof process.env.DSH_PI_AI_ROOT === 'string' ? process.env.DSH_PI_AI_ROOT.trim() : ''
  if (override.length > 0) anchors.push(join(override, 'package.json'))
  if (typeof process.argv[1] === 'string' && process.argv[1].length > 0) anchors.push(process.argv[1])
  anchors.push(fileURLToPath(new URL('../package.json', import.meta.url)))
  return anchors
}

/** Split a scoped specifier into its package name and its subpath. */
function splitSpecifier(specifier) {
  const parts = specifier.split('/')
  const packageName = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  return { packageName, subpath: specifier.slice(packageName.length) }
}

/** The directory of a package, found through one anchor's resolution paths. */
function packageDirFrom(anchor, packageName) {
  let searchPaths
  try {
    searchPaths = createRequire(anchor).resolve.paths(packageName) ?? []
  } catch {
    return undefined
  }
  for (const searchPath of searchPaths) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/** The wildcard an export key matches, or \`false\` when it matches none. */
function exportKeyMatch(declared, key) {
  if (declared[key] !== undefined) return { value: declared[key], wildcard: '' }
  for (const [pattern, value] of Object.entries(declared)) {
    const star = pattern.indexOf('*')
    if (star === -1) continue
    const prefix = pattern.slice(0, star)
    const suffix = pattern.slice(star + 1)
    if (key.length < prefix.length + suffix.length) continue
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue
    return { value, wildcard: key.slice(prefix.length, key.length - suffix.length) }
  }
  return false
}

/** The absolute module URL a package's own export map declares for a subpath. */
function exportTargetUrl(packageDir, subpath) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
  const declared = manifest.exports
  if (typeof declared !== 'object' || declared === null) return undefined
  const key = subpath.length === 0 ? '.' : `.${subpath}`
  const match = exportKeyMatch(declared, key)
  if (match === false) return undefined
  const chosen = typeof match.value === 'string' ? match.value : match.value?.import ?? match.value?.default
  if (typeof chosen !== 'string' || !chosen.startsWith('./')) return undefined
  const target = join(packageDir, chosen.split('*').join(match.wildcard))
  return existsSync(target) ? pathToFileURL(target).href : undefined
}

/** Modules already resolved, keyed by specifier. */
const resolvedModules = new Map()

/**
 * Import one pi-ai entry point, by bare specifier when this profile can resolve
 * it and through the running installation otherwise — both reach the same real
 * file, and therefore the same module instance the adapter holds.
 * @param specifier - a pi-ai specifier such as the providers/all entry point.
 * @returns the module namespace, how it was reached, and the URL it came from.
 * @throws Error naming both attempts when neither resolves.
 */
export async function importPiAiModule(specifier) {
  const cached = resolvedModules.get(specifier)
  if (cached !== undefined) return cached
  let bareFailure
  try {
    const module = await import(specifier)
    const hit = { module, via: 'profile', url: import.meta.resolve?.(specifier) }
    resolvedModules.set(specifier, hit)
    return hit
  } catch (error) {
    bareFailure = error
  }
  const { packageName, subpath } = splitSpecifier(specifier)
  for (const anchor of installationAnchors()) {
    const dir = packageDirFrom(anchor, packageName)
    if (dir === undefined) continue
    const url = exportTargetUrl(dir, subpath)
    if (url === undefined) continue
    const module = await import(url)
    const hit = { module, via: 'installation', url }
    resolvedModules.set(specifier, hit)
    return hit
  }
  throw new Error(`cannot resolve ${specifier} from this profile (${bareFailure?.message ?? bareFailure}) nor from the running dsh installation`)
}

/**
 * Import the pi-ai modules the adapter uses.
 * @returns the core module, the catalog helpers, and how each was reached.
 */
export async function importPiAi() {
  const [core, all] = await Promise.all([importPiAiModule(CORE_SPECIFIER), importPiAiModule(ALL_SPECIFIER)])
  return { core: core.module, all: all.module, resolution: { core, all } }
}

/**
 * The shipped catalog object for one provider route, by reference.
 *
 * The returned object is the live module state the adapter reads, so writing
 * into it is what makes a contributed model a catalog model.
 * @param provider - provider route key.
 * @returns the mutable catalog object.
 * @throws Error when the installed pi-ai ships no such module.
 */
export async function loadShippedCatalog(provider) {
  const { module } = await importPiAiModule(catalogSpecifier(provider))
  for (const [name, value] of Object.entries(module)) {
    if (name.endsWith('_MODELS') && looksLikeCatalog(value)) return value
  }
  throw new Error(`${catalogSpecifier(provider)} exports no provider catalog`)
}

/** The shipped entries of a catalog object, in catalog order. */
export function shippedEntries(catalog) {
  return Object.values(catalog).filter((entry) => entry?.[CONTRIBUTED] === undefined)
}

/** Every entry of a catalog object, in catalog order. */
export function allEntries(catalog) {
  return Object.values(catalog)
}

/**
 * Contribute entries to the shipped catalog.
 *
 * A shipped entry is never overwritten unless `updateExisting` asks for it, so
 * an upstream fix in a later dsh release always wins over this plugin's copy of
 * the same model.
 * @param catalog - the mutable shipped catalog object.
 * @param entries - entries to add, as built by the mapper.
 * @param options - whether shipped entries may be rewritten.
 * @returns the ids actually written.
 */
export function contribute(catalog, entries, { updateExisting = false } = {}) {
  const written = []
  for (const candidate of entries) {
    if (typeof candidate?.id !== 'string' || candidate.id.length === 0) continue
    const existing = catalog[candidate.id]
    if (existing !== undefined && existing[CONTRIBUTED] === undefined && !updateExisting) continue
    // A rewritten shipped entry keeps every field this plugin did not derive,
    // so an upstream capability it never described survives the refresh.
    const entry = existing !== undefined && existing[CONTRIBUTED] === undefined
      ? { ...existing, ...candidate }
      : candidate
    Object.defineProperty(entry, CONTRIBUTED, {
      value: { fetchedAt: new Date().toISOString() },
      enumerable: false,
      configurable: true,
      writable: true,
    })
    catalog[entry.id] = entry
    written.push(entry.id)
  }
  return written
}

/**
 * Withdraw entries this plugin contributed.
 * @param catalog - the mutable shipped catalog object.
 * @param ids - restrict the withdrawal to these ids; every contributed entry by default.
 * @returns the ids removed.
 */
export function withdraw(catalog, ids) {
  const allowed = ids === undefined ? undefined : new Set(ids)
  const removed = []
  for (const [id, entry] of Object.entries(catalog)) {
    if (entry?.[CONTRIBUTED] === undefined) continue
    if (allowed !== undefined && !allowed.has(id)) continue
    delete catalog[id]
    removed.push(id)
  }
  return removed
}

/**
 * One shared `getModels` extension point.
 *
 * Patched once per process and shared by every plugin instance, because a
 * second patch over the first would compose two sources and restore only one.
 * Each instance registers a producer; the original method is restored when the
 * last one unmounts.
 */
const live = {
  proto: undefined,
  original: undefined,
  patched: undefined,
  producers: new Set(),
}

/**
 * The extra models every registered producer offers for one request.
 * @param provider - the requested route, or `undefined` for every route.
 * @param collection - the model collection the call is running on.
 * @param sources - the registered producers.
 * @returns models to merge into the collection's answer.
 */
function gatherExtra(provider, collection, sources) {
  const extra = []
  for (const source of sources) {
    let produced
    try {
      produced = source(provider, collection)
    } catch {
      continue
    }
    if (Array.isArray(produced)) extra.push(...produced)
  }
  return extra
}

/**
 * Make contributed models visible to the model collection the adapter builds.
 *
 * The adapter materializes a route's models once per configuration, so a
 * contribution that arrives later — a background refresh — would otherwise stay
 * invisible until the next settings change or restart. This wraps the
 * collection's own lookup, which is what both the model picker and every
 * request resolution go through, and merges the produced models in by id. The
 * shipped answer always wins; only ids it does not carry are appended.
 * @param core - the pi-ai core module.
 * @param produce - `(provider, collection) => models` for this instance.
 * @returns the disposer, and whether the patch is installed.
 */
export function installLiveCollection(core, produce) {
  const probe = core.createModels({})
  const proto = Object.getPrototypeOf(probe)
  if (proto === null || typeof proto.getModels !== 'function') {
    return { dispose() {}, supported: false }
  }
  if (live.proto !== proto) {
    live.proto = proto
    live.original = proto.getModels
    live.patched = undefined
    live.producers = new Set()
  }
  live.producers.add(produce)
  if (live.patched === undefined) {
    live.patched = function getModels(provider) {
      const base = live.original.call(this, provider)
      if (!Array.isArray(base) || live.producers.size === 0) return base
      const extra = gatherExtra(provider, this, live.producers)
      if (extra.length === 0) return base
      const present = new Set()
      for (const model of base) if (typeof model?.id === 'string') present.add(model.id)
      const merged = base.slice()
      for (const model of extra) {
        if (typeof model?.id !== 'string' || present.has(model.id)) continue
        present.add(model.id)
        merged.push(model)
      }
      return merged
    }
    Object.defineProperty(live.patched, 'name', { value: 'getModels', configurable: true })
  }
  proto.getModels = live.patched
  let disposed = false
  return {
    supported: true,
    dispose() {
      if (disposed) return
      disposed = true
      live.producers.delete(produce)
      if (live.producers.size === 0 && live.proto?.getModels === live.patched) live.proto.getModels = live.original
    },
  }
}
