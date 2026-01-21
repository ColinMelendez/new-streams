---
theme: default
title: New Streams API
info: |
  An introduction to the new Streams API - a bytes-only, iterable-based
  streaming solution with explicit backpressure.
highlighter: shiki
drawings:
  persist: false
transition: slide-left
mdc: true
---

# A New Streams API

A simpler, faster approach to streaming data

<div class="pt-12">
  <span class="px-2 py-1 rounded text-sm">
    Based on iterables, designed for performance
  </span>
</div>

---
layout: section
---

# Why a New API?

Problems with Web Streams

---

# Motivation: Web Streams Issues

<v-clicks>

- **Excessive Ceremony** - Too much boilerplate for simple operations
- **Confusing Locking** - Reader/writer locks that are easy to leak
- **Complex Specification** - 70+ abstract operations, multiple state machines
- **Controller API Confusion** - The controller is hard to use correctly
- **Hidden Buffering** - `tee()` and transforms create unbounded buffers
- **Promise Overhead** - Every `read()` creates multiple promises internally

</v-clicks>

---

# The Web Streams Problem

```javascript {all|2|3-10|11}
// Reading a stream to completion in Web Streams
const stream = getSomeReadableStream();
const reader = stream.getReader();
const chunks = [];
try {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
} finally {
  reader.releaseLock(); // Easy to forget!
}
```

<v-click>

Compare to the new API:

```javascript
for await (const chunks of readable) {
  for (const chunk of chunks) process(chunk);
}
```

</v-click>

---

# Real-World Failures

<div class="grid grid-cols-2 gap-4">
<div>

### Memory Leaks
- Cloudflare Workers: Transform buffers grew unbounded under load
- Node.js Fetch: Unconsumed bodies exhausted connection pools
- Firefox `tee()`: O(n) memory when branches consumed at different rates

</div>
<div>

### Complexity Bugs
- React SSR deadlocks with nested Suspense
- AWS SDK v3 memory explosion on slow processing
- Deno HTTP server DoS vulnerability

</div>
</div>

<v-click>

All stem from the same root causes: **hidden buffering**, **implicit backpressure**, and **complex state machines**.

</v-click>

---
layout: section
---

# Design Principles

Building a better foundation

---

# Core Design Principles

<v-clicks>

1. **Streams Are Just Iterables** - No custom classes, use `AsyncIterable<Uint8Array[]>`

2. **Pull-Through Transforms** - Transforms only execute when consumer pulls

3. **Explicit Backpressure** - Strict by default with configurable policies

4. **Batched Chunks** - Yield `Uint8Array[]` to amortize async overhead

5. **Bytes Only** - No "value streams", just `Uint8Array`

6. **Clean Sync/Async Separation** - Parallel APIs with no ambiguity

7. **Sync Fast Path** - Fully synchronous operation when possible

8. **Minimal Dependencies** - AbortSignal is the only non-intrinsic API dependency

</v-clicks>

---

# Backpressure Policies

```typescript
type BackpressurePolicy =
  | 'strict'       // Default - catches fire-and-forget writes
  | 'block'        // Async writes wait for space
  | 'drop-oldest'  // Drop old data to make room
  | 'drop-newest'; // Discard incoming when full
```

<v-click>

```typescript
const { writer, readable } = Stream.push({
  highWaterMark: 10,
  backpressure: 'strict' // Rejects if producer ignores backpressure
});

// This pattern is safe - waits for backpressure
for (const item of largeDataset) {
  await writer.write(item);  // Properly awaited
}
```

</v-click>

---
layout: section
---

# API Fundamentals

The building blocks

---

# The Stream Namespace

```typescript
import { Stream } from 'new-streams';

// Creation
Stream.push()          // Push stream with writer
Stream.from()          // From strings, arrays, generators
Stream.duplex()        // Bidirectional channel pair

// Pipelines & Transforms
Stream.pull()          // Pull pipeline with transforms
Stream.pipeTo()        // Pipe to a writer destination

// Consumers
Stream.bytes()         // Collect as Uint8Array
Stream.text()          // Collect as string
Stream.array()         // Collect as Uint8Array[]

// Multi-Consumer
Stream.broadcast()     // Push to multiple consumers
Stream.share()         // Pull from shared source

// Utilities
Stream.merge()         // Merge multiple sources
Stream.tap()           // Observe without modifying
Stream.ondrain()       // Wait for backpressure to clear
```

---

# Creating Streams

```typescript {all|1-2|4-7|9-14}
// From existing data
const readable = Stream.from("Hello, World!");

// From generators
function* chunks() {
  yield 'chunk1'; yield 'chunk2';
}
const readable = Stream.from(chunks());

// Push-based streams
const { writer, readable } = Stream.push();
await writer.write("Hello ");
await writer.write("World!");
await writer.end();
```

---

# Consuming Streams

```typescript {all|1-2|4-5|7-11}
// Collect as bytes or text
const bytes = await Stream.bytes(readable);
const text = await Stream.text(readable);

// With limits (protection against unbounded growth)
const text = await Stream.text(readable, { limit: 1024 * 1024 });

// Iterate directly
for await (const chunks of readable) {
  for (const chunk of chunks) {
    process(chunk);
  }
}
```

---

# Transforms

<div class="grid grid-cols-2 gap-4">
<div>

### Stateless (Function)

```typescript
const uppercase: Transform = (chunks) => {
  if (chunks === null) return null;
  return chunks.map(chunk => {
    const text = decode(chunk);
    return encode(text.toUpperCase());
  });
};
```

</div>
<div>

### Stateful (Object)

```typescript
const lineBuffer: TransformObject = {
  async *transform(source) {
    let buffer = '';
    for await (const chunks of source) {
      if (chunks === null) {
        if (buffer) yield encode(buffer);
        continue;
      }
      // ... accumulate lines
    }
  }
};
```

</div>
</div>

---

# Pull Pipelines

```typescript {all|1-2|4-9|11-14}
// Simple pipeline
const output = Stream.pull(source, compress, encrypt);

// Nothing executes until iteration begins
for await (const chunks of output) {
  for (const chunk of chunks) {
    // Transforms execute on-demand
  }
}

// Pipe to a destination
const bytesWritten = await Stream.pipeTo(
  source, compress, encrypt, fileWriter
);
```

---

# Multi-Consumer Patterns

<div class="grid grid-cols-2 gap-4">
<div>

### Broadcast (Push)

```typescript
const { writer, broadcast } =
  Stream.broadcast({ highWaterMark: 100 });

const consumer1 = broadcast.push();
const consumer2 = broadcast.push(decompress);

await writer.write("shared data");
await writer.end();
```

</div>
<div>

### Share (Pull)

```typescript
const shared = Stream.share(
  fileStream,
  { highWaterMark: 100 }
);

const raw = shared.pull();
const decompressed = shared.pull(decompress);
const parsed = shared.pull(decompress, parse);
```

</div>
</div>

<v-click>

Both require **explicit buffer limits** - no hidden unbounded buffering!

</v-click>

---
layout: section
---

# Samples & Benchmarks

Real-world usage and performance

---

# Sample Programs

| Sample | Description |
|--------|-------------|
| `01-basic-creation.ts` | Stream.from(), Stream.push(), generators |
| `02-consumption-methods.ts` | bytes(), text(), iteration patterns |
| `04-transforms.ts` | Stateless and stateful transforms |
| `05-piping.ts` | pipeTo() with transforms |
| `06-buffer-configuration.ts` | Backpressure policies |
| `12-nodejs-interop.ts` | Integration with Node.js streams |
| `13-web-streams-interop.ts` | Integration with Web Streams |

<v-click>

```bash
# Run any sample
npx tsx samples/01-basic-creation.ts
```

</v-click>

---

# Benchmark Results

| Scenario | New Streams | vs Web Streams | vs Node.js |
|----------|-------------|----------------|------------|
| Small chunks (1KB) | 5 GB/s | **2x faster** | **2.5x faster** |
| Tiny chunks (100B) | 1.6 GB/s | **5x faster** | **4x faster** |
| Async iteration | 270 GB/s | **12x faster** | **15x faster** |
| Chained transforms | 175 GB/s | **86x faster** | **70x faster** |
| Identity transform | 310 GB/s | **63x faster** | **52x faster** |

<v-click>

Key insight: **Batching amortizes async overhead** - the more transforms and smaller chunks, the bigger the win.

</v-click>

---

# Where Performance Shines

<div class="grid grid-cols-2 gap-4">
<div>

### Much Faster

- Chained transforms (70-104x)
- Simple pipelines (19-22x)
- Async iteration (12-18x)
- Small/tiny chunks (2-5x)

</div>
<div>

### Equivalent

- CPU-bound transforms
- Large chunk throughput
- Push stream backpressure
- bytes() collection

</div>
</div>

<v-click>

The new API excels when **async overhead dominates** - which is most streaming workloads!

</v-click>

---
layout: section
---

# Summary

---

# Benefits of the New Design

<v-clicks>

- **Simpler Mental Model** - Streams are iterables, transforms are functions
- **Explicit Backpressure** - No hidden unbounded buffers, configurable policies
- **Better Performance** - Batching reduces promise overhead by orders of magnitude
- **Type Safety** - Bytes only, clean sync/async separation
- **Protocol Extensibility** - `toStreamable`, `drainableProtocol` for custom types
- **Familiar Patterns** - `for await...of` just works
- **Easier implementation** - Fewer abstract operations, no locking, simpler state machines

</v-clicks>

---

# Getting Started

```bash
# Run tests (194 tests)
npm test

# Run samples
npx tsx samples/01-basic-creation.ts

npm run html-samples

# Run benchmarks
npm run benchmark
```

<v-click>

### Key Resources

- `README.md` - Motivation and overview
- `API.md` - Complete API reference
- `MIGRATION.md` - Guide from Web Streams
- `samples/` - Working examples
- `benchmarks/` - Performance comparisons

</v-click>

---
layout: center
class: text-center
---

# Questions?

[API Reference](API.md) | [Samples](samples/) | [Benchmarks](benchmarks/)
