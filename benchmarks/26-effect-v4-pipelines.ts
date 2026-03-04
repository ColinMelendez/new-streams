/**
 * Benchmark: Pipeline Performance — effect/Stream v4 beta
 *
 * Mirrors 20-effect-pipelines.ts using effect v4 (installed as "effect-v4").
 * Key API changes from v3 → v4:
 *   - Stream.fromArray()           instead of Stream.fromIterable()
 *   - Stream.runFold(() => 0, f)   initial value is a thunk
 *   - No Chunk import needed
 */

import { Stream, Effect } from 'effect-v4';
import { Stream as NewStream } from '../src/index.js';
import type { Transform } from '../src/index.js';
import { Readable, Writable, Transform as NodeTransform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
  // Scenario 1: Simple pipeline (source → iterate/count)
  // ============================================================================
  console.log('Running: Simple pipeline...');
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
        const source = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else controller.close();
          },
        });
        let total = 0;
        const dest = new WritableStream<Uint8Array>({
          write(chunk) { total += chunk.length; },
        });
        await source.pipeTo(dest);
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
        let total = 0;
        const dest = new Writable({
          write(chunk, _enc, callback) { total += chunk.length; callback(); },
        });
        await pipeline(source, dest);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect v4 Stream',
      async () => {
        const total = await Effect.runPromise(
          Stream.fromArray(chunks).pipe(
            Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Simple pipeline (8KB x 1000)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 2: Pipeline with XOR transform (CPU-bound)
  // ============================================================================
  console.log('Running: Pipeline with XOR transform...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 1000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);
    const xorKey = 0x42;

    const createNewStreamXor = async () => {
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
    };

    const createWebStreamXor = async () => {
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
      const transformed = source.pipeThrough(transform);
      let total = 0;
      // @ts-ignore
      for await (const chunk of transformed) total += chunk.length;
      if (total !== totalBytes) throw new Error('Wrong size');
    };

    const createNodeStreamXor = async () => {
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
    };

    const createEffectXor = async () => {
      const total = await Effect.runPromise(
        Stream.fromArray(chunks).pipe(
          Stream.map((chunk) => {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) result[i] = chunk[i] ^ xorKey;
            return result;
          }),
          Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
        )
      );
      if (total !== totalBytes) throw new Error('Wrong size');
    };

    // Global warmup across all implementations to avoid JIT bias
    for (let i = 0; i < 20; i++) {
      await createNewStreamXor();
      await createWebStreamXor();
      await createNodeStreamXor();
      await createEffectXor();
    }
    if (global.gc) global.gc();

    const newStreamResult = await benchmark(
      'New Stream', createNewStreamXor,
      { totalBytes, minSamples: 20, minTimeMs: 3000, warmupIterations: 0 }
    );
    const webStreamResult = await benchmark(
      'Web Stream', createWebStreamXor,
      { totalBytes, minSamples: 20, minTimeMs: 3000, warmupIterations: 0 }
    );
    const nodeStreamResult = await benchmark(
      'Node Stream', createNodeStreamXor,
      { totalBytes, minSamples: 20, minTimeMs: 3000, warmupIterations: 0 }
    );
    const effectStreamResult = await benchmark(
      'Effect v4 Stream', createEffectXor,
      { totalBytes, minSamples: 20, minTimeMs: 3000, warmupIterations: 0 }
    );

    comparisons.push(createEffectComparison(
      'Pipeline + XOR (8KB x 1000)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 3: Multi-stage pipeline (3 identity stages)
  // ============================================================================
  console.log('Running: Multi-stage pipeline...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const identity: Transform = (batch) => batch;
        const p = NewStream.pull(NewStream.from(chunks), identity, identity, identity);
        let total = 0;
        for await (const batch of p) {
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
        const transformed = source
          .pipeThrough(makeT())
          .pipeThrough(makeT())
          .pipeThrough(makeT());
        let total = 0;
        // @ts-ignore
        for await (const chunk of transformed) total += chunk.length;
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
      'Effect v4 Stream',
      async () => {
        const total = await Effect.runPromise(
          Stream.fromArray(chunks).pipe(
            Stream.map((chunk) => chunk),
            Stream.map((chunk) => chunk),
            Stream.map((chunk) => chunk),
            Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'Multi-stage 3x (8KB x 500)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  // ============================================================================
  // Scenario 4: High-frequency small chunks (64B x 20000)
  // ============================================================================
  console.log('Running: High-frequency small chunks...');
  {
    const chunkSize = 64;
    const chunkCount = 20000;
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
        let total = 0;
        // @ts-ignore
        for await (const chunk of source) total += chunk.length;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
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
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const effectStreamResult = await benchmark(
      'Effect v4 Stream',
      async () => {
        const total = await Effect.runPromise(
          Stream.fromArray(chunks).pipe(
            Stream.runFold(() => 0, (acc, chunk) => acc + chunk.length)
          )
        );
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    comparisons.push(createEffectComparison(
      'High-freq (64B x 20000)',
      newStreamResult, webStreamResult, nodeStreamResult, effectStreamResult
    ));
  }

  return comparisons;
}

// Main
console.log('Benchmark: Pipeline Performance — effect/Stream v4 beta');
console.log('Comparing: New Streams, Web Streams, Node.js Streams, effect/Stream v4');
console.log('effect/Stream v4: Stream.fromArray + Stream.map + Stream.runFold(() => init, f)');
console.log('(minimum 15-20 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printEffectComparison)
  .catch(console.error);
