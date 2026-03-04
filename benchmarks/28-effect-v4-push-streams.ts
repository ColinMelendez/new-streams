/**
 * Benchmark: Push Stream Performance — effect/Stream v4 beta
 *
 * Mirrors 24-effect-push-streams.ts using effect v4 (installed as "effect-v4").
 * Key v4 API changes from v3:
 *   - Stream.runFold(() => 0, f)  — initial value is now a thunk
 *   - Stream.fromQueue has no options parameter (shutdown option removed)
 *   - Queue<A, E> adds error type parameter (defaults to never)
 */

import { Stream, Effect, Queue, Fiber } from 'effect-v4';
import { Stream as NewStream } from '../src/index.js';
import { PassThrough } from 'node:stream';
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
  // Scenario 1: Concurrent write/read (medium chunks)
  // ============================================================================
  console.log('Running: Concurrent push (medium chunks)...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 1000;
    const totalBytes = chunkSize * chunkCount;

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const chunks = generateChunks(chunkSize, chunkCount);
        const { writer, readable } = NewStream.push({ highWaterMark: 100 });

        const writePromise = (async () => {
          for (const chunk of chunks) await writer.write(chunk);
          await writer.end();
        })();

        const readPromise = (async () => {
          let total = 0;
          for await (const batch of readable) {
            for (const chunk of batch) total += chunk.length;
          }
          return total;
        })();

        const [, total] = await Promise.all([writePromise, readPromise]);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        const chunks = generateChunks(chunkSize, chunkCount);
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) { controller = c; },
        });

        const writePromise = (async () => {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
            await Promise.resolve();
          }
          controller.close();
        })();

        const readPromise = (async () => {
          const reader = stream.getReader();
          let total = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
          }
          return total;
        })();

        const [, total] = await Promise.all([writePromise, readPromise]);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        const chunks = generateChunks(chunkSize, chunkCount);
        const stream = new PassThrough({ highWaterMark: 100 * chunkSize });

        const writePromise = (async () => {
          for (const chunk of chunks) {
            const canContinue = stream.write(chunk);
            if (!canContinue) {
              await new Promise<void>((resolve) => stream.once('drain', resolve));
            }
          }
          stream.end();
        })();

        const readPromise = (async () => {
          let total = 0;
          for await (const chunk of stream) total += chunk.length;
          return total;
        })();

        const [, total] = await Promise.all([writePromise, readPromise]);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect v4 Stream',
      async () => {
        const chunks = generateChunks(chunkSize, chunkCount);
        const total = await Effect.runPromise(
          Effect.gen(function* () {
            const queue = yield* Queue.bounded<Uint8Array>(100);

            const producer = yield* Effect.forkChild(
              Effect.forEach(chunks, (chunk) => Queue.offer(queue, chunk), { discard: true })
            );

            const total = yield* Stream.fromQueue(queue).pipe(
              Stream.take(chunkCount),
              Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
            );

            yield* Fiber.join(producer);
            return total;
          })
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Concurrent push (4KB x 1000)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 2: Many small writes
  // ============================================================================
  console.log('Running: Many small writes...');
  {
    const chunkSize = 64;
    const chunkCount = 10000;
    const totalBytes = chunkSize * chunkCount;

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const chunks = generateChunks(chunkSize, chunkCount);
        const { writer, readable } = NewStream.push({ highWaterMark: 1000 });

        const writePromise = (async () => {
          for (const chunk of chunks) await writer.write(chunk);
          await writer.end();
        })();

        const readPromise = (async () => {
          let total = 0;
          for await (const batch of readable) {
            for (const chunk of batch) total += chunk.length;
          }
          return total;
        })();

        const [, total] = await Promise.all([writePromise, readPromise]);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        const chunks = generateChunks(chunkSize, chunkCount);
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) { controller = c; },
        });

        const writePromise = (async () => {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
            await Promise.resolve();
          }
          controller.close();
        })();

        const readPromise = (async () => {
          const reader = stream.getReader();
          let total = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
          }
          return total;
        })();

        const [, total] = await Promise.all([writePromise, readPromise]);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        const chunks = generateChunks(chunkSize, chunkCount);
        const stream = new PassThrough({ highWaterMark: 1000 * chunkSize });

        const writePromise = (async () => {
          for (const chunk of chunks) {
            const canContinue = stream.write(chunk);
            if (!canContinue) {
              await new Promise<void>((resolve) => stream.once('drain', resolve));
            }
          }
          stream.end();
        })();

        const readPromise = (async () => {
          let total = 0;
          for await (const chunk of stream) total += chunk.length;
          return total;
        })();

        const [, total] = await Promise.all([writePromise, readPromise]);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect v4 Stream',
      async () => {
        const chunks = generateChunks(chunkSize, chunkCount);
        const total = await Effect.runPromise(
          Effect.gen(function* () {
            const queue = yield* Queue.bounded<Uint8Array>(1000);

            const producer = yield* Effect.forkChild(
              Effect.forEach(chunks, (chunk) => Queue.offer(queue, chunk), { discard: true })
            );

            const total = yield* Stream.fromQueue(queue).pipe(
              Stream.take(chunkCount),
              Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
            );

            yield* Fiber.join(producer);
            return total;
          })
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Many small writes (64B x 10000)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 3: Batch writes (writev equivalent)
  // ============================================================================
  console.log('Running: Batch writes...');
  {
    const chunkSize = 512;
    const chunksPerBatch = 20;
    const batchCount = 200;
    const totalBytes = chunkSize * chunksPerBatch * batchCount;

    const generateBatches = () => {
      const batches: Uint8Array[][] = [];
      for (let i = 0; i < batchCount; i++) {
        batches.push(generateChunks(chunkSize, chunksPerBatch));
      }
      return batches;
    };

    const newStreamResult = await benchmark(
      'New Stream (writev)',
      async () => {
        const batches = generateBatches();
        const { writer, readable } = NewStream.push({ highWaterMark: 50 });

        const writePromise = (async () => {
          for (const batch of batches) await writer.writev(batch);
          await writer.end();
        })();

        const readPromise = (async () => {
          let total = 0;
          for await (const batch of readable) {
            for (const chunk of batch) total += chunk.length;
          }
          return total;
        })();

        const [, total] = await Promise.all([writePromise, readPromise]);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream (multi-enqueue)',
      async () => {
        const batches = generateBatches();
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) { controller = c; },
        });

        const writePromise = (async () => {
          for (const batch of batches) {
            for (const chunk of batch) controller.enqueue(chunk);
            await Promise.resolve();
          }
          controller.close();
        })();

        const readPromise = (async () => {
          const reader = stream.getReader();
          let total = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
          }
          return total;
        })();

        const [, total] = await Promise.all([writePromise, readPromise]);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream (cork/uncork)',
      async () => {
        const batches = generateBatches();
        const stream = new PassThrough({ highWaterMark: 50 * chunkSize * chunksPerBatch });

        const writePromise = (async () => {
          for (const batch of batches) {
            stream.cork();
            for (const chunk of batch) stream.write(chunk);
            stream.uncork();
            await Promise.resolve();
          }
          stream.end();
        })();

        const readPromise = (async () => {
          let total = 0;
          for await (const chunk of stream) total += chunk.length;
          return total;
        })();

        const [, total] = await Promise.all([writePromise, readPromise]);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect v4 Stream (Queue<batch>)',
      async () => {
        const batches = generateBatches();
        const total = await Effect.runPromise(
          Effect.gen(function* () {
            const queue = yield* Queue.bounded<Uint8Array[]>(50);

            const producer = yield* Effect.forkChild(
              Effect.forEach(batches, (batch) => Queue.offer(queue, batch), { discard: true })
            );

            const total = yield* Stream.fromQueue(queue).pipe(
              Stream.take(batchCount),
              Stream.flatMap((batch) => Stream.fromIterable(batch)),
              Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
            );

            yield* Fiber.join(producer);
            return total;
          })
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Batch writes (512B x 20 x 200)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 4: Push + async iteration
  // ============================================================================
  console.log('Running: Push + async iteration...');
  {
    const chunkSize = 2 * 1024;
    const chunkCount = 1000;
    const totalBytes = chunkSize * chunkCount;

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const chunks = generateChunks(chunkSize, chunkCount);
        const { writer, readable } = NewStream.push({ highWaterMark: 100 });

        const writePromise = (async () => {
          for (const chunk of chunks) await writer.write(chunk);
          await writer.end();
        })();

        let total = 0;
        for await (const batch of readable) {
          for (const chunk of batch) total += chunk.length;
        }
        await writePromise;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        const chunks = generateChunks(chunkSize, chunkCount);
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) { controller = c; },
        });

        const writePromise = (async () => {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
            await Promise.resolve();
          }
          controller.close();
        })();

        let total = 0;
        // @ts-ignore - Node.js supports async iteration over ReadableStream
        for await (const chunk of stream) total += chunk.length;
        await writePromise;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        const chunks = generateChunks(chunkSize, chunkCount);
        const stream = new PassThrough({ highWaterMark: 100 * chunkSize });

        const writePromise = (async () => {
          for (const chunk of chunks) {
            const canContinue = stream.write(chunk);
            if (!canContinue) {
              await new Promise<void>((resolve) => stream.once('drain', resolve));
            }
          }
          stream.end();
        })();

        let total = 0;
        for await (const chunk of stream) total += chunk.length;
        await writePromise;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect v4 Stream',
      async () => {
        const chunks = generateChunks(chunkSize, chunkCount);
        const total = await Effect.runPromise(
          Effect.gen(function* () {
            const queue = yield* Queue.bounded<Uint8Array>(100);

            const producer = yield* Effect.forkChild(
              Effect.forEach(chunks, (chunk) => Queue.offer(queue, chunk), { discard: true })
            );

            const total = yield* Stream.fromQueue(queue).pipe(
              Stream.take(chunkCount),
              Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
            );

            yield* Fiber.join(producer);
            return total;
          })
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Push + async iter (2KB x 1000)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  return comparisons;
}

// Main
console.log('Benchmark: Push Stream Performance — effect/Stream v4 beta');
console.log('Comparing: New Streams, Web Streams, Node.js Streams, effect/Stream v4');
console.log('effect/Stream v4: Queue.bounded + Effect.forkChild + Stream.fromQueue + Stream.take');
console.log('(minimum 15-20 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printEffectComparison)
  .catch(console.error);
