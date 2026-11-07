import { constants } from 'node:os'

export type ShutdownReason =
  | NodeJS.Signals
  | 'uncaughtException'
  | 'unhandledRejection'
  | 'beforeExit'
  | 'manual'

export type ShutdownHandler = (reason: ShutdownReason) => unknown

export interface ShutdownOptions {
  /**
   * Milliseconds the handlers get in total. After that the process exits
   * with code 1. Default: `10000`.
   */
  timeout?: number
  /** Signals that start the shutdown. Default: `['SIGINT', 'SIGTERM', 'SIGHUP']`. */
  signals?: NodeJS.Signals[]
  /**
   * Run the handlers on `uncaughtException` and `unhandledRejection`, then
   * exit with code 1. Default: `true`.
   */
  handleErrors?: boolean
  /**
   * Run the handlers when the process has nothing left to do and is about
   * to exit on its own. Default: `true`.
   */
  handleBeforeExit?: boolean
  /**
   * Called with errors thrown by handlers, uncaught errors and the timeout
   * error. Default: `console.error`.
   */
  onError?: (error: unknown) => void
}

type Required<T> = { [K in keyof T]-?: T[K] }

const defaults: Required<ShutdownOptions> = {
  timeout: 10_000,
  signals: ['SIGINT', 'SIGTERM', 'SIGHUP'],
  handleErrors: true,
  handleBeforeExit: true,
  onError: (error) => console.error(error)
}

let options = { ...defaults }
let installed = false
let running: Promise<void> | undefined
const handlers: ShutdownHandler[] = []

function onSignal(signal: NodeJS.Signals): void {
  // A second signal, for example pressing Ctrl+C twice, exits right away.
  if (running) process.exit(128 + (constants.signals[signal] ?? 0))
  void run(signal, 128 + (constants.signals[signal] ?? 0))
}

function onUncaughtException(error: Error): void {
  options.onError(error)
  void run('uncaughtException', 1)
}

function onUnhandledRejection(reason: unknown): void {
  options.onError(reason)
  void run('unhandledRejection', 1)
}

function onBeforeExit(): void {
  void run('beforeExit', Number(process.exitCode ?? 0))
}

function install(): void {
  if (installed) return
  installed = true
  for (const signal of options.signals) process.on(signal, onSignal)
  if (options.handleErrors) {
    process.on('uncaughtException', onUncaughtException)
    process.on('unhandledRejection', onUnhandledRejection)
  }
  if (options.handleBeforeExit) process.on('beforeExit', onBeforeExit)
}

function uninstall(): void {
  if (!installed) return
  installed = false
  for (const signal of options.signals) process.off(signal, onSignal)
  process.off('uncaughtException', onUncaughtException)
  process.off('unhandledRejection', onUnhandledRejection)
  process.off('beforeExit', onBeforeExit)
}

function run(reason: ShutdownReason, exitCode: number): Promise<void> {
  if (running) return running

  running = (async () => {
    const timer = setTimeout(() => {
      options.onError(
        new Error(`Shutdown handlers took longer than ${options.timeout} ms`)
      )
      process.exit(1)
    }, options.timeout)

    // The last added handler runs first, like closing things in the
    // opposite order they were opened.
    for (const handler of [...handlers].reverse()) {
      try {
        await handler(reason)
      } catch (error) {
        options.onError(error)
        if (exitCode === 0) exitCode = 1
      }
    }

    clearTimeout(timer)
    process.exit(exitCode)
  })()

  return running
}

/**
 * Changes the options. Can be called at any time, the new options replace
 * the ones passed before.
 */
export function configureShutdown(newOptions: ShutdownOptions): void {
  const merged = { ...options, ...newOptions }
  if (!(merged.timeout > 0)) {
    throw new RangeError(
      `"timeout" must be a positive number, got ${merged.timeout}`
    )
  }

  const wasInstalled = installed
  uninstall()
  options = merged
  if (wasInstalled) install()
}

/**
 * Adds a function to run when the process shuts down. Handlers run one at a
 * time, the last added first. Returns a function that removes the handler.
 */
export function onShutdown(handler: ShutdownHandler): () => void {
  if (typeof handler !== 'function') {
    throw new TypeError('"handler" must be a function')
  }
  handlers.push(handler)
  install()

  return () => {
    const index = handlers.lastIndexOf(handler)
    if (index !== -1) handlers.splice(index, 1)
  }
}

/**
 * Runs the handlers and exits with `exitCode`. Use this instead of
 * `process.exit()`, which would skip the handlers. Calling it again while
 * the shutdown is running returns the same promise.
 */
export function shutdown(exitCode = 0): Promise<void> {
  return run('manual', exitCode)
}

/** `true` once the shutdown has started. */
export function isShuttingDown(): boolean {
  return running !== undefined
}
