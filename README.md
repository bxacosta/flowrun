# flowrun

`flowrun` is a TypeScript library for defining and executing typed flows composed of steps, sequences, and parallel
branches.

It provides a compact execution model for orchestrating application workflows with explicit state mutation, retries,
timeouts, middleware, cancellation, pause/resume control, and event-based reporting.

## Key Features

- Typed flow definitions with `step`, `sequence`, and `parallel`
- Explicit shared state through a runtime state store
- Step retries with constant or exponential backoff
- Step timeouts and configurable error handling
- Parallel execution with configurable merge strategies
- Middleware support at flow and step level
- Cooperative cancellation and pause/resume controls
- Event-based reporting and custom reporter support

## Requirements

- Bun
- TypeScript 5

## Install

```bash
bun install
```

## Run Type Check

```bash
bun run check
```

## Run Tests

```bash
bun test tests/
```

## Run Examples

```bash
bun run example:basic
bun run example:parallel
bun run example:complete
bun run example:cli
```

## Project Structure

- `src/`: library source code
- `examples/`: runnable examples
- `docs/`: technical documentation
- `tests/`: unit and integration tests
