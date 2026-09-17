/**
 * Integration against the pi-ai installation the harness actually serves from.
 *
 * These are the assertions that decide whether a contribution is *seamless*:
 * the adapter resolves a route's models through `getBuiltinModels`, and reads
 * the model collection through `getModels`. Both are exercised here against the
 * real module, and the whole file skips when no installation is reachable.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  CONTRIBUTED,
  contribute,
  importPiAi,
  importPiAiModule,
  installLiveCollection,
  loadShippedCatalog,
  shippedEntries,
  withdraw,
} from '../lib/pi-ai.js'

/** Point the plugin's installation fallback at a profile when this process has none. */
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

/** The installation, or \`undefined\` when this process cannot reach one. */
const piAi = await importPiAi().catch(() => undefined)
const provider = 'opencode-go'
const skip = piAi === undefined ? 'no pi-ai installation is reachable from this process' : false

/** A contribution shaped like the mapper's output. */
function fakeModel(id) {
  return {
    id,
    name: 'Fake Model',
    api: 'openai-completions',
    provider,
    baseUrl: 'https://opencode.ai/zen/go/v1',
    reasoning: true,
    input: ['text'],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  }
}

test('the catalog module resolves through the installation when the profile cannot', { skip }, async () => {
  const core = await importPiAiModule('@earendil-works/pi-ai')
  assert.equal(typeof core.module.createModels, 'function')
  assert.ok(['profile', 'installation'].includes(core.via))
})

test('a contributed model becomes a catalog model the adapter can read', { skip }, async () => {
  const catalog = await loadShippedCatalog(provider)
  const before = Object.keys(catalog).length
  const entry = fakeModel('dsh-test-contributed')
  assert.deepEqual(contribute(catalog, [entry]), ['dsh-test-contributed'])
  assert.equal(catalog['dsh-test-contributed'], entry)
  const read = piAi.all.getBuiltinModels(provider)
  assert.ok(read.some((model) => model.id === 'dsh-test-contributed'), 'getBuiltinModels is what the adapter resolves routes through')
  assert.deepEqual(withdraw(catalog), ['dsh-test-contributed'])
  assert.equal(Object.keys(catalog).length, before)
  assert.ok(!piAi.all.getBuiltinModels(provider).some((model) => model.id === 'dsh-test-contributed'))
})

test('a shipped entry is never overwritten unless asked', { skip }, async () => {
  const catalog = await loadShippedCatalog(provider)
  const shipped = shippedEntries(catalog)
  assert.ok(shipped.length > 0)
  const victim = shipped[0]
  const replacement = fakeModel(victim.id)
  assert.deepEqual(contribute(catalog, [replacement]), [])
  assert.equal(catalog[victim.id], victim)
  assert.deepEqual(contribute(catalog, [replacement], { updateExisting: true }), [victim.id])
  assert.equal(catalog[victim.id].name, 'Fake Model')
  withdraw(catalog, [victim.id])
  assert.equal(catalog[victim.id], undefined)
})

test('contributed entries carry a marker that never reaches the wire', { skip }, async () => {
  const catalog = await loadShippedCatalog(provider)
  const entry = fakeModel('dsh-test-marker')
  contribute(catalog, [entry])
  assert.notEqual(entry[CONTRIBUTED], undefined)
  assert.equal(Object.keys(entry).includes(String(CONTRIBUTED)), false)
  assert.equal(JSON.parse(JSON.stringify(entry)).id, 'dsh-test-marker')
  withdraw(catalog, ['dsh-test-marker'])
})

test('the model collection lists and resolves a contribution made after it was built', { skip }, async () => {
  const catalog = await loadShippedCatalog(provider)
  const shipped = shippedEntries(catalog)
  const providerObject = piAi.core.createProvider({
    id: provider,
    name: 'OpenCode Go',
    models: shipped,
    api: { stream: () => ({}) },
  })
  const collection = piAi.core.createModels({})
  collection.setProvider(providerObject)
  assert.ok(!collection.getModels(provider).some((model) => model.id === 'dsh-test-live'))

  let contributed = []
  const patch = installLiveCollection(piAi.core, (requested, owner) => {
    if (requested !== undefined && requested !== provider) return []
    if (requested === undefined && owner?.providers?.has?.(provider) !== true) return []
    return contributed
  })
  assert.equal(patch.supported, true)
  assert.ok(!collection.getModels(provider).some((model) => model.id === 'dsh-test-live'))

  contributed = [fakeModel('dsh-test-live')]
  const models = collection.getModels(provider)
  assert.ok(models.some((model) => model.id === 'dsh-test-live'))
  assert.equal(collection.getModel(provider, 'dsh-test-live').id, 'dsh-test-live')
  assert.equal(models.length, shipped.length + 1, 'the shipped answer is extended, never replaced')
  assert.ok(collection.getModels('deepseek').length === 0, 'other routes are untouched')

  patch.dispose()
  assert.ok(!collection.getModels(provider).some((model) => model.id === 'dsh-test-live'))
  assert.ok(!Object.getPrototypeOf(collection).getModels.toString().includes('live.producers'))
})
