/**
 * Benchmark: Transform Performance (with Fast WebStreams)
 *
 * Mirrors 03-transforms.ts but adds Vercel's experimental-fast-webstreams
 * as a fourth comparison target.
 *
 * Note: New API transforms receive Uint8Array[] batches, not single chunks.
 * Fast WebStreams uses Node.js pipeline() internally for pipeThrough chains.
 */

import { Stream } from '../src/index.js';
import type { Transform } from '../src/index.js';
import { Readable, Transform as NodeTransform } from 'node:stream';
import {
  FastReadableStream,
  FastTransformStream,
} from 'experimental-fast-webstreams';
import {
  benchmark,
  createFourWayComparison,
  FourWayComparison,
  printFourWayComparison,
  generateChunks,
} from './utils.js';

async function runBenchmarks(): Promise<FourWayComparison[]> {
  const comparisons: FourWayComparison[] = [];

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
        const source = Stream.from(chunks);
        const identity: Transform = (batch) => batch;
        const pipeline = Stream.pull(source, identity);
        let total = 0;
        for await (const batch of pipeline) {
          for (const chunk of batch) {
            total += chunk.length;
          }
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const fastWebStreamResult = await benchmark(
      'Fast WS',
      async () => {
        let index = 0;
        const source = new FastReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
          },
        });

        const transform = new FastTransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
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
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        let index = 0;
        const source = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
          },
        });

        const transform = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
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
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        let index = 0;
        const source = new Readable({
          read() {
            if (index < chunks.length) {
              this.push(chunks[index++]);
            } else {
              this.push(null);
            }
          },
        });

        const transform = new NodeTransform({
          transform(chunk, encoding, callback) {
            callback(null, chunk);
          },
        });

        const piped = source.pipe(transform);
        let total = 0;
        for await (const chunk of piped) {
          total += chunk.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createFourWayComparison('Identity transform (8KB x 1000)', newStreamResult, fastWebStreamResult, webStreamResult, nodeStreamResult));
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
        const source = Stream.from(chunks);
        const xorTransform: Transform = (batch) => {
          if (batch === null) return null;
          return batch.map(chunk => {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
              result[i] = chunk[i] ^ xorKey;
            }
            return result;
          });
        };
        const pipeline = Stream.pull(source, xorTransform);
        let total = 0;
        for await (const batch of pipeline) {
          for (const chunk of batch) {
            total += chunk.length;
          }
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const fastWebStreamResult = await benchmark(
      'Fast WS',
      async () => {
        let index = 0;
        const source = new FastReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
          },
        });

        const transform = new FastTransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
              result[i] = chunk[i] ^ xorKey;
            }
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

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        let index = 0;
        const source = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
          },
        });

        const transform = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
              result[i] = chunk[i] ^ xorKey;
            }
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
            if (index < chunks.length) {
              this.push(chunks[index++]);
            } else {
              this.push(null);
            }
          },
        });

        const transform = new NodeTransform({
          transform(chunk, encoding, callback) {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
              result[i] = chunk[i] ^ xorKey;
            }
            callback(null, result);
          },
        });

        const piped = source.pipe(transform);
        let total = 0;
        for await (const chunk of piped) {
          total += chunk.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createFourWayComparison('XOR transform (8KB x 500)', newStreamResult, fastWebStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 3: Chained transforms (3 stages)
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
        const source = Stream.from(chunks);
        const identity: Transform = (batch) => batch;
        const pipeline = Stream.pull(source, identity, identity, identity);
        let total = 0;
        for await (const batch of pipeline) {
          for (const chunk of batch) {
            total += chunk.length;
          }
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const fastWebStreamResult = await benchmark(
      'Fast WS',
      async () => {
        let index = 0;
        const source = new FastReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
          },
        });

        const createTransform = () =>
          new FastTransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              controller.enqueue(chunk);
            },
          });

        const reader = source
          .pipeThrough(createTransform())
          .pipeThrough(createTransform())
          .pipeThrough(createTransform())
          .getReader();

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

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        let index = 0;
        const source = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
          },
        });

        const createTransform = () =>
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              controller.enqueue(chunk);
            },
          });

        const reader = source
          .pipeThrough(createTransform())
          .pipeThrough(createTransform())
          .pipeThrough(createTransform())
          .getReader();

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
            if (index < chunks.length) {
              this.push(chunks[index++]);
            } else {
              this.push(null);
            }
          },
        });

        const createIdentity = () =>
          new NodeTransform({
            transform(chunk, encoding, callback) {
              callback(null, chunk);
            },
          });

        const piped = source.pipe(createIdentity()).pipe(createIdentity()).pipe(createIdentity());
        let total = 0;
        for await (const chunk of piped) {
          total += chunk.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createFourWayComparison('Chained 3x (8KB x 500)', newStreamResult, fastWebStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 4: Async transform
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
        const source = Stream.from(chunks);
        const asyncIdentity: Transform = async (batch) => {
          await Promise.resolve();
          return batch;
        };
        const pipeline = Stream.pull(source, asyncIdentity);
        let total = 0;
        for await (const batch of pipeline) {
          for (const chunk of batch) {
            total += chunk.length;
          }
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    const fastWebStreamResult = await benchmark(
      'Fast WS',
      async () => {
        let index = 0;
        const source = new FastReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
          },
        });

        const transform = new FastTransformStream<Uint8Array, Uint8Array>({
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

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        let index = 0;
        const source = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
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
            if (index < chunks.length) {
              this.push(chunks[index++]);
            } else {
              this.push(null);
            }
          },
        });

        const transform = new NodeTransform({
          async transform(chunk, encoding, callback) {
            await Promise.resolve();
            callback(null, chunk);
          },
        });

        const piped = source.pipe(transform);
        let total = 0;
        for await (const chunk of piped) {
          total += chunk.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    comparisons.push(createFourWayComparison('Async transform (8KB x 300)', newStreamResult, fastWebStreamResult, webStreamResult, nodeStreamResult));
  }

  return comparisons;
}

// Main
console.log('Benchmark: Transform Performance (with Fast WebStreams)');
console.log('Measuring data transformation speed');
console.log('Comparing: New Streams vs Fast WebStreams vs Web Streams vs Node.js Streams');
console.log('(minimum 15-20 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printFourWayComparison)
  .catch(console.error);
