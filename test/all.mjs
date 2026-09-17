/**
 * Test entry point for environments where `node --test` cannot spawn workers
 * (the harness file sandbox blocks piped stdio). Importing every suite into one
 * process runs exactly the same tests; `node --test` remains the default for
 * CI, where spawning is fine.
 *
 * @module dsh-opencode-go-model-list/test/all
 */
import './sources.test.mjs'
import './mapping.test.mjs'
import './catalog.test.mjs'
import './fidelity.test.mjs'
import './plugin.test.mjs'
