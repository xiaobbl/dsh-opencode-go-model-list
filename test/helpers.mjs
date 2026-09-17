/**
 * Shared fixture access for the test suite.
 *
 * Fixtures are captured upstream payloads, recorded once so the tests describe
 * the mapper's behaviour without a network call: `models.dev`'s opencode-go
 * slice, and the plan's own served-model listing.
 *
 * @module dsh-opencode-go-model-list/test/helpers
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/** Read one JSON fixture. */
export function fixture(name) {
  return JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'))
}

/** The captured `models.dev/api.json` slice for opencode-go. */
export function metadataFixture() {
  return fixture('models.dev.opencode-go.json')
}

/** The captured served-model listing. */
export function gatewayFixture() {
  return fixture('opencode-go.gateway.json')
}

/** A shipped-catalog-shaped entry, so tests can describe a route without pi-ai. */
export function shippedEntry(overrides = {}) {
  return {
    id: 'vendor-old',
    name: 'Vendor Old',
    api: 'openai-completions',
    provider: 'opencode-go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    reasoning: true,
    input: ['text'],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
    compat: { supportsStore: false, maxTokensField: 'max_tokens' },
    contextWindow: 262144,
    maxTokens: 65536,
    ...overrides,
  }
}
