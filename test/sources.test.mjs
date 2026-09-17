import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apiFromNpm, effortValues, gatewayModelIds, providerCatalog } from '../lib/sources.js'
import { gatewayFixture, metadataFixture } from './helpers.mjs'

test('gatewayModelIds reads the OpenAI listing shape', () => {
  assert.deepEqual(
    gatewayModelIds({ object: 'list', data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] }),
    ['a', 'b'],
  )
})

test('gatewayModelIds reads the enriched map shape and bare lists', () => {
  assert.deepEqual(gatewayModelIds({ models: { x: {}, y: { id: 'y' } } }), ['x', 'y'])
  assert.deepEqual(gatewayModelIds({ models: ['p', { name: 'q' }] }), ['p', 'q'])
  assert.deepEqual(gatewayModelIds(['r', { id: 's' }]), ['r', 's'])
})

test('gatewayModelIds ignores shapes it cannot read', () => {
  assert.deepEqual(gatewayModelIds(null), [])
  assert.deepEqual(gatewayModelIds({ object: 'list' }), [])
  assert.deepEqual(gatewayModelIds({ data: [{ id: '' }, { nope: 1 }, 7] }), [])
})

test('providerCatalog narrows the document to one provider', () => {
  const { provider, models } = providerCatalog(metadataFixture(), 'opencode-go')
  assert.equal(provider.name, 'OpenCode Go')
  assert.equal(provider.api, 'https://opencode.ai/zen/go/v1')
  assert.ok(models.size > 20)
  const flash = models.get('deepseek-v4-flash')
  assert.equal(flash.api ?? flash.npm, undefined)
  assert.equal(flash.reasoning, true)
  assert.equal(flash.limit.context, 1000000)
})

test('providerCatalog answers empty for a provider the catalog does not describe', () => {
  assert.deepEqual(providerCatalog({}, 'nope').models.size, 0)
  assert.deepEqual(providerCatalog(null, 'opencode-go'), { provider: undefined, models: new Map() })
})

test('effortValues reads only the effort option', () => {
  assert.deepEqual(effortValues({ reasoningOptions: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'high'] }] }), ['low', 'high'])
  assert.deepEqual(effortValues({ reasoningOptions: [{ type: 'toggle' }] }), [])
  assert.deepEqual(effortValues(undefined), [])
})

test('apiFromNpm maps the provider SDKs this route uses', () => {
  assert.equal(apiFromNpm({ npm: '@ai-sdk/anthropic' }), 'anthropic-messages')
  assert.equal(apiFromNpm({ npm: '@ai-sdk/openai' }), 'openai-responses')
  assert.equal(apiFromNpm({ npm: '@ai-sdk/openai-compatible' }), 'openai-completions')
  assert.equal(apiFromNpm({}), undefined)
})

test('the captured gateway listing and metadata agree on the served set', () => {
  const served = gatewayModelIds(gatewayFixture())
  const { models } = providerCatalog(metadataFixture(), 'opencode-go')
  const undescribed = served.filter((id) => !models.has(id))
  // deepseek-flash and hy3-preview are served before the catalog describes them,
  // which is exactly the case the sibling fallback exists for.
  assert.deepEqual(undescribed, ['deepseek-flash', 'hy3-preview'])
})
