/**
 * The on-disk memory of the last successful fetch.
 *
 * Its only job is to make a restart instant: the plugin mounts, reads the file
 * synchronously, and contributes those models before the first request reaches
 * a model picker. The network refresh that follows then corrects the file.
 *
 * A cache is an optimization, never a requirement: an unreadable, outdated, or
 * partially written file is simply ignored.
 *
 * @module dsh-opencode-go-model-list/cache
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Bumped when the on-disk shape changes; other versions are ignored. */
export const CACHE_VERSION = 1

/** One entry is readable when it carries an id and a protocol. */
function usableEntry(entry) {
  return typeof entry === 'object' && entry !== null
    && typeof entry.id === 'string' && entry.id.length > 0
    && typeof entry.api === 'string' && entry.api.length > 0
}

/** A cached entry must also name the same provider route it was built for. */
function usableEntryFor(entry, provider) {
  return usableEntry(entry) && (entry.provider === undefined || entry.provider === provider)
}

/**
 * Read the cached catalog.
 * @param path - cache file path.
 * @param provider - provider route the entries must belong to.
 * @returns the cached payload, or `undefined` when there is nothing usable.
 */
export function readCatalogCache(path, provider) {
  if (typeof path !== 'string' || path.length === 0) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed?.version !== CACHE_VERSION) return undefined
    if (parsed.provider !== undefined && parsed.provider !== provider) return undefined
    if (!Array.isArray(parsed.entries)) return undefined
    const entries = parsed.entries.filter((entry) => usableEntryFor(entry, provider))
    if (entries.length === 0) return undefined
    return { fetchedAt: typeof parsed.fetchedAt === 'string' ? parsed.fetchedAt : undefined, entries, sources: parsed.sources }
  } catch {
    return undefined
  }
}

/**
 * Write the catalog cache through a temporary file, so a reader never sees a
 * half-written document.
 * @param path - cache file path.
 * @param payload - entries, fetch timestamp, and the source summary.
 * @throws Error from the filesystem; callers treat a failed write as a warning.
 */
export function writeCatalogCache(path, payload) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.tmp-${process.pid}-${Date.now()}`)
  writeFileSync(temporary, `${JSON.stringify({ version: CACHE_VERSION, ...payload }, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}
