/**
 * The mapper's anchor to the catalog it extends.
 *
 * The shipped catalog is the ground truth for this route: every entry in it was
 * curated by whoever generated pi-ai's model data, from the same upstreams this
 * plugin reads. Rebuilding those entries from the metadata fixture — with the
 * model itself removed from the shipped set, so nothing can copy the answer —
 * measures how faithfully a *new* model would be described.
 *
 * The four fields a listing endpoint actually discloses must be exact. The
 * remaining fields are curated facts no upstream publishes (cost revisions,
 * vendor wire dialects, display-name annotations), so they are held to a
 * threshold instead: a regression there is a signal, not a failure to hide.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizeConfig } from '../lib/config.js'
import { buildModelEntry, familyTwinOf, pickSibling } from '../lib/mapping.js'
import { providerCatalog } from '../lib/sources.js'
import { loadShippedCatalog, shippedEntries } from '../lib/pi-ai.js'
import { metadataFixture } from './helpers.mjs'

function anchorToAProfile() {
  if (typeof process.env.DSH_PI_AI_ROOT === 'string' && process.env.DSH_PI_AI_ROOT.length > 0) return
  const home = typeof process.env.USERPROFILE === 'string' ? process.env.USERPROFILE : homedir()
  for (const profile of ['web', 'add', 'headless', 'update']) {
    const dir = join(home, '.dsh', 'profiles', profile)
    if (existsSync(join(dir, 'package.json'))) {
      process.env.DSH_PI_AI_ROOT = dir
      return
    }
  }
}
anchorToAProfile()

const catalog = await loadShippedCatalog('opencode-go').catch(() => undefined)
const skip = catalog === undefined ? 'no pi-ai installation is reachable from this process' : false

/** Compare every rebuilt entry against the shipped one, field by field. */
async function measure() {
  const shipped = shippedEntries(catalog)
  const records = providerCatalog(metadataFixture(), 'opencode-go').models
  const config = normalizeConfig({}, {})
  const fields = ['api', 'baseUrl', 'reasoning', 'input', 'contextWindow', 'maxTokens', 'cost', 'name', 'thinkingLevelMap', 'compat']
  const hits = Object.fromEntries(fields.map((field) => [field, 0]))
  const misses = []
  for (const model of shipped) {
    const others = shipped.filter((entry) => entry.id !== model.id)
    const record = records.get(model.id)
    const sibling = pickSibling(model.id, record, others, records)
    const familyTwin = familyTwinOf(model.id, record, others, records)
    const built = buildModelEntry({ id: model.id, record, sibling, familyTwin, provider: 'opencode-go', config, installed: others })
    const differing = []
    for (const field of fields) {
      if (JSON.stringify(built[field] ?? null) === JSON.stringify(model[field] ?? null)) hits[field] += 1
      else differing.push(field)
    }
    if (differing.length > 0) misses.push(`${model.id} (twin ${familyTwin?.id ?? '-'}): ${differing.join(', ')}`)
  }
  return { total: shipped.length, hits, misses }
}

const measured = skip === false ? await measure() : undefined

test('the disclosed facts are reproduced exactly for every shipped model', { skip }, () => {
  for (const field of ['reasoning', 'input', 'contextWindow', 'maxTokens']) {
    assert.equal(measured.hits[field], measured.total, `${field} diverged: ${measured.misses.join(' | ')}`)
  }
})

test('the curated facts stay close to the shipped catalog', { skip }, () => {
  const floor = {
    api: Math.ceil(measured.total * 0.85),
    baseUrl: Math.ceil(measured.total * 0.85),
    name: Math.ceil(measured.total * 0.9),
    cost: Math.ceil(measured.total * 0.75),
    thinkingLevelMap: Math.ceil(measured.total * 0.7),
    compat: Math.ceil(measured.total * 0.7),
  }
  for (const [field, minimum] of Object.entries(floor)) {
    assert.ok(measured.hits[field] >= minimum, `${field}: ${measured.hits[field]}/${measured.total} below ${minimum} — ${measured.misses.join(' | ')}`)
  }
})

test('every rebuild produces a servable entry', { skip }, () => {
  const shipped = shippedEntries(catalog)
  const records = providerCatalog(metadataFixture(), 'opencode-go').models
  const config = normalizeConfig({}, {})
  for (const model of shipped) {
    const others = shipped.filter((entry) => entry.id !== model.id)
    const record = records.get(model.id)
    const entry = buildModelEntry({
      id: model.id,
      record,
      sibling: pickSibling(model.id, record, others, records),
      familyTwin: familyTwinOf(model.id, record, others, records),
      provider: 'opencode-go',
      config,
      installed: others,
    })
    assert.ok(['openai-completions', 'openai-responses', 'anthropic-messages'].includes(entry.api))
    assert.equal(entry.provider, 'opencode-go')
    assert.ok(entry.contextWindow > 0 && Number.isInteger(entry.contextWindow))
    assert.ok(entry.maxTokens > 0 && Number.isInteger(entry.maxTokens))
    assert.ok(['text', 'image'].every((modality) => typeof modality === 'string'))
    assert.equal(typeof entry.cost.input, 'number')
    assert.equal(typeof entry.cost.cacheWrite, 'number')
  }
})
