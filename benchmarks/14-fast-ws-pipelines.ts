/**
 * Benchmark: Pipeline Performance (with Fast WebStreams)
 *
 * Mirrors 04-pipelines.ts but adds Vercel's experimental-fast-webstreams
 * as a fourth comparison target.
 *
 * Measures performance of full pipelines: source -> transforms -> destination.
 */

import { Stream } from '../src/index.js';
import type { Transform } from '../src/index.js';
import { Readable, Writable, Transform as NodeTransform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  FastReadableStream,
  FastWritableStream,
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
  // Scenario 1: Simple pipeline (source -> destination via iteration)
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
        const source = Stream.from(chunks);

        let total = 0;
        for await (const batch of source) {
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

        let total = 0;
        const dest = new FastWritableStream<Uint8Array>({
          write(chunk) {
            total += chunk.length;
          },
        });

        await source.pipeTo(dest);
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

        let total = 0;
        const dest = new WritableStream<Uint8Array>({
          write(chunk) {
            total += chunk.length;
          },
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
            if (index < chunks.length) {
              this.push(chunks[index++]);
            } else {
              this.push(null);
            }
          },
        });

        let total = 0;
        const dest = new Writable({
          write(chunk, encoding, callback) {
            total += chunk.length;
            callback();
          },
        });

        await pipeline(source, dest);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createFourWayComparison('Simple pipeline (8KB x 1000)', newStreamResult, fastWebStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 2: Pipeline with transform
  // NOTE: Global warmup of ALL implementations before measurement to
  // avoid JIT compilation bias.
  // ============================================================================
  console.log('Running: Pipeline with transform...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 1000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);
    const xorKey = 0x42;

    const createNewStreamXor = async () => {
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

      let total = 0;
      for await (const batch of Stream.pull(Stream.from(chunks), xorTransform)) {
        for (const chunk of batch) {
          total += chunk.length;
        }
      }
      if (total !== totalBytes) throw new Error('Wrong size');
    };

    const createFastWebStreamXor = async () => {
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

      const transformed = source.pipeThrough(transform);
      let total = 0;
      // @ts-ignore
      for await (const chunk of transformed) {
        total += chunk.length;
      }
      if (total !== totalBytes) throw new Error('Wrong size');
    };

    const createWebStreamXor = async () => {
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

      const transformed = source.pipeThrough(transform);
      let total = 0;
      // @ts-ignore
      for await (const chunk of transformed) {
        total += chunk.length;
      }
      if (total !== totalBytes) throw new Error('Wrong size');
    };

    const createNodeStreamXor = async () => {
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
    };

    // Global warmup: run ALL implementations to ensure fair JIT compilation
    for (let i = 0; i < 20; i++) {
      await createNewStreamXor();
      await createFastWebStreamXor();
      await createWebStreamXor();
      await createNodeStreamXor();
    }
    if (global.gc) global.gc();

    const newStreamResult = await benchmark(
      'New Stream',
      createNewStreamXor,
      { totalBytes, minSamples: 20, minTimeMs: 3000, warmupIterations: 0 }
    );

    const fastWebStreamResult = await benchmark(
      'Fast WS',
      createFastWebStreamXor,
      { totalBytes, minSamples: 20, minTimeMs: 3000, warmupIterations: 0 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      createWebStreamXor,
      { totalBytes, minSamples: 20, minTimeMs: 3000, warmupIterations: 0 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      createNodeStreamXor,
      { totalBytes, minSamples: 20, minTimeMs: 3000, warmupIterations: 0 }
    );

    comparisons.push(createFourWayComparison('Pipeline + XOR (8KB x 1000)', newStreamResult, fastWebStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 3: Multi-stage pipeline
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
        const source = Stream.from(chunks);
        const identity: Transform = (batch) => batch;
        const pl = Stream.pull(source, identity, identity, identity);
        let total = 0;
        for await (const batch of pl) {
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

        // @ts-ignore
        const transformed = source
          .pipeThrough(createTransform())
          .pipeThrough(createTransform())
          .pipeThrough(createTransform());

        let total = 0;
        // @ts-ignore
        for await (const chunk of transformed) {
          total += chunk.length;
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

        // @ts-ignore
        const transformed = source
          .pipeThrough(createTransform())
          .pipeThrough(createTransform())
          .pipeThrough(createTransform());

        let total = 0;
        // @ts-ignore
        for await (const chunk of transformed) {
          total += chunk.length;
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

    comparisons.push(createFourWayComparison('Multi-stage 3x (8KB x 500)', newStreamResult, fastWebStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 4: High-frequency small chunks
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
        const source = Stream.from(chunks);

        let total = 0;
        for await (const batch of source) {
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

        let total = 0;
        // @ts-ignore
        for await (const chunk of source) {
          total += chunk.length;
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

        let total = 0;
        // @ts-ignore
        for await (const chunk of source) {
          total += chunk.length;
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

        let total = 0;
        for await (const chunk of source) {
          total += chunk.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    comparisons.push(createFourWayComparison('High-freq (64B x 20000)', newStreamResult, fastWebStreamResult, webStreamResult, nodeStreamResult));
  }

  return comparisons;
}

// Main
console.log('Benchmark: Pipeline Performance (with Fast WebStreams)');
console.log('Measuring full pipeline throughput');
console.log('Comparing: New Streams vs Fast WebStreams vs Web Streams vs Node.js Streams');
console.log('(minimum 15-20 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printFourWayComparison)
  .catch(console.error);
