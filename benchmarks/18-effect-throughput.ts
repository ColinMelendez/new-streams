/**
 * Benchmark: Raw Throughput — effect/Stream
 *
 * Mirrors 01-throughput.ts, adding effect/Stream as a fourth implementation.
 * Shows how effect/Stream's Effect runtime overhead compares to the other APIs
 * across different chunk sizes and consumption patterns.
 *
 * effect/Stream uses:
 *   Stream.fromIterable()   — create from array of chunks
 *   Stream.runFold()        — count bytes (equivalent to async iteration)
 *   Stream.runCollect()     — collect all chunks (equivalent to bytes())
 *   Stream.fromAsyncIterable() — create from async generator
 */

import { Stream, Effect, Chunk } from 'effect';
import { Stream as NewStream } from '../src/index.js';
import { Readable } from 'node:stream';
import {
  benchmark,
  createEffectComparison,
  EffectComparison,
  printEffectComparison,
  generateChunks,
} from './utils.js';

// ── helpers ──────────────────────────────────────────────────────────────────

async function collectWebStreamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

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

async function runBenchmarks(): Promise<EffectComparison[]> {
  const comparisons: EffectComparison[] = [];

  // ============================================================================
  // Scenario 1: Large chunks (64KB each) — bytes collection
  // ============================================================================
  console.log('Running: Large chunks...');
  {
    const chunkSize = 64 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const result = await NewStream.bytes(NewStream.from(chunks));
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        let index = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else controller.close();
          },
        });
        const result = await collectWebStreamBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        let index = 0;
        const stream = new Readable({
          read() {
            if (index < chunks.length) this.push(chunks[index++]);
            else this.push(null);
          },
        });
        const result = await collectNodeStreamBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect Stream',
      async () => {
        const collected = Chunk.toArray(
          await Effect.runPromise(
            Stream.fromIterable(chunks).pipe(Stream.runCollect)
          )
        ) as Uint8Array[];
        const totalLen = collected.reduce((acc, c) => acc + c.length, 0);
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of collected) { result.set(chunk, offset); offset += chunk.length; }
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Large chunks (64KB x 500)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 2: Medium chunks (8KB each)
  // ============================================================================
  console.log('Running: Medium chunks...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 2000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const result = await NewStream.bytes(NewStream.from(chunks));
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        let index = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else controller.close();
          },
        });
        const result = await collectWebStreamBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        let index = 0;
        const stream = new Readable({
          read() {
            if (index < chunks.length) this.push(chunks[index++]);
            else this.push(null);
          },
        });
        const result = await collectNodeStreamBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect Stream',
      async () => {
        const collected = Chunk.toArray(
          await Effect.runPromise(
            Stream.fromIterable(chunks).pipe(Stream.runCollect)
          )
        ) as Uint8Array[];
        const totalLen = collected.reduce((acc, c) => acc + c.length, 0);
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of collected) { result.set(chunk, offset); offset += chunk.length; }
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Medium chunks (8KB x 2000)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 3: Small chunks (1KB each)
  // ============================================================================
  console.log('Running: Small chunks...');
  {
    const chunkSize = 1024;
    const chunkCount = 5000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const result = await NewStream.bytes(NewStream.from(chunks));
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        let index = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else controller.close();
          },
        });
        const result = await collectWebStreamBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        let index = 0;
        const stream = new Readable({
          read() {
            if (index < chunks.length) this.push(chunks[index++]);
            else this.push(null);
          },
        });
        const result = await collectNodeStreamBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect Stream',
      async () => {
        const collected = Chunk.toArray(
          await Effect.runPromise(
            Stream.fromIterable(chunks).pipe(Stream.runCollect)
          )
        ) as Uint8Array[];
        const totalLen = collected.reduce((acc, c) => acc + c.length, 0);
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of collected) { result.set(chunk, offset); offset += chunk.length; }
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Small chunks (1KB x 5000)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 4: Tiny chunks (100 bytes each)
  // ============================================================================
  console.log('Running: Tiny chunks...');
  {
    const chunkSize = 100;
    const chunkCount = 10000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const result = await NewStream.bytes(NewStream.from(chunks));
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        let index = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else controller.close();
          },
        });
        const result = await collectWebStreamBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        let index = 0;
        const stream = new Readable({
          read() {
            if (index < chunks.length) this.push(chunks[index++]);
            else this.push(null);
          },
        });
        const result = await collectNodeStreamBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect Stream',
      async () => {
        const collected = Chunk.toArray(
          await Effect.runPromise(
            Stream.fromIterable(chunks).pipe(Stream.runCollect)
          )
        ) as Uint8Array[];
        const totalLen = collected.reduce((acc, c) => acc + c.length, 0);
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of collected) { result.set(chunk, offset); offset += chunk.length; }
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Tiny chunks (100B x 10000)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 5: Async iteration / byte counting (no collection)
  // ============================================================================
  console.log('Running: Async iteration (byte count)...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 1000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const source = NewStream.from(chunks);
        let total = 0;
        for await (const batch of source) {
          for (const chunk of batch) total += chunk.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        let index = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else controller.close();
          },
        });
        let total = 0;
        // @ts-ignore - Node.js supports async iteration over ReadableStream
        for await (const chunk of stream) total += chunk.length;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        let index = 0;
        const stream = new Readable({
          read() {
            if (index < chunks.length) this.push(chunks[index++]);
            else this.push(null);
          },
        });
        let total = 0;
        for await (const chunk of stream) total += chunk.length;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect Stream',
      async () => {
        // effect/Stream doesn't support for-await directly; use runFold to count
        const total = await Effect.runPromise(
          Stream.fromIterable(chunks).pipe(
            Stream.runFold(0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Async iteration (8KB x 1000)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 6: Generator source
  // ============================================================================
  console.log('Running: Generator source...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 1000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        async function* source() { for (const c of chunks) yield c; }
        const stream = NewStream.from(source());
        let total = 0;
        for await (const batch of stream) {
          for (const chunk of batch) total += chunk.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        async function* source() { for (const c of chunks) yield c; }
        // @ts-ignore - ReadableStream.from exists in Node.js
        const stream = ReadableStream.from(source());
        let total = 0;
        // @ts-ignore
        for await (const chunk of stream) total += chunk.length;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        async function* source() { for (const c of chunks) yield c; }
        const stream = Readable.from(source());
        let total = 0;
        for await (const chunk of stream) total += chunk.length;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect Stream',
      async () => {
        async function* source() { for (const c of chunks) yield c; }
        const total = await Effect.runPromise(
          Stream.fromAsyncIterable(source(), (e) => new Error(String(e))).pipe(
            Stream.runFold(0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Generator source (8KB x 1000)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  return comparisons;
}

// Main
console.log('Benchmark: Raw Throughput — effect/Stream');
console.log('Comparing: New Streams, Web Streams, Node.js Streams, effect/Stream');
console.log('effect/Stream: Stream.fromIterable + Stream.runCollect / Stream.runFold');
console.log('(minimum 20 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printEffectComparison)
  .catch(console.error);
