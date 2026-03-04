/**
 * Benchmark: Advanced Features Performance — effect/Stream v4 beta
 *
 * Mirrors selected scenarios from 10-advanced-features.ts using effect v4.
 * Covers the scenarios that have meaningful Effect v4 equivalents:
 *
 *   Section 1: Fan-out (broadcast/share) — New API broadcast()/share() vs Effect dual-Queue fan-out
 *   Section 2: merge() — New API Stream.merge() vs Effect concurrent flatMap
 *   Section 3: pipeTo() — New API Stream.pipeTo() vs Effect Stream.runFold()
 *
 * Effect v4 key patterns:
 *   - Fan-out:  Queue.bounded x2 + Effect.forkChild for concurrent writes to both queues
 *   - merge():  Stream.fromArray([s1, s2]).pipe(Stream.flatMap(s => s, { concurrency: "unbounded" }))
 *   - pipeTo(): Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
 */

import { Stream, Effect, Queue, Fiber } from 'effect-v4';
import { Stream as NewStream } from '../src/index.js';
import type { Transform, Writer, WriteOptions } from '../src/index.js';
import { Readable, PassThrough, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  benchmark,
  createEffectComparison,
  createComparison,
  EffectComparison,
  BenchmarkComparison,
  printEffectComparison,
  printComparison,
  generateChunks,
} from './utils.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function collectNodeStreamBytes(stream: Readable): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  const { promise, resolve } = Promise.withResolvers<Uint8Array>();
  stream.on('data', (chunk: Uint8Array) => { chunks.push(chunk); totalLength += chunk.length; });
  stream.on('end', () => {
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    resolve(result);
  });
  return promise;
}

// ── benchmarks ───────────────────────────────────────────────────────────────

async function runBenchmarks(): Promise<void> {
  const effectComparisons: EffectComparison[] = [];
  const twoWayComparisons: BenchmarkComparison[] = [];

  // ============================================================================
  // Section 1: Fan-out (broadcast/share equivalent)
  //
  // New API: broadcast() and share() each fan out to 2 consumers.
  // Effect v4: dual Queue.bounded with a forked producer that offers each chunk
  //            to both queues concurrently (closest equivalent to broadcast).
  // ============================================================================
  console.log('\n--- Section 1: Fan-out (broadcast/share equivalent) ---');

  // Scenario 1a: Push-model fan-out (2 consumers)
  console.log('Running: push-model fan-out (2 consumers)...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    // New Stream: broadcast() is the push model (producer drives)
    const broadcastResult = await benchmark(
      'New Stream broadcast()',
      async () => {
        const { writer, broadcast } = NewStream.broadcast({ highWaterMark: 1000 });

        const consumer1 = broadcast.push();
        const consumer2 = broadcast.push();

        const producerTask = (async () => {
          for (const chunk of chunks) await writer.write(chunk);
          await writer.end();
        })();

        const [result1, result2] = await Promise.all([
          NewStream.bytes(consumer1),
          NewStream.bytes(consumer2),
          producerTask,
        ]);

        if (result1.length !== totalBytes || result2.length !== totalBytes) {
          throw new Error('Wrong size');
        }
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    // Effect v4: dual Queue (push model — producer drives)
    const effectResult = await benchmark(
      'Effect v4 Stream (dual Queue)',
      async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const queue1 = yield* Queue.bounded<Uint8Array>(1000);
            const queue2 = yield* Queue.bounded<Uint8Array>(1000);

            const producer = yield* Effect.forkChild(
              Effect.forEach(
                chunks,
                (chunk) => Queue.offer(queue1, chunk).pipe(
                  Effect.flatMap(() => Queue.offer(queue2, chunk))
                ),
                { discard: true }
              )
            );

            const fiber2 = yield* Effect.forkChild(
              Stream.fromQueue(queue2).pipe(
                Stream.take(chunkCount),
                Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
              )
            );

            const r1 = yield* Stream.fromQueue(queue1).pipe(
              Stream.take(chunkCount),
              Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
            );

            const r2 = yield* Fiber.join(fiber2);
            yield* Fiber.join(producer);

            if (r1 !== totalBytes || r2 !== totalBytes) throw new Error('Wrong size');
          })
        );
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    twoWayComparisons.push(createComparison(
      'Push fan-out 2 consumers (4KB x 500)',
      broadcastResult, effectResult,
      { label1: 'New broadcast()', label2: 'Effect dual Queue' }
    ));
  }

  // Scenario 1b: Pull-model fan-out (2 consumers)
  console.log('Running: pull-model fan-out (2 consumers)...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    // New Stream: share() is the pull model (consumers drive)
    const shareResult = await benchmark(
      'New Stream share()',
      async () => {
        const source = NewStream.from(chunks);
        const shared = NewStream.share(source, { highWaterMark: 100 });

        const consumer1 = shared.pull();
        const consumer2 = shared.pull();

        const [result1, result2] = await Promise.all([
          NewStream.bytes(consumer1),
          NewStream.bytes(consumer2),
        ]);

        if (result1.length !== totalBytes || result2.length !== totalBytes) {
          throw new Error('Wrong size');
        }
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    // Effect v4: dual Queue with modest capacity (pull-like — producer backs off when queues full)
    const effectResult = await benchmark(
      'Effect v4 Stream (dual Queue)',
      async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const queue1 = yield* Queue.bounded<Uint8Array>(100);
            const queue2 = yield* Queue.bounded<Uint8Array>(100);

            const producer = yield* Effect.forkChild(
              Effect.forEach(
                chunks,
                (chunk) => Queue.offer(queue1, chunk).pipe(
                  Effect.flatMap(() => Queue.offer(queue2, chunk))
                ),
                { discard: true }
              )
            );

            const fiber2 = yield* Effect.forkChild(
              Stream.fromQueue(queue2).pipe(
                Stream.take(chunkCount),
                Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
              )
            );

            const r1 = yield* Stream.fromQueue(queue1).pipe(
              Stream.take(chunkCount),
              Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
            );

            const r2 = yield* Fiber.join(fiber2);
            yield* Fiber.join(producer);

            if (r1 !== totalBytes || r2 !== totalBytes) throw new Error('Wrong size');
          })
        );
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    twoWayComparisons.push(createComparison(
      'Pull fan-out 2 consumers (4KB x 500)',
      shareResult, effectResult,
      { label1: 'New share()', label2: 'Effect dual Queue' }
    ));
  }

  // ============================================================================
  // Section 2: merge() — combining multiple streams
  //
  // New API: Stream.merge(source1, source2) natively merges concurrent streams.
  // Web Streams: manual merge via Promise.race pattern (no native merge).
  // Node.js: pipe two Readables to a shared PassThrough.
  // Effect v4: Stream.fromArray([s1, s2]) + Stream.flatMap with concurrency.
  // ============================================================================
  console.log('\n--- Section 2: merge() ---');

  // Scenario 2a: Merge 2 streams
  console.log('Running: merge() 2 streams...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 250; // per stream
    const totalBytes = chunkSize * chunkCount * 2;
    const chunks1 = generateChunks(chunkSize, chunkCount);
    const chunks2 = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const source1 = NewStream.from(chunks1);
        const source2 = NewStream.from(chunks2);
        const merged = NewStream.merge(source1, source2);
        const result = await NewStream.bytes(merged);
        if (result.length !== totalBytes) throw new Error(`Wrong size: ${result.length}`);
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        let i1 = 0, i2 = 0;
        const stream1 = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (i1 < chunks1.length) controller.enqueue(chunks1[i1++]);
            else controller.close();
          },
        });
        const stream2 = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (i2 < chunks2.length) controller.enqueue(chunks2[i2++]);
            else controller.close();
          },
        });

        // Manual merge using Promise.race
        const reader1 = stream1.getReader();
        const reader2 = stream2.getReader();
        const collected: Uint8Array[] = [];
        let done1 = false, done2 = false;
        let pending1: Promise<{ which: 1; r: ReadableStreamReadResult<Uint8Array> }> | null = null;
        let pending2: Promise<{ which: 2; r: ReadableStreamReadResult<Uint8Array> }> | null = null;

        while (!done1 || !done2) {
          if (!done1 && !pending1) pending1 = reader1.read().then(r => ({ which: 1, r }));
          if (!done2 && !pending2) pending2 = reader2.read().then(r => ({ which: 2, r }));

          const active = [pending1, pending2].filter(Boolean) as Promise<{ which: 1 | 2; r: ReadableStreamReadResult<Uint8Array> }>[];
          if (active.length === 0) break;

          const { which, r } = await Promise.race(active);
          if (r.done) {
            if (which === 1) { done1 = true; pending1 = null; }
            else { done2 = true; pending2 = null; }
          } else {
            collected.push(r.value);
            if (which === 1) pending1 = null; else pending2 = null;
          }
        }

        let total = 0;
        for (const c of collected) total += c.length;
        if (total !== totalBytes) throw new Error(`Wrong size: ${total}`);
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        let i1 = 0, i2 = 0;
        const source1 = new Readable({ read() { if (i1 < chunks1.length) this.push(chunks1[i1++]); else this.push(null); } });
        const source2 = new Readable({ read() { if (i2 < chunks2.length) this.push(chunks2[i2++]); else this.push(null); } });

        const merged = new PassThrough();
        let done = 0;
        const onEnd = () => { if (++done === 2) merged.end(); };
        source1.on('end', onEnd);
        source2.on('end', onEnd);
        source1.pipe(merged, { end: false });
        source2.pipe(merged, { end: false });

        let total = 0;
        for await (const chunk of merged) total += (chunk as Buffer).length;
        if (total !== totalBytes) throw new Error(`Wrong size: ${total}`);
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect v4 Stream',
      async () => {
        // Merge by creating a stream of streams and flattening with full concurrency
        const total = await Effect.runPromise(
          Stream.fromArray([Stream.fromArray(chunks1), Stream.fromArray(chunks2)]).pipe(
            Stream.flatMap((s) => s, { concurrency: 'unbounded' }),
            Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== totalBytes) throw new Error(`Wrong size: ${total}`);
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    effectComparisons.push(createEffectComparison(
      'merge() 2 streams (4KB x 250 each)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // Scenario 2b: Merge 4 streams
  console.log('Running: merge() 4 streams...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 125; // per stream
    const totalBytes = chunkSize * chunkCount * 4;
    const allChunks = [
      generateChunks(chunkSize, chunkCount),
      generateChunks(chunkSize, chunkCount),
      generateChunks(chunkSize, chunkCount),
      generateChunks(chunkSize, chunkCount),
    ];

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const sources = allChunks.map(c => NewStream.from(c));
        const merged = NewStream.merge(...sources);
        const result = await NewStream.bytes(merged);
        if (result.length !== totalBytes) throw new Error(`Wrong size: ${result.length}`);
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        const readers = allChunks.map((chunks) => {
          let idx = 0;
          return new ReadableStream<Uint8Array>({
            pull(c) { if (idx < chunks.length) c.enqueue(chunks[idx++]); else c.close(); },
          }).getReader();
        });

        let total = 0;
        const pending: (Promise<{ i: number; r: ReadableStreamReadResult<Uint8Array> }> | null)[] = new Array(4).fill(null);
        const done = new Array(4).fill(false);

        while (done.some(d => !d)) {
          for (let i = 0; i < 4; i++) {
            if (!done[i] && !pending[i]) {
              pending[i] = readers[i].read().then(r => ({ i, r }));
            }
          }
          const active = pending.filter(Boolean) as Promise<{ i: number; r: ReadableStreamReadResult<Uint8Array> }>[];
          if (active.length === 0) break;
          const { i, r } = await Promise.race(active);
          if (r.done) { done[i] = true; pending[i] = null; }
          else { total += r.value.length; pending[i] = null; }
        }
        if (total !== totalBytes) throw new Error(`Wrong size: ${total}`);
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        const sources = allChunks.map((chunks) => {
          let idx = 0;
          return new Readable({ read() { if (idx < chunks.length) this.push(chunks[idx++]); else this.push(null); } });
        });

        const merged = new PassThrough();
        let done = 0;
        const onEnd = () => { if (++done === 4) merged.end(); };
        for (const s of sources) {
          s.on('end', onEnd);
          s.pipe(merged, { end: false });
        }

        let total = 0;
        for await (const chunk of merged) total += (chunk as Buffer).length;
        if (total !== totalBytes) throw new Error(`Wrong size: ${total}`);
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect v4 Stream',
      async () => {
        const total = await Effect.runPromise(
          Stream.fromArray(allChunks.map(c => Stream.fromArray(c))).pipe(
            Stream.flatMap((s) => s, { concurrency: 'unbounded' }),
            Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== totalBytes) throw new Error(`Wrong size: ${total}`);
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    effectComparisons.push(createEffectComparison(
      'merge() 4 streams (4KB x 125 each)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Section 3: pipeTo() equivalent
  //
  // New API: Stream.pipeTo(source, writer) — pushes all chunks to a Writer.
  // Web Streams: source.pipeTo(writable) — pushes all chunks to a WritableStream.
  // Node.js: pipeline(source, dest) — pushes all chunks to a Writable.
  // Effect v4: Stream.runFold() — folds over all chunks (equivalent byte-counting sink).
  // ============================================================================
  console.log('\n--- Section 3: pipeTo() equivalent ---');

  console.log('Running: pipeTo() comparison...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    // Minimal Writer implementation for New Stream
    class CountingWriter implements Writer {
      totalBytes = 0;
      closed = false;
      get desiredSize(): number | null { return this.closed ? null : 16; }
      async write(chunk: Uint8Array | string, _options?: WriteOptions): Promise<void> {
        this.totalBytes += typeof chunk === 'string' ? chunk.length : chunk.byteLength;
      }
      async writev(chunks: (Uint8Array | string)[], _options?: WriteOptions): Promise<void> {
        for (const c of chunks) await this.write(c);
      }
      writeSync(chunk: Uint8Array | string): boolean {
        this.totalBytes += typeof chunk === 'string' ? chunk.length : chunk.byteLength;
        return true;
      }
      writevSync(chunks: (Uint8Array | string)[]): boolean {
        for (const c of chunks) this.writeSync(c);
        return true;
      }
      async end(_options?: WriteOptions): Promise<number> { this.closed = true; return this.totalBytes; }
      endSync(): number { this.closed = true; return this.totalBytes; }
      async fail(): Promise<void> { this.closed = true; }
      failSync(): boolean { this.closed = true; return true; }
    }

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const source = NewStream.from(chunks);
        const writer = new CountingWriter();
        const bytes = await NewStream.pipeTo(source, writer);
        if (bytes !== totalBytes) throw new Error(`Wrong size: ${bytes}`);
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        let index = 0;
        const source = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else controller.close();
          },
        });

        let totalWritten = 0;
        const sink = new WritableStream<Uint8Array>({
          write(chunk) { totalWritten += chunk.byteLength; },
        });

        await source.pipeTo(sink);
        if (totalWritten !== totalBytes) throw new Error(`Wrong size: ${totalWritten}`);
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        let index = 0;
        const source = new Readable({
          read() {
            if (index < chunks.length) this.push(chunks[index++]);
            else this.push(null);
          },
        });

        let totalWritten = 0;
        const dest = new Writable({
          write(chunk, _enc, callback) { totalWritten += chunk.length; callback(); },
        });

        await pipeline(source, dest);
        if (totalWritten !== totalBytes) throw new Error(`Wrong size: ${totalWritten}`);
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect v4 Stream',
      async () => {
        // runFold is the idiomatic Effect equivalent of piping to a counting sink
        const total = await Effect.runPromise(
          Stream.fromArray(chunks).pipe(
            Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== totalBytes) throw new Error(`Wrong size: ${total}`);
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    effectComparisons.push(createEffectComparison(
      'pipeTo / runFold sink (4KB x 500)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Print Results
  // ============================================================================
  if (twoWayComparisons.length > 0) {
    printComparison(twoWayComparisons);
  }

  if (effectComparisons.length > 0) {
    printEffectComparison(effectComparisons);
  }
}

// Main
console.log('Benchmark: Advanced Features Performance — effect/Stream v4 beta');
console.log('Tests: fan-out (broadcast/share), merge(), pipeTo() equivalent');
console.log('Comparing: New Streams, Web Streams, Node.js Streams, effect/Stream v4');
console.log('(minimum 15 samples, 3 seconds per test)\n');

runBenchmarks().catch(console.error);
