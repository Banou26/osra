# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Osra is a type-safe communication library for JavaScript/TypeScript that enables seamless inter-context communication (Workers, SharedWorkers, ServiceWorkers, Windows, MessagePorts, WebSockets, Browser Extensions) with support for complex data types that normally wouldn't be transferable (Promises, Functions, Streams, Dates, Errors, TypedArrays).

## Commands

### Build
```bash
npm run build              # Build library to build/
npm run build-watch        # Build with watch mode
```

### Test
```bash
npm run build-test         # Build test bundle
npm run test               # Run Playwright tests
npm run test-with-coverage # Run tests with coverage report
```

### Development
```bash
npm run dev                # Watch mode for test builds
npm run dev2               # Watch mode with headed browser tests
npm run type-check         # TypeScript type checking (tsc --noEmit)
```

### Linux Docker Testing
```bash
npm run linux-run-playwright  # Start Playwright server in Docker
npm run linux-test            # Run tests against Docker Playwright
```

## Architecture

### Core Entry Point
- `src/index.ts` - Exports the main `expose()` function which handles both bidirectional and unidirectional communication modes

### Type System (`src/types.ts`)
- Defines `Capable` type - the union of all types Osra can serialize/deserialize
- `Structurable` - types that can be structured-cloned natively
- `Revivable` - complex types (Promise, Function, MessagePort, TypedArray, ReadableStream, Date, Error) that require boxing/reviving
- `Transport` - platform transports (Worker, Window, MessagePort, WebSocket, etc.) and custom transports

### Utilities (`src/utils/`)
- `platform.ts` - Transport detection and message sending/receiving
- `capabilities.ts` - Platform capability probing (MessagePort transfer, ArrayBuffer transfer, etc.)
- `revivable.ts` - Boxing/reviving logic for complex types
- `connection.ts` - Bidirectional and unidirectional connection management
- `allocator.ts` - MessageChannel allocation for function/promise communication
- `type-guards.ts` - Type guard utilities including TypedArray and WebExtension types

### Protocol Modes
1. **Bidirectional** - Both sides expose APIs and can call each other; requires `announce` handshake
2. **Unidirectional Emitting** - One-way communication where only caller-side calls remote
3. **Unidirectional Receiving** - One-way communication where only receiver-side exposes API

### Transport Modes
1. **Capable mode** - Full structured clone with MessagePort transfer support
2. **JSON-only mode** - Falls back to JSON serialization with box/reviver system (WebSockets, Browser Extensions)

## Test Structure

Tests use Playwright running in a browser context. Test files in `tests/` are bundled via `vite.test.config.ts` and injected into a browser page. Tests are defined as nested objects in `tests/_tests_.ts` and recursively registered as Playwright tests in `tests/index.spec.ts`.

To run a single test:
```bash
npx playwright test -g "test name"
```
