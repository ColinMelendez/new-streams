/**
 * Benchmark: Transform Performance — effect/Stream
 *
 * Mirrors 03-transforms.ts, adding effect/Stream as a fourth implementation.
 * Shows how effect/Stream's transform operators compare to other APIs.
 *
 * effect/Stream transforms used:
 *   Stream.map()            — element-wise transform (identity, XOR, chained)
 *   Stream.mapConcatChunk() — expanding transform (1:2); maps each element to a
 *                             Chunk and flattens. More efficient than flatMap for
 *                             simple expansion because it avoids creating a sub-
 *                             stream (and its associated fiber/scope machinery)
 *                             per element.
 *   Stream.mapEffect()      — async transform via Effect
 */

import { Stream, Effect, Chunk } from 'effect';
import { Stream as NewStream } from '../src/index.js';
import type { Transform } from '../src/index.js';
import { Readable, Transform as NodeTransform } from 'node:stream';
import {
  benchmark,
  createEffectComparison,
  EffectComparison,
  printEffectComparison,
  generateChunks,
} from './utils.js';

async function runBenchmarks(): Promise<EffectComparison[]> {
  const comparisons: EffectComparison[] = [];

  // ============================================================================
  // Scenario 1: Identity transform (pass-through baseline)
  // ============================================================================
  console.log('Running: Identity transform...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 1000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const identity: Transform = (batch) => batch;
        let total = 0;
        for await (const batch of NewStream.pull(NewStream.from(chunks), identity)) {
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
        const source = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else controller.close();
          },
        });
        const transform = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) { controller.enqueue(chunk); },
        });
        const reader = source.pipeThrough(transform).getReader();
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
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
        const transform = new NodeTransform({
          transform(chunk, _enc, callback) { callback(null, chunk); },
        });
        const piped = source.pipe(transform);
        let total = 0;
        for await (const chunk of piped) total += chunk.length;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect Stream',
      async () => {
        const total = await Effect.runPromise(
          Stream.fromIterable(chunks).pipe(
            Stream.map((chunk) => chunk),
            Stream.runFold(0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Identity transform (8KB x 1000)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 2: Byte manipulation (XOR)
  // ============================================================================
  console.log('Running: XOR transform...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);
    const xorKey = 0x42;

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const xorTransform: Transform = (batch) => {
          if (batch === null) return null;
          return batch.map((chunk) => {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) result[i] = chunk[i] ^ xorKey;
            return result;
          });
        };
        let total = 0;
        for await (const batch of NewStream.pull(NewStream.from(chunks), xorTransform)) {
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
        const source = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else controller.close();
          },
        });
        const transform = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) result[i] = chunk[i] ^ xorKey;
            controller.enqueue(result);
          },
        });
        const reader = source.pipeThrough(transform).getReader();
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
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
        const transform = new NodeTransform({
          transform(chunk, _enc, callback) {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) result[i] = chunk[i] ^ xorKey;
            callback(null, result);
          },
        });
        const piped = source.pipe(transform);
        let total = 0;
        for await (const chunk of piped) total += chunk.length;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect Stream',
      async () => {
        const total = await Effect.runPromise(
          Stream.fromIterable(chunks).pipe(
            Stream.map((chunk) => {
              const result = new Uint8Array(chunk.length);
              for (let i = 0; i < chunk.length; i++) result[i] = chunk[i] ^ xorKey;
              return result;
            }),
            Stream.runFold(0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'XOR transform (8KB x 500)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 3: Expanding transform (1:2) — each chunk emitted twice
  // ============================================================================
  console.log('Running: Expanding transform...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 500;
    const inputBytes = chunkSize * chunkCount;
    const outputBytes = inputBytes * 2;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const expandTransform: Transform = function* (batch) {
          if (batch === null) return;
          for (const chunk of batch) { yield chunk; yield chunk; }
        };
        let total = 0;
        for await (const batch of NewStream.pull(NewStream.from(chunks), expandTransform)) {
          for (const chunk of batch) total += chunk.length;
        }
        if (total !== outputBytes) throw new Error('Wrong size');
      },
      { totalBytes: outputBytes, minSamples: 20, minTimeMs: 3000 }
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
        const transform = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
            controller.enqueue(chunk);
          },
        });
        const reader = source.pipeThrough(transform).getReader();
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.length;
        }
        if (total !== outputBytes) throw new Error('Wrong size');
      },
      { totalBytes: outputBytes, minSamples: 20, minTimeMs: 3000 }
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
        const transform = new NodeTransform({
          transform(chunk, _enc, callback) {
            this.push(chunk);
            this.push(chunk);
            callback();
          },
        });
        const piped = source.pipe(transform);
        let total = 0;
        for await (const chunk of piped) total += chunk.length;
        if (total !== outputBytes) throw new Error('Wrong size');
      },
      { totalBytes: outputBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect Stream',
      async () => {
        // mapConcatChunk maps each element to a Chunk and flattens inline —
        // no sub-stream creation, unlike flatMap(chunk => Stream.make(a, b)).
        const total = await Effect.runPromise(
          Stream.fromIterable(chunks).pipe(
            Stream.mapConcatChunk((chunk) => Chunk.make(chunk, chunk)),
            Stream.runFold(0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== outputBytes) throw new Error('Wrong size');
      },
      { totalBytes: outputBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Expanding 1:2 (4KB x 500)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 4: Chained transforms (3 identity stages)
  // ============================================================================
  console.log('Running: Chained transforms...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const identity: Transform = (batch) => batch;
        const pipeline = NewStream.pull(NewStream.from(chunks), identity, identity, identity);
        let total = 0;
        for await (const batch of pipeline) {
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
        const source = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else controller.close();
          },
        });
        const makeT = () =>
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) { controller.enqueue(chunk); },
          });
        const reader = source.pipeThrough(makeT()).pipeThrough(makeT()).pipeThrough(makeT()).getReader();
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
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
        const makeT = () =>
          new NodeTransform({ transform(chunk, _enc, cb) { cb(null, chunk); } });
        const piped = source.pipe(makeT()).pipe(makeT()).pipe(makeT());
        let total = 0;
        for await (const chunk of piped) total += chunk.length;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect Stream',
      async () => {
        const total = await Effect.runPromise(
          Stream.fromIterable(chunks).pipe(
            Stream.map((chunk) => chunk),
            Stream.map((chunk) => chunk),
            Stream.map((chunk) => chunk),
            Stream.runFold(0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Chained 3x (8KB x 500)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 5: Async transform (Promise per element)
  // ============================================================================
  console.log('Running: Async transform...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 300;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const asyncIdentity: Transform = async (batch) => {
          await Promise.resolve();
          return batch;
        };
        let total = 0;
        for await (const batch of NewStream.pull(NewStream.from(chunks), asyncIdentity)) {
          for (const chunk of batch) total += chunk.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
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
        const transform = new TransformStream<Uint8Array, Uint8Array>({
          async transform(chunk, controller) {
            await Promise.resolve();
            controller.enqueue(chunk);
          },
        });
        const reader = source.pipeThrough(transform).getReader();
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
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
        const transform = new NodeTransform({
          async transform(chunk, _enc, callback) {
            await Promise.resolve();
            callback(null, chunk);
          },
        });
        const piped = source.pipe(transform);
        let total = 0;
        for await (const chunk of piped) total += chunk.length;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect Stream',
      async () => {
        // Stream.mapEffect runs an effectful (potentially async) transform per element
        const total = await Effect.runPromise(
          Stream.fromIterable(chunks).pipe(
            Stream.mapEffect((chunk) => Effect.promise(() => Promise.resolve(chunk))),
            Stream.runFold(0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Async transform (8KB x 300)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 6: Async transform — batch-level (grouped)
  //
  // Mirrors Scenario 5, but all implementations apply one async operation per
  // batch rather than per element. For Effect, Stream.grouped(n) collects n
  // elements into a Chunk before mapEffect fires, matching the batch-level
  // semantics that New Streams uses natively.
  // ============================================================================
  console.log('Running: Async transform (grouped)...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 300;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    // New Streams: already operates at batch level — identical to Scenario 5
    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const asyncIdentity: Transform = async (batch) => {
          await Promise.resolve();
          return batch;
        };
        let total = 0;
        for await (const batch of NewStream.pull(NewStream.from(chunks), asyncIdentity)) {
          for (const chunk of batch) total += chunk.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    // Web Streams: manually buffer all chunks, one async suspension in flush
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
        const buffer: Uint8Array[] = [];
        const transform = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, _controller) { buffer.push(chunk); },
          async flush(controller) {
            await Promise.resolve();
            for (const chunk of buffer) controller.enqueue(chunk);
          },
        });
        const reader = source.pipeThrough(transform).getReader();
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    // Node Streams: manually buffer all chunks, one async suspension in flush
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
        const buf: Uint8Array[] = [];
        const transform = new NodeTransform({
          transform(chunk, _enc, callback) { buf.push(chunk); callback(); },
          flush(callback) {
            Promise.resolve().then(() => {
              for (const chunk of buf) this.push(chunk);
              callback();
            });
          },
        });
        const piped = source.pipe(transform);
        let total = 0;
        for await (const chunk of piped) total += chunk.length;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    // Effect: Stream.grouped(n) collects n elements into a Chunk, then
    // mapEffect fires once per group — one async suspension for all 300 chunks.
    const effectStreamResult = await benchmark(
      'Effect Stream',
      async () => {
        const total = await Effect.runPromise(
          Stream.fromIterable(chunks).pipe(
            Stream.grouped(chunkCount),
            Stream.mapEffect((group) => Effect.promise(() => Promise.resolve(group))),
            Stream.mapConcatChunk((group) => group),
            Stream.runFold(0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Async transform grouped',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  return comparisons;
}

// Main
console.log('Benchmark: Transform Performance — effect/Stream');
console.log('Comparing: New Streams, Web Streams, Node.js Streams, effect/Stream');
console.log('effect/Stream: Stream.map, Stream.mapConcatChunk, Stream.mapEffect');
console.log('(minimum 15-20 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printEffectComparison)
  .catch(console.error);
