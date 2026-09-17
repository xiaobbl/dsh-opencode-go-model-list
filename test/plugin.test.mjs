/**
 * End-to-end: one plugin mount, from configuration to the adapter's own view.
 *
 * The upstreams are served from the captured fixtures through a stubbed
 * \`globalThis.fetch\`, so nothing here touches the network. Everything else is
 * real: the real pi-ai module, the real shipped catalog, the real model
 * collection, and the plugin's own configuration, cache, and refresh wiring.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mount } from '../lib/index.js'
import { importPiAi, loadShippedCatalog, shippedEntries } from '../lib/pi-ai.js'
import { gatewayFixture, metadataFixture } from './helpers.mjs'

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

const piAi = await importPiAi().catch(() => undefined)
const skip = piAi === undefined ? 'no pi-ai installation is reachable from this process' : false

const GATEWAY = 'https://gateway.test/zen/go/v1/models'
const CATALOG = 'https://catalog.test/api.json'

/** A context with just enough cordis surface for one mount. */
function fakeContext() {
  const messages = []
  const disposers = []
  const record = (level) => (message) => messages.push(`${level}: ${message}`)
  return {
    messages,
    logger: { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') },
    effect(callback) {
      disposers.push(callback())
    },
    unmountAll() {
      while (disposers.length > 0) disposers.pop()()
    },
  }
}

/** Serve the fixtures from the two upstream URLs, and count the calls. */
function stubUpstreams({ fail = false } = {}) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    if (fail) throw new Error('network disabled by the test')
    const body = String(url) === GATEWAY ? gatewayFixture() : metadataFixture()
    return { ok: true, status: 200, json: async () => body }
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

/** Run one mount to completion against a temporary cache. */
async function withMount(config, run) {
  const dir = mkdtempSync(join(tmpdir(), 'opencode-go-model-list-'))
  const ctx = fakeContext()
  const stderr = console.error
  console.error = () => {}
  try {
    const handle = mount(ctx, { gatewayUrl: GATEWAY, catalogUrl: CATALOG, cachePath: join(dir, 'catalog.json'), refreshIntervalMs: 0, ...config })
    await handle.ready
    return await run({ handle, ctx, dir })
  } finally {
    console.error = stderr
    ctx.unmountAll()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('one mount contributes the served models to the catalog the adapter reads', { skip }, async () => {
  const catalog = await loadShippedCatalog('opencode-go')
  const shipped = shippedEntries(catalog).map((entry) => entry.id)
  const upstreams = stubUpstreams()
  try {
    await withMount({}, async ({ handle, ctx }) => {
      const added = handle.state.ids
      assert.ok(added.includes('deepseek-v4.1-flash'), 'the model this plugin exists for is contributed')
      assert.ok(added.includes('grok-4.5') && added.includes('kimi-k2.5'), 'every served model the snapshot missed is contributed')
      assert.ok(!added.includes('kimi-k3'), 'a model the snapshot already ships is left to the catalog')
      assert.ok(added.every((id) => !shipped.includes(id)), 'nothing the catalog already ships is touched')

      const visible = piAi.all.getBuiltinModels('opencode-go').map((entry) => entry.id)
      for (const id of added) assert.ok(visible.includes(id), `${id} is not visible through getBuiltinModels`)

      const entry = catalog['deepseek-v4.1-flash']
      assert.equal(entry.api, 'openai-completions')
      assert.equal(entry.baseUrl, 'https://opencode.ai/zen/go/v1')
      assert.equal(entry.contextWindow, 1000000)
      assert.deepEqual(entry.cost, { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 })
      assert.deepEqual(entry.compat, {
        supportsStore: false,
        supportsDeveloperRole: false,
        maxTokensField: 'max_tokens',
        requiresReasoningContentOnAssistantMessages: true,
        thinkingFormat: 'deepseek',
      })
      assert.ok(ctx.messages.some((message) => message.includes('contributed')), 'the mount reports what it contributed')
    })
    assert.deepEqual(shippedEntries(catalog).map((entry) => entry.id), shipped, 'unmounting restores the shipped catalog')
    assert.equal(catalog['deepseek-v4.1-flash'], undefined)
  } finally {
    upstreams.restore()
  }
})

test('the contribution reaches a model collection the route already resolved', { skip }, async () => {
  const catalog = await loadShippedCatalog('opencode-go')
  const shipped = shippedEntries(catalog)
  // A collection built from the *shipped* entries before the plugin mounted —
  // exactly what the adapter holds when a route resolved first, which is the
  // case a restart-only catalog would lose.
  const provider = piAi.core.createProvider({ id: 'opencode-go', name: 'OpenCode Go', models: shipped, api: { stream: () => ({}) } })
  const collection = piAi.core.createModels({})
  collection.setProvider(provider)
  assert.equal(collection.getModels('opencode-go').length, shipped.length)
  assert.equal(collection.getModel('opencode-go', 'deepseek-v4.1-flash'), undefined)

  const upstreams = stubUpstreams()
  try {
    await withMount({}, async ({ handle }) => {
      assert.ok(handle.state.ids.includes('deepseek-v4.1-flash'))
      const models = collection.getModels('opencode-go')
      assert.ok(models.some((entry) => entry.id === 'deepseek-v4.1-flash'), 'the memoized route sees the contribution')
      assert.equal(collection.getModel('opencode-go', 'deepseek-v4.1-flash').id, 'deepseek-v4.1-flash')
      assert.equal(models.length, shipped.length + handle.state.ids.length)
      assert.equal(collection.getModels('deepseek').length, 0, 'other routes are untouched')
    })
    assert.equal(collection.getModels('opencode-go').length, shipped.length, 'unmounting restores the collection')
  } finally {
    upstreams.restore()
  }
})

test('the fetch is cached, and an offline mount adopts it without a request', { skip }, async () => {
  let cachePath
  const upstreams = stubUpstreams()
  try {
    await withMount({}, async ({ ctx, dir }) => {
      cachePath = join(mkdtempSync(join(tmpdir(), 'opencode-go-model-list-keep-')), 'catalog.json')
      copyFileSync(join(dir, 'catalog.json'), cachePath)
      assert.ok(existsSync(cachePath), 'the successful fetch is written to the cache')
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
      assert.equal(cached.version, 1)
      assert.equal(cached.provider, 'opencode-go')
      assert.ok(cached.entries.some((entry) => entry.id === 'deepseek-v4.1-flash'))
      assert.ok(ctx.messages.some((message) => message.includes('mounted')))
    })
  } finally {
    upstreams.restore()
  }

  const offline = stubUpstreams({ fail: true })
  try {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-go-model-list-cache-'))
    copyFileSync(cachePath, join(dir, 'catalog.json'))
    const ctx = fakeContext()
    const handle = mount(ctx, { gatewayUrl: GATEWAY, catalogUrl: CATALOG, cachePath: join(dir, 'catalog.json'), offline: true, refreshIntervalMs: 0 })
    const stderr = console.error
    console.error = () => {}
    try {
      await handle.ready
      assert.ok(handle.state.ids.includes('deepseek-v4.1-flash'), 'the cache is served')
      assert.deepEqual(offline.calls, [], 'offline mode sends no request')
      assert.ok(ctx.messages.some((message) => message.includes('offline')))
    } finally {
      console.error = stderr
      ctx.unmountAll()
      rmSync(dir, { recursive: true, force: true })
    }
  } finally {
    offline.restore()
  }
})

test('a failed refresh keeps the shipped catalog intact', { skip }, async () => {
  const catalog = await loadShippedCatalog('opencode-go')
  const before = Object.keys(catalog).length
  const upstreams = stubUpstreams({ fail: true })
  try {
    await withMount({}, async ({ handle, ctx }) => {
      assert.equal(handle.state.ids.length, 0)
      assert.equal(Object.keys(catalog).length, before)
      assert.ok(ctx.messages.some((message) => message.includes('refresh found nothing')), 'the failure is reported')
    })
  } finally {
    upstreams.restore()
  }
})
