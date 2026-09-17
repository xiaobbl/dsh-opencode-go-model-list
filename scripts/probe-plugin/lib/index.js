/**
 * Verification probe: resolve EVERY model of the route the way the browser
 * catalog builder does, so one failing model shows up as a named failure
 * instead of an entire provider group disappearing behind one error entry.
 */
export const name = 'model-list-probe'
export const inject = ['llm']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function apply(ctx) {
  const print = (...args) => console.error('[probe]', ...args)
  void (async () => {
    const deadline = Date.now() + Number(process.env.PROBE_DEADLINE_MS ?? 60_000)
    let models = []
    let waited = 0
    while (Date.now() < deadline) {
      try {
        models = await ctx.llm.listModels('opencode-go')
        if (models.length > 27) break
      } catch (error) {
        if (waited === 0) print('waiting for the route:', error?.message ?? error)
      }
      waited += 1
      await sleep(500)
    }
    print('count', models.length)
    const failures = []
    for (const model of models) {
      try {
        const info = await ctx.llm.resolveModelInfo('opencode-go', model.id)
        if (info.id !== model.id) failures.push(model.id + ': id mismatch')
      } catch (error) {
        failures.push(model.id + ': ' + (error?.message ?? error))
      }
    }
    print('resolve-failures', failures.length)
    for (const failure of failures) print('  FAIL', failure)
    print('ids', models.map((model) => model.id).join(','))
    print('has-target', models.some((model) => model.id === 'deepseek-v4.1-flash'))
    await sleep(100)
    process.exit(0)
  })()
}

export default { name, inject, apply }
