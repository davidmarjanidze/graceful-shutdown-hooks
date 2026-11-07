# graceful-shutdown-hooks

[![npm version](https://img.shields.io/npm/v/graceful-shutdown-hooks.svg)](https://www.npmjs.com/package/graceful-shutdown-hooks)
[![license](https://img.shields.io/npm/l/graceful-shutdown-hooks.svg)](https://www.npmjs.com/package/graceful-shutdown-hooks)

Runs your cleanup functions when a Node.js process shuts down, for example to
close the HTTP server and the database connection before exiting.

The functions run:

- on `SIGINT` (Ctrl+C), `SIGTERM` (Docker, Kubernetes, PM2) and `SIGHUP`
- on an uncaught error or an unhandled promise rejection
- when the process has nothing left to do and is about to exit
- when you call `shutdown()`

They run once, one at a time, the last added first. Async functions are
awaited. If they take longer than 10 seconds in total, the process exits
anyway.

Works with both `import` and `require`. Requires Node.js 18 or newer. No
dependencies.

## Installation

```console
npm i graceful-shutdown-hooks
```

## Usage

```ts
import { onShutdown } from 'graceful-shutdown-hooks'

const db = await connectToDatabase()
onShutdown(() => db.close())

const server = app.listen(3000)
onShutdown(() => new Promise((resolve) => server.close(resolve)))
```

When the process gets `SIGTERM`, the server is closed first and then the
database, because handlers run in the opposite order they were added.

Each handler gets the reason for the shutdown:

```ts
onShutdown((reason) => {
  console.log(`Shutting down because of ${reason}`) // 'SIGTERM'
})
```

To exit from your own code, call `shutdown()` instead of `process.exit()`.
`process.exit()` exits right away and skips the handlers.

```ts
import { shutdown } from 'graceful-shutdown-hooks'

if (!config.valid) await shutdown(1)
```

## Exit codes

| Reason                                     | Exit code                                             |
| ------------------------------------------ | ----------------------------------------------------- |
| Signal                                     | 128 + signal number (`SIGTERM` = 143, `SIGINT` = 130) |
| `uncaughtException` / `unhandledRejection` | 1                                                     |
| Process ends on its own                    | `process.exitCode`, or 0                              |
| `shutdown(code)`                           | `code`, 0 by default                                  |
| A handler throws or the timeout runs out   | 1                                                     |

If the process gets a second signal while the handlers are running (for
example, you press Ctrl+C twice), it exits right away.

## API

### onShutdown(handler)

- `handler` - `(reason) => void | Promise<void>`. `reason` is the signal name,
  `'uncaughtException'`, `'unhandledRejection'`, `'beforeExit'` or
  `'manual'`.
- Returns: a function that removes the handler.

An error thrown by a handler is passed to `onError` and the other handlers
still run.

### shutdown(exitCode?)

Runs the handlers and exits with `exitCode`. Default: `0`. Calling it again
while the shutdown is running does nothing.

### isShuttingDown()

Returns `true` once the shutdown has started. Useful, for example, to stop
taking new jobs.

### configureShutdown(options)

- `options.timeout` - milliseconds the handlers get in total. Default:
  `10000`.
- `options.signals` - signals to listen to. Default:
  `['SIGINT', 'SIGTERM', 'SIGHUP']`.
- `options.handleErrors` - run the handlers on `uncaughtException` and
  `unhandledRejection`. Default: `true`.
- `options.handleBeforeExit` - run the handlers when the process ends on its
  own. Default: `true`.
- `options.onError` - called with errors from handlers, uncaught errors and
  the timeout error. Default: `console.error`.

```ts
import { configureShutdown } from 'graceful-shutdown-hooks'

configureShutdown({
  timeout: 30_000,
  onError: (error) => logger.error(error)
})
```

## Notes

- Windows doesn't really have signals. Ctrl+C (`SIGINT`) works, but other
  processes can't send `SIGTERM` to a Node.js process there.
- The package listens to process events only after the first `onShutdown`
  call, so importing it alone changes nothing.

## License

ISC
