/**
 * dsh-opencode-go-model-list — the harness's own `opencode-go` route, kept on
 * the model list opencode Go actually serves.
 *
 * The route's models come from pi-ai's installed catalog, which is generated
 * from a snapshot: a model opencode ships after that snapshot exists on the
 * gateway but not in the harness, and no configuration can add it cleanly —
 * `models` replaces the route's whole catalog, and `modelOverrides` refuses an
 * id the catalog does not describe. This plugin closes that gap at the catalog
 * itself:
 *
 *  * it reads the plan's own served-model listing and the public metadata
 *    catalog, builds entries shaped exactly like shipped ones (protocol,
 *    endpoint, wire compat, capacities, modalities, cost, thinking levels);
 *  * it contributes them to the pi-ai catalog the adapter already reads and to
 *    the model collection it already queries;
 *  * it registers no provider, writes no settings, and holds no credential, so
 *    the route keeps its name, its `apiKeyEnv`, its session headers, and its
 *    cost accounting — every plugin that keys on `opencode-go` keeps working.
 *
 * Everything it adds is additive and reversible: a model the shipped catalog
 * carries is never rewritten (unless `updateExisting` asks), and unmounting the
 * plugin withdraws exactly what it contributed.
 *
 * @module dsh-opencode-go-model-list
 */
import { readCatalogCache, writeCatalogCache } from './cache.js'
import { normalizeConfig } from './config.js'
import { buildModelEntries } from './mapping.js'
import { contribute, importPiAi, installLiveCollection, loadShippedCatalog, allEntries, shippedEntries, withdraw } from './pi-ai.js'
import { fetchJson, gatewayModelIds, providerCatalog } from './sources.js'

/** The plugin's cordis name (the row id in a composed profile). */
export const name = 'opencode-go-model-list'

/** No harness service is required: the plugin only reads a module and the network. */
export const inject = []

/** Verbose per-model lines are only interesting while debugging. */
const LOG_PREFIX = 'opencode-go-model-list'

/** Iterate the served ids a route's producer should answer with. */
function matchingEntries(provider, collection, providerId, entries) {
  if (provider !== undefined && provider !== providerId) return []
  if (provider === undefined && collection?.providers?.has?.(providerId) !== true) return []
  return entries
}

/**
 * Mount the plugin.
 * @param ctx - the cordis context (only `logger`, `effect`, and disposal are used).
 * @param config - the row's configuration; every field is optional.
 * @returns the readiness promise, the disposer, and the live contribution.
 */
export function mount(ctx, config = {}) {
  const cfg = normalizeConfig(config)
  const state = { entries: [], ids: [], disposed: false }
  const log = (message, level = 'info') => {
    const line = `${LOG_PREFIX}: ${message}`
    if (level === 'debug') {
      if (cfg.verbose) ctx.logger?.debug?.(line)
    } else if (level === 'warn') ctx.logger?.warn?.(line)
    else ctx.logger?.info?.(line)
    if (level !== 'debug' || cfg.verbose) {
      // The web profile routes cordis logs to a sink a user cannot read; stderr
      // keeps the mount and each refresh visible, and never touches stdout,
      // which the acp / headless / sdk profiles own for their own protocol.
      console.error(`[${LOG_PREFIX}] ${message}`)
    }
  }
  if (!cfg.enabled) {
    log('disabled by configuration; the shipped opencode-go catalog is served unchanged')
    return
  }

  let timer
  let livePatch
  let catalog
  let running

  /** Every model this instance currently contributes, as pi-ai entries. */
  const currentEntries = () => state.entries

  /** Contribute entries, remember the ids, and report what was written. */
  const publish = (entries) => {
    if (catalog === undefined) return []
    const written = contribute(catalog, entries, { updateExisting: cfg.updateExisting })
    state.ids = [...new Set([...state.ids, ...written])]
    return written
  }

  /** Fetch both upstreams, build the entries, and hand them to the catalog. */
  const refresh = async () => {
    if (running !== undefined) return running
    running = (async () => {
      const started = Date.now()
      let servedIds = []
      let records = new Map()
      const notes = []
      if (cfg.gatewayUrl.length > 0) {
        try {
          servedIds = gatewayModelIds(await fetchJson(cfg.gatewayUrl, { timeoutMs: cfg.timeoutMs }))
          notes.push(`gateway=${servedIds.length}`)
        } catch (error) {
          notes.push(`gateway=failed(${error?.message ?? error})`)
        }
      }
      if (cfg.catalogUrl.length > 0) {
        try {
          const payload = await fetchJson(cfg.catalogUrl, { timeoutMs: cfg.timeoutMs })
          const slice = providerCatalog(payload, cfg.provider)
          records = slice.models
          notes.push(`catalog=${records.size}`)
        } catch (error) {
          notes.push(`catalog=failed(${error?.message ?? error})`)
        }
      }
      if (servedIds.length === 0 && records.size === 0) {
        log(`refresh found nothing (${notes.join(', ')}); keeping the served catalog as is`, 'warn')
        return
      }
      const { entries, skipped } = buildModelEntries({
        provider: cfg.provider,
        installed: shippedEntries(catalog),
        records,
        servedIds,
        config: cfg,
      })
      const written = publish(entries)
      state.entries = [...state.entries.filter((entry) => !written.includes(entry.id)), ...entries]
      try {
        writeCatalogCache(cfg.cachePath, {
          provider: cfg.provider,
          fetchedAt: new Date().toISOString(),
          sources: { gatewayUrl: cfg.gatewayUrl, catalogUrl: cfg.catalogUrl, served: servedIds.length, described: records.size },
          entries,
        })
      } catch (error) {
        log(`could not write the catalog cache at ${cfg.cachePath}: ${error?.message ?? error}`, 'warn')
      }
      const already = skipped.filter((entry) => entry.reason === 'already-served').length
      const held = skipped.filter((entry) => entry.reason !== 'already-served')
      log(`${notes.join(', ')} → ${entries.length} contributed (${already} already served${held.length > 0 ? `, ${held.map((entry) => `${entry.id}:${entry.reason}`).join(', ')}` : ''}) in ${Date.now() - started}ms`)
      if (cfg.verbose) log(`contributed: ${entries.map((entry) => `${entry.id}[${entry.api}]`).join(', ') || '(none)'}`, 'debug')
    })().catch((error) => {
      log(`refresh failed: ${error?.stack ?? error}`, 'warn')
    }).finally(() => {
      running = undefined
    })
    return running
  }

  /** Load pi-ai, adopt the cache, and start refreshing. */
  const bootstrap = async () => {
    const { core, all, resolution } = await importPiAi()
    catalog = await loadShippedCatalog(cfg.provider)
    const shipped = shippedEntries(catalog)
    log(`route "${cfg.provider}" resolved against the installed catalog: ${shipped.length} shipped models, pi-ai reached ${resolution.core.via} (${resolution.core.url ?? 'unknown url'})`)

    const cached = readCatalogCache(cfg.cachePath, cfg.provider)
    if (cached !== undefined) {
      const written = publish(cached.entries)
      state.entries = [...state.entries, ...cached.entries.filter((entry) => written.includes(entry.id))]
      log(`${written.length} models adopted from the cache (fetched ${cached.fetchedAt ?? 'at an unknown time'})`)
    }

    if (cfg.patchCollection) {
      const patch = installLiveCollection(core, (provider, collection) => matchingEntries(provider, collection, cfg.provider, currentEntries()))
      livePatch = patch.dispose
      if (!patch.supported) log('the installed pi-ai model collection has no getModels to extend; a refresh will need a restart to be seen', 'warn')
    }

    // Prove the contribution landed where the adapter reads, rather than
    // trusting that two bare specifiers resolved to one module instance.
    if (state.ids.length > 0) {
      try {
        const present = new Set(all.getBuiltinModels(cfg.provider).map((model) => model.id))
        const missing = state.ids.filter((id) => !present.has(id))
        if (missing.length > 0) log(`${missing.length} contributed models are not visible in the installed catalog (${missing.join(', ')}); the adapter may be reading a different pi-ai instance`, 'warn')
      } catch (error) {
        log(`could not verify the contribution against getBuiltinModels: ${error?.message ?? error}`, 'warn')
      }
    }

    if (cfg.refreshIntervalMs > 0) {
      timer = setInterval(() => { void refresh() }, cfg.refreshIntervalMs)
      timer.unref?.()
    }
    if (cfg.offline) {
      log('offline mode: the cache is authoritative and no request is sent')
      return
    }
    await refresh()
  }

  const unmount = () => {
    if (state.disposed) return
    state.disposed = true
    if (timer !== undefined) clearInterval(timer)
    livePatch?.()
    if (catalog !== undefined && state.ids.length > 0) {
      const removed = withdraw(catalog, state.ids)
      if (removed.length > 0) log(`withdrew ${removed.length} contributed models`)
    }
  }
  ctx.effect(() => unmount, `${LOG_PREFIX}: restore the shipped catalog and the model collection`)

  const ready = bootstrap().catch((error) => {
    log(`mount failed, serving the shipped catalog unchanged: ${error?.stack ?? error}`, 'warn')
  })
  log(`mounted: route=${cfg.provider} gateway=${cfg.gatewayUrl || '(off)'} catalog=${cfg.catalogUrl || '(off)'} refresh=${cfg.refreshIntervalMs > 0 ? `${Math.round(cfg.refreshIntervalMs / 60000)}min` : 'startup only'} cache=${cfg.cachePath}`)
  return { ready, unmount, state, config: cfg }
}

/**
 * Cordis entry point: mount, and let the work proceed in the background.
 * @param ctx - the cordis context.
 * @param config - the row's configuration.
 */
export function apply(ctx, config = {}) {
  mount(ctx, config)
}

export default { name, inject, apply }
