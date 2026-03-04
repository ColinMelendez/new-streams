# Alignment with KJ Async-IO Model

This document discusses how the new streams API design aligns with and is influenced by the
async-io model used in the KJ library (part of Cap'n Proto). While the new streams API is
implemented in JavaScript/TypeScript, its design principles map well to KJ's patterns, making
it easier to bridge between JavaScript and C++ implementations in systems like Cloudflare Workers.

## Table of Contents

1. [Overview of KJ Async-IO](#1-overview-of-kj-async-io)
2. [Design Alignment](#2-design-alignment)
3. [Key Correspondences](#3-key-correspondences)
4. [Practical Integration Benefits](#4-practical-integration-benefits)
5. [Differences and Trade-offs](#5-differences-and-trade-offs)

---

## 1. Overview of KJ Async-IO

KJ is a C++ async framework developed alongside Cap'n Proto that provides foundational primitives
for asynchronous I/O. Key characteristics include:

- **Promise-based async model**: Operations return `kj::Promise<T>` that can be chained with `.then()`
- **Pull-oriented streaming**: `AsyncInputStream::tryRead()` pulls data on demand
- **Explicit backpressure**: Operations block/wait naturally through the promise chain
- **Zero-copy when possible**: `pumpTo()` enables optimized data transfer paths
- **Non-negative buffer semantics**: No concept of "over capacity" that requires special handling
- **Clean separation of sync/async**: Synchronous file I/O vs async network I/O are distinct paths
- **Chunk-oriented**: Operations work on byte arrays, not individual bytes

```cpp
// KJ AsyncInputStream interface (simplified)
class AsyncInputStream {
  virtual Promise<size_t> tryRead(void* buffer, size_t minBytes, size_t maxBytes) = 0;
  virtual Promise<uint64_t> pumpTo(AsyncOutputStream& output, uint64_t amount);
  Promise<Array<byte>> readAllBytes(uint64_t limit = kj::maxValue);
};
```

---

## 2. Design Alignment

### 2.1 Pull-Through Execution Model

**KJ Pattern**: KJ streams are fundamentally pull-based. `AsyncInputStream::tryRead()` is called
when the consumer wants data. No data flows until the consumer initiates a read. This naturally
provides backpressure - if the consumer stops reading, the producer naturally pauses.

**New Streams API**: The `Stream.pull()` pipeline is explicitly pull-through:

```typescript
// Nothing executes until iteration begins
const output = Stream.pull(source, compress, encrypt);

// Transforms execute as we iterate - data flows on-demand
for await (const chunks of output) {
  process(chunks);
}
```

This is the same fundamental model as KJ. Both avoid the "eager push" problem where data
accumulates in internal buffers because transforms execute regardless of consumer readiness.

### 2.2 Promise-Based Async with Sync Fast Paths

**KJ Pattern**: KJ uses `Promise<T>` for async operations but optimizes for the case where
data is already available. The implementation avoids promise machinery overhead when operations
can complete synchronously but still fundamentally builds around promises.

**New Streams API**: The API provides complete sync variants (`pullSync`, `pipeToSync`,
`bytesSync`) for CPU-bound workloads, plus sync methods on `Writer`:

```typescript
interface Writer {
  write(chunk: Uint8Array | string): Promise<void>;
  writeSync(chunk: Uint8Array | string): boolean;  // Sync fast path
  // ...
}
```

### 2.3 Chunk Batching for Reduced Async Overhead

**KJ Pattern**: KJ's `tryRead()` reads `minBytes` to `maxBytes` in a single call, amortizing
the cost of the async operation across multiple bytes. The `pumpTo()` method can transfer
large amounts of data efficiently.

**New Streams API**: All iterables yield `Uint8Array[]` (batches of chunks):

```typescript
for await (const chunks of readable) {  // One await per batch
  for (const chunk of chunks) {         // Sync iteration within batch
    process(chunk);
  }
}
```

This batching amortizes promise overhead - instead of one await per chunk, you get one await
per batch. This directly mirrors how KJ batches I/O operations for efficiency but with a
different approach. While KJ is byte-oriented, the new streams API is chunk-oriented, which
works better in JavaScript.

### 2.4 Non-Negative desiredSize

**KJ Pattern**: KJ doesn't have a concept of "over capacity" where a queue can grow unboundedly
past its limit. Either data is accepted, or the operation waits/fails.

**New Streams API**: `desiredSize` is always >= 0 or null (closed). Unlike Web Streams where
`desiredSize` can go negative indicating "over capacity", this API enforces strict backpressure:

```typescript
interface Writer {
  readonly desiredSize: number | null;  // Always >= 0, never negative
}
```

The default `'strict'` backpressure policy enforces this by rejecting writes that would exceed
the buffer limit, preventing unbounded growth but the models are aligned in principle while
different in specifics.

### 2.5 Explicit Backpressure Policies

**KJ Pattern**: KJ streams naturally apply backpressure through the promise chain. When a
consumer is slow, the producer's promise remains unfulfilled, blocking further production.

**New Streams API**: Backpressure is explicit and configurable:

```typescript
const { writer, readable } = Stream.push({
  highWaterMark: 10,
  backpressure: 'strict'  // 'strict' | 'block' | 'drop-oldest' | 'drop-newest'
});
```

The `'strict'` default catches "fire-and-forget" writes that would cause unbounded memory
growth - a common bug that KJ's design also helps prevent through its promise-based model.

### 2.6 pumpTo Optimization Path

**KJ Pattern**: KJ's `AsyncInputStream::pumpTo()` and `AsyncOutputStream::tryPumpFrom()`
enable optimized data transfer. Implementations can detect compatible stream types and
use zero-copy paths like `sendfile()`:

```cpp
// From KJ async-io.h
virtual Promise<uint64_t> pumpTo(AsyncOutputStream& output, uint64_t amount);
virtual Maybe<Promise<uint64_t>> tryPumpFrom(AsyncInputStream& input, uint64_t amount);
```

**New Streams API**: `Stream.pipeTo()` provides an equivalent optimization point:

```typescript
const bytesWritten = await Stream.pipeTo(source, compress, fileWriter);
```

The implementation can use `writev()` for batch efficiency, and future implementations
could add detection of compatible sink types for zero-copy optimization.

### 2.7 Bytes-Only Model

**KJ Pattern**: KJ's stream interfaces deal exclusively with bytes (`ArrayPtr<byte>`).
Higher-level abstractions handle typed data.

**New Streams API**: The API is bytes-only (`Uint8Array`). Strings are automatically
UTF-8 encoded:

```typescript
await writer.write("Hello");  // Automatically becomes UTF-8 bytes
```

This matches KJ's approach and avoids the complexity of Web Streams' "value streams" that
can stream arbitrary JavaScript values.

---

## 3. Key Correspondences

| KJ Concept | New Streams API | Notes |
|------------|-----------------|-------|
| `AsyncInputStream` | `AsyncIterable<Uint8Array[]>` | Both are pull-based readable sources |
| `AsyncOutputStream` | `Writer` interface | Both support write/writev patterns |
| `AsyncIoStream` | Push stream pair | Bidirectional byte stream |
| `tryRead()` | Async iteration | Pull-based consumption |
| `pumpTo()` | `Stream.pipeTo()` | Optimized data transfer |
| `readAllBytes()` | `Stream.bytes()` | Collect entire stream with limit |
| `readAllText()` | `Stream.text()` | Collect as decoded text with limit |
| `newTee()` | `Stream.share()` | Multi-consumer with explicit buffering |
| `OneWayPipe` | `Stream.push()` result | Writer + readable pair |
| `newOneWayPipe()` | `Stream.push()` | Creates bonded writer/readable |

---

## 4. Practical Integration Benefits

### 4.1 Bridging JavaScript and C++

In systems like Cloudflare Workers that run JavaScript on a C++/KJ-based runtime, the new
streams API design makes bridging cleaner:

```typescript
// JavaScript side
const output = Stream.pull(source, compress);
await Stream.pipeTo(output, networkWriter);

// Maps cleanly to KJ concepts:
// - source becomes kj::AsyncInputStream
// - compress becomes a transform that wraps the stream
// - networkWriter becomes kj::AsyncOutputStream
// - pipeTo becomes pumpTo with transform
```

### 4.2 Consistent Backpressure Semantics

Both APIs use the same fundamental mental model for backpressure:

1. Consumer controls data flow through pull operations
2. Producer waits when consumer is slow
3. No hidden unbounded buffers

This consistency means backpressure behavior is predictable whether data is in JavaScript
or C++ layers of the stack.

### 4.3 Transform Pipeline Composition

KJ doesn't have a built-in transform composition model, but the new streams API's approach
is compatible:

```typescript
// New Streams API
const output = Stream.pull(source, compress, encrypt, sign);
```

This can map to a KJ implementation where each transform wraps the previous stream,
with data flowing on-demand through the chain.

### 4.4 Efficient Multi-Consumer Patterns

KJ's `newTee()` has explicit buffer limits to prevent unbounded growth. The new streams
API mirrors this with `Stream.share()`:

```typescript
// Both require explicit buffer management
const shared = Stream.share(source, {
  highWaterMark: 100,
  backpressure: 'strict'
});
```

---

## Summary

The new streams API is intentionally designed with patterns that align well with KJ's
async-io model:

- **Pull-through execution** prevents eager buffering
- **Explicit backpressure** with non-negative desiredSize
- **Batched operations** amortize async overhead
- **Bytes-only** simplifies the mental model
- **Clean sync/async separation** enables optimization
- **Explicit multi-consumer** patterns with bounded buffers

This alignment makes the API well-suited for use in JavaScript/C++ hybrid environments
where streaming data needs to flow efficiently between the two language runtimes. The
design choices favor simplicity and correctness while maintaining the performance
characteristics needed for high-throughput streaming applications.
