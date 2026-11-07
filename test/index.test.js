import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const esm = import.meta.resolve('../dist/index.js')
const cjs = fileURLToPath(import.meta.resolve('../dist/index.cjs'))

// Runs the code in a child process and returns its output and exit code.
// If `signal` is set, it's sent once the child prints "ready".
function runChild(code, { signal, type = 'module' } = {}) {
  const header =
    type === 'module'
      ? `import * as lib from ${JSON.stringify(esm)};`
      : `const lib = require(${JSON.stringify(cjs)});`
  const child = spawn(
    process.execPath,
    [`--input-type=${type}`, '-e', header + code],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (data) => {
    stdout += data
    if (signal && stdout.includes('ready')) {
      child.kill(signal)
      signal = undefined
    }
  })
  child.stderr.on('data', (data) => (stderr += data))

  return new Promise((resolve) => {
    child.on('exit', (exitCode) => resolve({ stdout, stderr, exitCode }))
  })
}

const keepAlive = "setInterval(() => {}, 1000); console.log('ready');"

test(
  'runs handlers on SIGTERM, last added first',
  { skip: process.platform === 'win32' },
  async () => {
    const result = await runChild(
      `
      lib.onShutdown(() => console.log('first'))
      lib.onShutdown(async (reason) => {
        await new Promise((r) => setTimeout(r, 50))
        console.log('second ' + reason)
      })
      ${keepAlive}`,
      { signal: 'SIGTERM' }
    )
    assert.equal(result.stdout, 'ready\nsecond SIGTERM\nfirst\n')
    assert.equal(result.exitCode, 143)
  }
)

test('shutdown() runs handlers and uses the exit code', async () => {
  const result = await runChild(`
    lib.onShutdown((reason) => console.log(reason))
    setTimeout(() => lib.shutdown(3), 10)
    ${keepAlive}`)
  assert.equal(result.stdout, 'ready\nmanual\n')
  assert.equal(result.exitCode, 3)
})

test('runs handlers when the process ends on its own', async () => {
  const result = await runChild(`
    lib.onShutdown((reason) => console.log(reason))`)
  assert.equal(result.stdout, 'beforeExit\n')
  assert.equal(result.exitCode, 0)
})

test('runs handlers on an uncaught error and exits with 1', async () => {
  const result = await runChild(`
    lib.onShutdown((reason) => console.log(reason))
    setTimeout(() => { throw new Error('boom') }, 10)
    ${keepAlive}`)
  assert.equal(result.stdout, 'ready\nuncaughtException\n')
  assert.match(result.stderr, /boom/)
  assert.equal(result.exitCode, 1)
})

test('runs handlers on an unhandled rejection', async () => {
  const result = await runChild(`
    lib.onShutdown((reason) => console.log(reason))
    Promise.reject(new Error('nope'))
    ${keepAlive}`)
  assert.match(result.stdout, /unhandledRejection/)
  assert.equal(result.exitCode, 1)
})

test('a failing handler does not stop the others', async () => {
  const result = await runChild(`
    lib.onShutdown(() => console.log('still runs'))
    lib.onShutdown(() => { throw new Error('handler failed') })
    lib.shutdown()`)
  assert.equal(result.stdout, 'still runs\n')
  assert.match(result.stderr, /handler failed/)
  assert.equal(result.exitCode, 1)
})

test('exits with 1 after the timeout', async () => {
  const result = await runChild(`
    lib.configureShutdown({ timeout: 100 })
    lib.onShutdown(() => new Promise(() => {}))
    lib.shutdown()
    ${keepAlive}`)
  assert.match(result.stderr, /longer than 100 ms/)
  assert.equal(result.exitCode, 1)
})

test('removed handlers do not run', async () => {
  const result = await runChild(`
    const remove = lib.onShutdown(() => console.log('removed'))
    lib.onShutdown(() => console.log('kept'))
    remove()
    lib.shutdown()`)
  assert.equal(result.stdout, 'kept\n')
})

test('isShuttingDown and calling shutdown twice', async () => {
  const result = await runChild(`
    lib.onShutdown(() => console.log('once'))
    console.log(lib.isShuttingDown())
    lib.shutdown()
    lib.shutdown()
    console.log(lib.isShuttingDown())`)
  assert.equal(result.stdout, 'false\nonce\ntrue\n')
})

test('CommonJS build works', async () => {
  const result = await runChild(
    `
    lib.onShutdown(() => console.log('cjs'))
    lib.shutdown(5)`,
    { type: 'commonjs' }
  )
  assert.equal(result.stdout, 'cjs\n')
  assert.equal(result.exitCode, 5)
})
