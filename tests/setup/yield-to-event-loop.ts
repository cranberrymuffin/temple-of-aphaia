import { afterEach } from 'vitest'

// The geometry tests are long and fully synchronous. Vitest only awaits microtasks between
// tests, so without a macrotask break the worker cannot process RPC replies from the main
// process for a whole file; on slow CI runners a file can exceed the 60 s RPC timeout
// ("[vitest-worker]: Timeout calling onTaskUpdate"). Yield to the event loop after each test.
afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
