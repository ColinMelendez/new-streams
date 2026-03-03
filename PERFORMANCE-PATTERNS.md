# Performance Patterns & DX Ergonomics

This document catalogs the patterns that produce the best performance with the
new streams API, evaluates the developer experience of each, and identifies
where good performance requires unnatural code.

Every recommendation below is backed by benchmark data from the suite in
`benchmarks/`. Where a pattern has a meaningful DX cost, it is called out
explicitly so we can evaluate whether the API should change.

---

## 1. Consuming a readable: the double-loop tax

### Fast pattern

```ts
for await (const batch of readable) {
  for (const chunk of batch) {
    process(chunk);
  }
}
```

### What users expect

```ts
for await (const chunk of readable) {
  process(chunk);
}
```

### Why it matters

Readables yield `Uint8Array[]` batches, not individual chunks. The outer loop
iterates async (one promise resolution per batch), while the inner loop is pure
synchronous array iteration. Batching amortizes the per-yield async overhead
and is the primary reason new streams is 10-70x faster than web streams on
small-chunk and multi-stage workloads.

### Benchmark evidence

| Scenario | New Streams | Web Streams | Speedup |
|---|---|---|---|
| Async iteration (8KB x 1000) | 312 GB/s | 25 GB/s | 12x |
| Tiny chunks (100B x 10000) | 1.73 GB/s | 329 MB/s | 5x |
| Chained 3x transforms (8KB x 500) | 126 GB/s | 1.92 GB/s | 66x |

### DX verdict: Moderate tax

The double loop is the single most visible DX cost of the API. Every consumer
must write it. Forgetting the inner loop silently compiles — you get
`Uint8Array[]` where you expected `Uint8Array`, leading to confusing bugs.

Note that built-in consumers (`bytes()`, `text()`, `array()`, `pipeTo()`)
handle batches internally, so users who collect or pipe data never write the
double loop. The tax applies only to manual `for await` iteration.

### Possible mitigations (not yet implemented)

**Option A: `Stream.forEach(readable, fn)` — callback-based, zero overhead**

```ts
await Stream.forEach(readable, (chunk) => {
  process(chunk);
});
```

Implementation would check if the callback returns a Promise and only `await`
when it does. For synchronous callbacks this has **zero additional overhead** ��
the double loop runs identically to hand-written code, just hidden inside
`forEach`. Only async callbacks pay per-chunk Promise cost.

Limitation: no `break`/`continue`/`return` flow control (callback land).

A `forEachSync` variant would cover sync readables.

**Option B: `Stream.unbatch(readable)` — returns `AsyncIterable<Uint8Array>`**

```ts
for await (const chunk of Stream.unbatch(readable)) {
  if (shouldStop(chunk)) break;
  process(chunk);
}
```

Every chunk goes through an async generator `yield` — one Promise resolution
per chunk instead of per batch. This brings iteration throughput roughly to
web streams level (~25 GB/s instead of ~312 GB/s). Still fast in absolute
terms, but gives up the batching advantage at the unbatch boundary.

Crucially, the return type (`AsyncIterable<Uint8Array>`) **composes with the
rest of the API** thanks to the normalization layer. `Stream.from()`,
`Stream.pull()`, `Stream.bytes()`, etc. all accept `Streamable` inputs and
re-batch automatically:

```ts
const unbatched = Stream.unbatch(readable);
// Works — normalization re-batches for downstream processing
const result = await Stream.bytes(Stream.pull(unbatched, transform));
```

The performance cost is localized to the unbatch boundary; anything downstream
that re-enters the batched world recovers the batching benefit.

An `unbatchSync` variant would cover sync readables.

**Option C: Both**

`forEach` as the primary recommendation (zero overhead for sync callbacks,
covers 90% of use cases). `unbatch` as an explicit opt-in for the rare case
that needs iterator control flow (`break`, early return).

**Assessment**: Neither mitigation exists today. Of the options, `unbatch` is
the better primitive — `forEach` can be trivially built on top of it, but the
reverse is not true. And because normalization handles re-batching, `unbatch`
composes cleanly with the full API rather than being a one-way escape hatch.

---

## 2. Transforms: stateless functions vs stateful generators

### Fast pattern (stateless)

```ts
const xor: Transform = (chunks) => {
  return chunks.map(c => {
    const out = new Uint8Array(c.length);
    for (let i = 0; i < c.length; i++) out[i] = c[i] ^ 0x42;
    return out;
  });
};
```

### Stateful alternative (generator)

```ts
function* xorStateful(chunks: Uint8Array[] | null) {
  if (chunks === null) return;  // flush signal
  for (const c of chunks) {
    const out = new Uint8Array(c.length);
    for (let i = 0; i < c.length; i++) out[i] = c[i] ^ 0x42;
    yield out;
  }
}
```

### Benchmark evidence

| Variant | Throughput |
|---|---|
| Stateless function | 951 MB/s |
| Stateful generator | 814 MB/s |

Stateless functions are ~17% faster because the engine can optimize the return
value directly without generator state machine overhead.

### DX verdict: Natural

Both patterns are straightforward. The stateless function is actually simpler
to write — you receive a batch, return a batch. The generator form is useful
when the transform needs to buffer across calls (e.g., line splitting, framing
protocols) but is not required for simple per-chunk work.

The `chunks === null` flush signal is the only unusual element. Transforms must
handle it to flush internal buffers at end-of-stream. Forgetting it is a silent
bug — buffered data is lost.

---

## 3. Identity / passthrough transforms

### Key insight

```ts
const identity: Transform = (chunks) => chunks;
```

Identity transforms are essentially free:

| Scenario | Throughput |
|---|---|
| Identity (new streams) | 164 GB/s |
| Identity (web streams) | 4.7 GB/s |

This is 35x faster because the batched array passes straight through with no
per-chunk promise resolution. In web streams, each chunk must be individually
enqueued and dequeued through the TransformStream machinery.

### DX verdict: Excellent

This enables a pattern where middleware layers can cheaply wrap streams with
transforms that conditionally modify data. The "do nothing" case has near-zero
cost, unlike web streams where every pipeline stage adds measurable overhead.

---

## 4. Push streams: `writeSync` + `ondrain` vs `await write()`

### Fast pattern

```ts
const { writer, readable } = Stream.push({ highWaterMark: 100 });

for (const chunk of data) {
  if (!writer.writeSync(chunk)) {
    const canWrite = await Stream.ondrain(writer);
    if (!canWrite) break;
    writer.writeSync(chunk);
  }
}
await writer.end();
```

### Simple pattern

```ts
for (const chunk of data) {
  await writer.write(chunk);
}
await writer.end();
```

### Benchmark evidence (per-op, 1000 x 4KB)

| Pattern | Time | Heap/iter |
|---|---|---|
| `writeSync` + `ondrain` | 614 µs | 350 KB |
| `await write()` | 950 µs | 912 KB |
| Web streams push | 1.77 ms | 1.46 MB |

The `writeSync` + `ondrain` pattern is 1.5x faster than `await write()` and
2.9x faster than web streams. It avoids allocating a Promise per write when
the buffer has space.

### DX verdict: Significant tax

The fast pattern requires understanding three concepts: sync writes, return
value checking, and the drain protocol. The `await write()` pattern is
one line and obvious. Making users write the fast pattern for hot paths is a
real DX cost.

Mitigation: `await write()` already uses the sync fast path internally when
possible (returns a cached resolved promise). The difference only appears in
benchmarks with many writes. For most real-world code, `await write()` is fine.

The `writeSync` + `ondrain` pattern is mainly useful for bridging event-driven
sources (network sockets, file reads) where you want to avoid promise overhead
in the common case.

---

## 5. Writer implementation: sync fast paths

### Fast pattern (full Writer)

```ts
const writer: Writer = {
  get desiredSize() { return 1; },
  write(c) { /* async fallback */ },
  writev(cs) { /* async fallback */ },
  writeSync(c) { target.push(c); return true; },
  writevSync(cs) { target.push(...cs); return true; },
  end() { return Promise.resolve(total); },
  endSync() { return total; },
  fail() { return Promise.resolve(); },
  failSync() { return true; },
};
```

### Minimal pattern

```ts
const writer: Writer = {
  get desiredSize() { return 1; },
  async write(c) { target.push(c); },
  async writev(cs) { target.push(...cs); },
  async end() { return total; },
  async fail() {},
  writeSync() { return false; },  // opt out
  writevSync() { return false; }, // opt out
  endSync() { return -1; },      // opt out
  failSync() { return false; },  // opt out
};
```

### Benchmark evidence (pipeTo, 1000 x 4KB)

| Writer | Time | Heap/iter |
|---|---|---|
| Sync-capable writer | 3.67 ms | 345 KB |
| Web WritableStream | 11.79 ms | 7.49 MB |

`pipeTo` calls `writevSync` first and falls back to `writev` only when the
sync path returns `false`. When the writer can complete synchronously, the
entire pipeline avoids Promise allocation for each chunk batch.

### DX verdict: Moderate tax for writer authors

The Writer interface has 8 methods. Implementing all of them for maximum
performance is verbose. However, returning `false` / `-1` from sync methods
is a clean opt-out — `pipeTo` gracefully falls back. Writer authors who don't
care about performance can implement only the async methods and stub the sync
ones.

Library authors building high-performance writers (file sinks, network sinks,
database writers) will want the sync paths. Application developers piping to
those writers don't need to know — `pipeTo` handles the dispatch.

---

## 6. Sync APIs when data is available synchronously

### Fast pattern

```ts
const result = Stream.bytesSync(
  Stream.pullSync(Stream.fromSync(data), transform)
);
```

### Async equivalent

```ts
const result = await Stream.bytes(
  Stream.pull(Stream.from(data), transform)
);
```

### Benchmark evidence

| Scenario | pullSync | pull (async) | Web Streams |
|---|---|---|---|
| Small chunks (256B x 10000) | 14.1 GB/s | 9.2 GB/s | 175 MB/s |
| Tiny chunks (64B x 20000) | 8.4 GB/s | 4.6 GB/s | 220 MB/s |
| 3 transforms (4KB x 500) | 382 MB/s | 369 MB/s | 296 MB/s |

The sync path is 1.5-1.8x faster than async for small/tiny chunks because
it eliminates all Promise and microtask overhead. For compute-bound transforms
(XOR), the difference narrows to ~1x because the transform dominates.

### DX verdict: Natural

The `Sync` suffix convention is clear and mirrors Node.js patterns
(`readFileSync`, etc.). The API shape is identical — same `from`, `pull`,
`bytes` composition, just with `Sync` appended. Users can choose based on
their data source without learning a different API.

---

## 7. High water mark tuning

### Recommendation

The default HWM is 4 for push streams and 16 for broadcast/share. HWM = 1 is
the only value that measurably hurts performance.

### Benchmark evidence (push, strict policy, 2000 x 4KB)

| HWM | Time |
|---|---|
| 1 | 2.23 ms |
| 4 | 1.35 ms |
| 16 | 1.34 ms |
| 64 | 1.35 ms |
| 256 | 1.33 ms |
| 1024 | 1.38 ms |

Performance is flat from HWM = 4 onwards. HWM = 1 is 1.7x slower because
every write must wait for the consumer to drain before the next write can
proceed.

### Memory impact (sustained 100MB, push)

| HWM | Peak Heap |
|---|---|
| 1 | 4.4 MB |
| 4 | 1.7 MB |
| 16-1024 | 1.7 MB |

Counter-intuitively, HWM = 1 uses *more* peak heap because of the increased
number of in-flight Promise objects from constant backpressure signaling.

### DX verdict: Excellent

The default works well. Users don't need to think about HWM unless they have
a specific reason. The only foot-gun is explicitly setting HWM = 1, which
should be documented as a performance anti-pattern (it still works correctly,
just slower).

---

## 8. Backpressure policy selection

### For typical use: `strict` (default) or `block`

Both apply proper backpressure. `block` waits for space instead of rejecting;
slightly simpler error handling.

### For lossy real-time: `drop-oldest` or `drop-newest`

Dramatically faster when the consumer is slower than the producer.

### Benchmark evidence (slow consumer, HWM = 16)

| Policy | Time |
|---|---|
| strict | 13.3 ms |
| block | 13.4 ms |
| drop-oldest | 305 µs |
| drop-newest | 234 µs |

Drop policies are 45-57x faster because the producer never blocks.

### Memory (per-op, push 2000 x 4KB)

| Policy | Heap/iter |
|---|---|
| strict, HWM=4 | 1.70 MB |
| block, HWM=4 | 1.71 MB |
| drop-oldest, HWM=4 | 482 KB |
| drop-newest, HWM=4 | 487 KB |

### DX verdict: Excellent

Policy selection is a single string option. The semantics are clear and the
names are self-documenting. Users choose based on their use case, not
performance concerns — the performance difference is a natural consequence
of the chosen semantics.

---

## 9. `Stream.bytes()` vs manual iteration for large data

### Memory-efficient pattern

```ts
let total = 0;
for await (const batch of readable) {
  for (const chunk of batch) {
    total += chunk.byteLength;
    // process chunk immediately, don't accumulate
  }
}
```

### Convenient pattern

```ts
const all = await Stream.bytes(readable);
// process all data at once
```

### Memory evidence (sustained 100MB, pull + transform)

| Pattern | Peak Heap |
|---|---|
| Iteration (count bytes) | 2.4 MB |
| `Stream.bytes()` | ~100 MB (collects all data) |

`Stream.bytes()` must hold the entire stream contents in memory to concatenate
them. For large volumes, this dominates the memory profile.

### DX verdict: Natural tradeoff

This is the same tradeoff as `fs.readFile()` vs `fs.createReadStream()` — not
a DX problem, just a choice. `Stream.bytes()` is the right tool when you need
the complete data (e.g., HTTP response body, small file). Manual iteration is
the right tool for processing data incrementally.

The API could add streaming alternatives like `Stream.forEach(readable, fn)`
that process chunks without accumulating, but `for await` already fills this
role.

---

## 10. `pipeTo` vs manual read-transform-write loops

### Fast pattern

```ts
await Stream.pipeTo(source, transform, writer);
```

### Manual equivalent

```ts
for await (const batch of Stream.pull(source, transform)) {
  for (const chunk of batch) {
    await writer.write(chunk);
  }
}
await writer.end();
```

### Benchmark evidence

| Pattern | Throughput |
|---|---|
| `pipeTo` (new streams) | 36.4 GB/s |
| `pipeTo` (web streams) | 4.19 GB/s |

`pipeTo` is heavily optimized: it calls `writevSync` on the writer with entire
batches, avoiding per-chunk dispatch and Promise allocation. The manual loop
breaks batches apart and awaits each write individually.

### DX verdict: Excellent

`pipeTo` is both the fastest and the simplest pattern. One call replaces a
multi-line loop. There is no reason to write the manual version unless you need
custom per-chunk logic that can't be expressed as a transform.

---

## 11. Broadcast vs Share for multi-consumer scenarios

### Broadcast (push model)

```ts
const { writer, broadcast } = Stream.broadcast({ highWaterMark: 100 });
const c1 = broadcast.push();
const c2 = broadcast.push();
// producer writes to writer, consumers read from c1, c2
```

### Share (pull model)

```ts
const share = Stream.share(source);
const c1 = share.pull();
const c2 = share.pull();
// consumers pull from c1, c2; source is demand-driven
```

### Benchmark evidence (2 consumers, 4KB x 500)

| Pattern | Throughput |
|---|---|
| broadcast() | 1.92 GB/s |
| share() | 1.99 GB/s |
| Web tee() | 1.66 GB/s |

Performance is nearly identical. Both use a ring buffer internally.

### Memory (sustained 100MB, 2 consumers)

| Pattern | Peak Heap |
|---|---|
| broadcast | 2.4 MB |
| Web tee | 11.0 MB |

broadcast uses 4.6x less memory than web tee.

### DX verdict: Natural

The choice between broadcast and share is driven by whether you have a push
source (events, network) or a pull source (files, generators), not by
performance. Both are straightforward to use. Share is slightly simpler because
it doesn't require managing a separate writer.

---

## Summary: DX Impact Assessment

| Pattern | Perf Impact | DX Cost | Who Pays |
|---|---|---|---|
| Double-loop batch iteration | Critical (10-70x) | **Moderate** — every consumer | All users |
| Stateless vs generator transforms | Minor (17%) | None — stateless is simpler | Transform authors |
| Identity transforms near-free | Significant (35x) | None — enables cheap middleware | Framework authors |
| `writeSync` + `ondrain` | Moderate (1.5x) | **Significant** — complex pattern | Advanced users only |
| Full Writer sync methods | Significant (3x) | **Moderate** — 8 methods to impl | Writer/library authors |
| Sync APIs (`pullSync`, etc.) | Moderate (1.5-1.8x) | None — mirror async shape | All users (opt-in) |
| HWM tuning | Minor (flat ≥ 4) | None — default works | Nobody |
| Backpressure policy | Major (45-57x) | None — one option string | All users (opt-in) |
| `bytes()` vs iteration | Memory only | None — natural tradeoff | All users |
| `pipeTo` | Major (fastest path) | None — simplest pattern | All users |
| broadcast vs share | Negligible | None — driven by use case | All users |

### Patterns where users jump through hoops for performance

1. **The double-loop** is the only pattern that affects every user doing manual
   iteration and has meaningful DX cost. It's the core architectural tradeoff:
   batching enables the performance advantage but leaks into every consumer
   that uses `for await`. However, built-in consumers (`bytes()`, `text()`,
   `array()`, `pipeTo()`) handle batches internally, so users who collect or
   pipe data never encounter it. Possible mitigations (`forEach`, `unbatch`)
   are discussed in section 1 above.

2. **`writeSync` + `ondrain`** is complex but only relevant for push stream
   producers writing at high frequency. Most code should use `await write()`.

3. **Full Writer implementation** is verbose but only affects library authors
   building sinks. The sync method stubs (`return false`) provide a clean
   opt-out.

Everything else — sync APIs, backpressure policies, `pipeTo`, transform
authoring — achieves good performance through natural, straightforward patterns.
