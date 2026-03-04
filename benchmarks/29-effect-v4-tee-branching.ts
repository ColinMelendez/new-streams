/**
 * Benchmark: Share/Branching Performance — effect/Stream v4 beta
 *
 * Mirrors 05-tee-branching.ts using effect v4 (installed as "effect-v4").
 * Adds Node.js PassThrough fan-out as a third implementation for 4-way comparison.
 *
 * New API:    Uses share() for pull-model multi-consumer
 * Web Streams: Uses tee() for branching
 * Node.js:    Uses Readable.pipe() to two PassThrough streams
 * Effect v4:  Uses two Queue.bounded + a forked producer that offers each chunk
 *             to both queues (closest idiomatic equivalent to tee/share)
 */

import { Stream, Effect, Queue, Fiber } from 'effect-v4';
import { Stream as NewStream } from '../src/index.js';
import type { Transform } from '../src/index.js';
import { Readable, PassThrough, Transform as NodeTransform } from 'node:stream';
import {
  benchmark,
  createEffectComparison,
  EffectComparison,
  printEffectComparison,
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

// ── benchmarks ───────────────────────────────────────────────────────────────

async function runBenchmarks(): Promise<EffectComparison[]> {
  const comparisons: EffectComparison[] = [];

  // ============================================================================
  // Scenario 1: Single fan-out (2 consumers)
  // ============================================================================
  console.log('Running: Single fan-out (2 consumers)...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
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

        const [branch1, branch2] = source.tee();
        const [result1, result2] = await Promise.all([
          collectWebStreamBytes(branch1),
          collectWebStreamBytes(branch2),
        ]);

        if (result1.length !== totalBytes || result2.length !== totalBytes) {
          throw new Error('Wrong size');
        }
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

        const pt1 = new PassThrough();
        const pt2 = new PassThrough();

        // Register collectors before piping to avoid missing events
        const p1 = collectNodeStreamBytes(pt1);
        const p2 = collectNodeStreamBytes(pt2);
        source.pipe(pt1);
        source.pipe(pt2);

        const [result1, result2] = await Promise.all([p1, p2]);
        if (result1.length !== totalBytes || result2.length !== totalBytes) {
          throw new Error('Wrong size');
        }
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect v4 Stream',
      async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const queue1 = yield* Queue.bounded<Uint8Array>(100);
            const queue2 = yield* Queue.bounded<Uint8Array>(100);

            // Producer: offer each chunk to both queues sequentially
            const producer = yield* Effect.forkChild(
              Effect.forEach(
                chunks,
                (chunk) => Queue.offer(queue1, chunk).pipe(
                  Effect.flatMap(() => Queue.offer(queue2, chunk))
                ),
                { discard: true }
              )
            );

            // Consumer 2 forked; consumer 1 runs in main fiber
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
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Fan-out 2 readers (4KB x 500)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 2: Fan-out with different processing per branch
  // ============================================================================
  console.log('Running: Fan-out with transforms...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const source = NewStream.from(chunks);
        const shared = NewStream.share(source, { highWaterMark: 100 });

        const identity: Transform = (batch) => batch;
        const xorTransform: Transform = (batch) => {
          if (batch === null) return null;
          return batch.map(chunk => {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) result[i] = chunk[i] ^ 0x42;
            return result;
          });
        };

        const consumer1 = shared.pull(identity);
        const consumer2 = shared.pull(xorTransform);

        const [result1, result2] = await Promise.all([
          NewStream.bytes(consumer1),
          NewStream.bytes(consumer2),
        ]);

        if (result1.length !== totalBytes || result2.length !== totalBytes) {
          throw new Error('Wrong size');
        }
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

        const [branch1, branch2] = source.tee();

        const t1 = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) { controller.enqueue(chunk); },
        });
        const t2 = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) result[i] = chunk[i] ^ 0x42;
            controller.enqueue(result);
          },
        });

        const [result1, result2] = await Promise.all([
          collectWebStreamBytes(branch1.pipeThrough(t1)),
          collectWebStreamBytes(branch2.pipeThrough(t2)),
        ]);

        if (result1.length !== totalBytes || result2.length !== totalBytes) {
          throw new Error('Wrong size');
        }
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

        const pt1 = new PassThrough();
        // Branch 2 applies XOR via a NodeTransform
        const xor = new NodeTransform({
          transform(chunk: Uint8Array, _enc: string, callback: (err: null, data: Uint8Array) => void) {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) result[i] = chunk[i] ^ 0x42;
            callback(null, result);
          },
        });

        const p1 = collectNodeStreamBytes(pt1);
        const p2 = collectNodeStreamBytes(xor);
        source.pipe(pt1);
        source.pipe(xor);

        const [result1, result2] = await Promise.all([p1, p2]);
        if (result1.length !== totalBytes || result2.length !== totalBytes) {
          throw new Error('Wrong size');
        }
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect v4 Stream',
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

            // Consumer 2 (with XOR) forked
            const fiber2 = yield* Effect.forkChild(
              Stream.fromQueue(queue2).pipe(
                Stream.take(chunkCount),
                Stream.map((chunk) => {
                  const result = new Uint8Array(chunk.length);
                  for (let i = 0; i < chunk.length; i++) result[i] = chunk[i] ^ 0x42;
                  return result;
                }),
                Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
              )
            );

            // Consumer 1 (identity) in main fiber
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
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Fan-out + transforms (4KB x 500)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 3: Small chunks fan-out (stress test)
  // ============================================================================
  console.log('Running: Small chunks fan-out...');
  {
    const chunkSize = 256;
    const chunkCount = 5000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const source = NewStream.from(chunks);
        const shared = NewStream.share(source, { highWaterMark: 500 });

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

        const [branch1, branch2] = source.tee();
        const [result1, result2] = await Promise.all([
          collectWebStreamBytes(branch1),
          collectWebStreamBytes(branch2),
        ]);

        if (result1.length !== totalBytes || result2.length !== totalBytes) {
          throw new Error('Wrong size');
        }
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

        const pt1 = new PassThrough();
        const pt2 = new PassThrough();

        const p1 = collectNodeStreamBytes(pt1);
        const p2 = collectNodeStreamBytes(pt2);
        source.pipe(pt1);
        source.pipe(pt2);

        const [result1, result2] = await Promise.all([p1, p2]);
        if (result1.length !== totalBytes || result2.length !== totalBytes) {
          throw new Error('Wrong size');
        }
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect v4 Stream',
      async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const queue1 = yield* Queue.bounded<Uint8Array>(500);
            const queue2 = yield* Queue.bounded<Uint8Array>(500);

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

    comparisons.push(createEffectComparison(
      'Small chunks fan-out (256B x 5000)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  return comparisons;
}

// Main
console.log('Benchmark: Share/Branching Performance — effect/Stream v4 beta');
console.log('Comparing: New Streams (share), Web Streams (tee), Node.js (pipe→PassThrough), effect/Stream v4 (dual Queue)');
console.log('effect/Stream v4: Queue.bounded x2 + Effect.forkChild + Stream.fromQueue + Stream.take');
console.log('(minimum 15-20 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printEffectComparison)
  .catch(console.error);
