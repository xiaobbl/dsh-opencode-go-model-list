import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig } from '../lib/config.js'
import { providerCatalog } from '../lib/sources.js'
import {
  baselineCompat,
  buildModelEntries,
  buildModelEntry,
  commonPrefixLength,
  familyTwinOf,
  pickSibling,
  thinkingLevelMapOf,
  titleize,
  vendorMajorityApi,
  vendorToken,
} from '../lib/mapping.js'
import { metadataFixture, shippedEntry } from './helpers.mjs'

const CONFIG = normalizeConfig({}, {})
const RECORDS = providerCatalog(metadataFixture(), 'opencode-go').models

const COMPLETIONS_BASELINE = { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' }
const DEEPSEEK_DIALECT = { ...COMPLETIONS_BASELINE, requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' }

/** A stand-in route: two deepseek-family models, one glm, one anthropic model. */
const INSTALLED = [
  shippedEntry({
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 },
    compat: { ...DEEPSEEK_DIALECT },
    contextWindow: 1000000,
    maxTokens: 384000,
    thinkingLevelMap: { minimal: null, low: 'low', medium: null, high: 'high', max: 'max' },
  }),
  shippedEntry({
    id: 'glm-5.3',
    name: 'GLM-5.3',
    reasoning: true,
    cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
    compat: { ...COMPLETIONS_BASELINE },
    contextWindow: 1000000,
    maxTokens: 131072,
  }),
  shippedEntry({
    id: 'minimax-m3',
    name: 'MiniMax-M3',
    api: 'anthropic-messages',
    baseUrl: 'https://opencode.ai/zen/go',
    input: ['text', 'image'],
    reasoning: true,
    cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
    compat: undefined,
    contextWindow: 1000000,
    maxTokens: 131072,
  }),
]

/** Build one entry the way the plugin does, resolving both templates first. */
function entryFor(id, installed = INSTALLED) {
  const record = RECORDS.get(id)
  return buildModelEntry({
    id,
    record,
    sibling: pickSibling(id, record, installed, RECORDS),
    familyTwin: familyTwinOf(id, record, installed, RECORDS),
    provider: 'opencode-go',
    config: CONFIG,
    installed,
  })
}

test('id helpers read vendor, prefix, and display name', () => {
  assert.equal(vendorToken('deepseek-v4.1-flash'), 'deepseek')
  assert.equal(vendorToken('kimi-k2.5'), 'kimi')
  assert.equal(commonPrefixLength('minimax-m2.5', 'minimax-m2.7'), 11)
  assert.equal(commonPrefixLength('union-alpha', 'unrelated'), 2)
  assert.equal(titleize('hy3-preview'), 'Hy3 Preview')
  assert.equal(titleize('deepseek-v4.1-flash'), 'DeepSeek V4.1 Flash')
  assert.equal(titleize('mimo-v2.5-pro'), 'MiMo V2.5 Pro')
})

test('a same-family entry is the template, found by upstream family', () => {
  const record = RECORDS.get('deepseek-v4.1-flash')
  assert.equal(record.family, 'deepseek-flash')
  assert.equal(familyTwinOf('deepseek-v4.1-flash', record, INSTALLED, RECORDS).id, 'deepseek-v4-flash')
  assert.equal(pickSibling('deepseek-v4.1-flash', record, INSTALLED, RECORDS).id, 'deepseek-v4-flash')
})

test('without a same-family entry the nearest shipped id wins, then the vendor', () => {
  assert.equal(familyTwinOf('glm-5', RECORDS.get('glm-5'), INSTALLED, RECORDS).id, 'glm-5.3')
  assert.equal(pickSibling('deepseek-flash', undefined, INSTALLED, RECORDS).id, 'deepseek-v4-flash')
  assert.equal(pickSibling('union-alpha', undefined, INSTALLED, RECORDS).id, 'deepseek-v4-flash')
  assert.equal(pickSibling('anything', undefined, [], RECORDS), undefined)
})

test('the route baseline is what every shipped model of a protocol agrees on', () => {
  assert.deepEqual(baselineCompat(INSTALLED, 'openai-completions'), COMPLETIONS_BASELINE)
  assert.equal(baselineCompat(INSTALLED, 'anthropic-messages'), undefined)
  assert.equal(baselineCompat([], 'openai-completions'), undefined)
})

test('the vendor majority decides the protocol for an unbranded new id', () => {
  assert.equal(vendorMajorityApi('minimax-m2.5', INSTALLED), 'anthropic-messages')
  assert.equal(vendorMajorityApi('glm-6', INSTALLED), 'openai-completions')
  assert.equal(vendorMajorityApi('union-alpha', INSTALLED), undefined)
})

test('a new model inherits the wire facts and takes the live metadata', () => {
  const entry = entryFor('deepseek-v4.1-flash')
  assert.equal(entry.api, 'openai-completions')
  assert.equal(entry.provider, 'opencode-go')
  assert.equal(entry.baseUrl, 'https://opencode.ai/zen/go/v1')
  assert.deepEqual(entry.compat, DEEPSEEK_DIALECT)
  assert.equal(entry.name, 'DeepSeek V4.1 Flash')
  assert.equal(entry.contextWindow, 1000000)
  assert.equal(entry.maxTokens, 384000)
  assert.deepEqual(entry.input, ['text', 'image'])
  assert.deepEqual(entry.cost, { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 })
  assert.equal(entry.reasoning, true)
  assert.deepEqual(entry.thinkingLevelMap, { minimal: null, low: 'low', medium: null, high: 'high', max: 'max' })
})

test('the provider-declared SDK decides a protocol no sibling can', () => {
  const entry = entryFor('union-alpha')
  assert.equal(entry.api, 'anthropic-messages')
  assert.equal(entry.baseUrl, 'https://opencode.ai/zen/go')
  assert.equal(entry.compat, undefined)
  assert.deepEqual(entry.input, ['text', 'image'])
})

test('a vendor with no shipped model gets the route baseline and pinned levels', () => {
  const entry = entryFor('omen-alpha')
  assert.equal(entry.api, 'openai-completions')
  assert.deepEqual(entry.compat, COMPLETIONS_BASELINE)
  assert.deepEqual(entry.thinkingLevelMap, { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: null })
})

test('a model no catalog describes still gets a usable entry', () => {
  const entry = entryFor('hy3-preview')
  assert.equal(entry.name, 'Hy3 Preview')
  assert.equal(entry.api, 'openai-completions')
  assert.equal(entry.contextWindow, 1000000)
  assert.equal(entry.maxTokens, 384000)
  assert.deepEqual(entry.cost, INSTALLED[0].cost)
  assert.deepEqual(entry.compat, COMPLETIONS_BASELINE)
})

test('thinking levels follow the declared efforts and the vendor spelling', () => {
  const template = INSTALLED[0].thinkingLevelMap
  assert.deepEqual(
    thinkingLevelMapOf({ reasoningOptions: [{ type: 'effort', values: ['low', 'high', 'max'] }] }, template),
    { minimal: null, low: 'low', medium: null, high: 'high', max: 'max' },
  )
  assert.deepEqual(
    thinkingLevelMapOf({ reasoningOptions: [{ type: 'effort', values: ['none', 'low', 'high'] }] }, undefined),
    { off: 'none', minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: null },
  )
  assert.deepEqual(thinkingLevelMapOf({ reasoningOptions: [{ type: 'toggle' }] }, template), template)
  assert.equal(thinkingLevelMapOf({ reasoningOptions: [] }, undefined), undefined)
  assert.equal(thinkingLevelMapOf({ reasoningOptions: [{ type: 'effort', values: ['low'] }] }, { off: null }).off, null)
  assert.equal(thinkingLevelMapOf({ reasoningOptions: [] }, undefined, null), undefined)
  assert.deepEqual(thinkingLevelMapOf({ reasoningOptions: [] }, undefined, { low: 'low' }), { low: 'low' })
})

test('a model the route already serves is left exactly as shipped', () => {
  const { entries, skipped } = buildModelEntries({
    provider: 'opencode-go',
    installed: INSTALLED,
    records: RECORDS,
    servedIds: ['deepseek-v4-flash', 'deepseek-v4.1-flash'],
    config: CONFIG,
  })
  assert.deepEqual(entries.map((entry) => entry.id), ['deepseek-v4.1-flash'])
  assert.deepEqual(skipped, [{ id: 'deepseek-v4-flash', reason: 'already-served' }])
})

test('updateExisting rewrites a shipped entry without losing its protocol', () => {
  const config = normalizeConfig({ updateExisting: true }, {})
  const { entries } = buildModelEntries({
    provider: 'opencode-go',
    installed: INSTALLED,
    records: RECORDS,
    servedIds: ['glm-5.3'],
    config,
  })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'glm-5.3')
  assert.equal(entries[0].api, 'openai-completions')
  assert.deepEqual(entries[0].compat, COMPLETIONS_BASELINE)
  assert.equal(entries[0].contextWindow, RECORDS.get('glm-5.3').limit.context)
  assert.equal(entries[0].name, 'GLM-5.3')
})

test('deprecated models can be filtered, skipped models can be named', () => {
  const config = normalizeConfig({ includeDeprecated: false, models: { 'kimi-k2.5': { skip: true } } }, {})
  const { entries, skipped } = buildModelEntries({
    provider: 'opencode-go',
    installed: INSTALLED,
    records: RECORDS,
    servedIds: ['glm-5', 'kimi-k2.5', 'kimi-k3'],
    config,
  })
  assert.deepEqual(entries.map((entry) => entry.id), ['kimi-k3'])
  assert.deepEqual(skipped, [
    { id: 'glm-5', reason: 'deprecated' },
    { id: 'kimi-k2.5', reason: 'skip' },
  ])
})

test('without a served listing the metadata catalog decides membership', () => {
  const { entries } = buildModelEntries({
    provider: 'opencode-go',
    installed: INSTALLED,
    records: RECORDS,
    servedIds: [],
    config: CONFIG,
  })
  assert.equal(entries.length, RECORDS.size - INSTALLED.length)
  assert.ok(entries.every((entry) => entry.api !== undefined && entry.id.length > 0))
})

test('extra ids are appended after the served ones and per-model overrides win', () => {
  const config = normalizeConfig({
    extraModelIds: ['local-note'],
    models: { 'kimi-k3': { name: 'Kimi K3 (plan)', contextWindow: 123456 } },
  }, {})
  const { entries } = buildModelEntries({
    provider: 'opencode-go',
    installed: INSTALLED,
    records: RECORDS,
    servedIds: ['kimi-k3'],
    config,
  })
  const kimi = entries.find((entry) => entry.id === 'kimi-k3')
  const local = entries.find((entry) => entry.id === 'local-note')
  assert.equal(kimi.name, 'Kimi K3 (plan)')
  assert.equal(kimi.contextWindow, 123456)
  assert.equal(local.name, 'Local Note')
  assert.equal(local.api, 'openai-completions')
})
