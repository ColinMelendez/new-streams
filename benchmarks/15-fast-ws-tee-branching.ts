/**
 * Benchmark: Share/Branching Performance (with Fast WebStreams)
 *
 * Mirrors 05-tee-branching.ts but adds Vercel's experimental-fast-webstreams
 * as a third comparison target.
 *
 * New API: Uses share() for pull-model multi-consumer
 * Web Streams / Fast WS: Uses tee() for branching
 *
 * Note: Node.js Streams don't have a direct tee() equivalent, so this
 * benchmark uses a three-way comparison (New vs Fast WS vs Web).
 */

import { Stream } from '../src/index.js';
import type { Transform } from '../src/index.js';
import {
  FastReadableStream,
  FastTransformStream,
} from 'experimental-fast-webstreams';
import {
  benchmark,
  createThreeWayComparison,
  ThreeWayComparison,
  printThreeWayComparison,
  generateChunks,
} from './utils.js';

async function runBenchmarks(): Promise<ThreeWayComparison[]> {
  const comparisons: ThreeWayComparison[] = [];

  // ============================================================================
  // Scenario 1: Single share (2 readers)
  // ============================================================================
  console.log('Running: Single share (2 readers)...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const source = Stream.from(chunks);

        const shared = Stream.share(source, { highWaterMark: 100 });

        const consumer1 = shared.pull();
        const consumer2 = shared.pull();

        const [result1, result2] = await Promise.all([
          Stream.bytes(consumer1),
          Stream.bytes(consumer2),
        ]);

        if (result1.length !== totalBytes || result2.length !== totalBytes) {
          throw new Error('Wrong size');
        }
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

        const [branch1, branch2] = source.tee();

        const readBranch = async (stream: ReadableStream<Uint8Array>) => {
          const reader = stream.getReader();
          let total = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
          }
          return total;
        };

        const [total1, total2] = await Promise.all([readBranch(branch1), readBranch(branch2)]);

        if (total1 !== totalBytes || total2 !== totalBytes) {
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
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
          },
        });

        const [branch1, branch2] = source.tee();

        const readBranch = async (stream: ReadableStream<Uint8Array>) => {
          const reader = stream.getReader();
          let total = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
          }
          return total;
        };

        const [total1, total2] = await Promise.all([readBranch(branch1), readBranch(branch2)]);

        if (total1 !== totalBytes || total2 !== totalBytes) {
          throw new Error('Wrong size');
        }
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    // ThreeWayComparison uses nodeStream slot for Fast WS here since
    // Node.js Streams don't have a tee() equivalent.
    comparisons.push(createThreeWayComparison('Share 2 readers (4KB x 500)', newStreamResult, webStreamResult, fastWebStreamResult));
  }

  // ============================================================================
  // Scenario 2: Share with different processing per branch
  // ============================================================================
  console.log('Running: Share with transforms...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const source = Stream.from(chunks);

        const shared = Stream.share(source, { highWaterMark: 100 });

        const identity: Transform = (batch) => batch;

        const xorTransform: Transform = (batch) => {
          if (batch === null) return null;
          return batch.map(chunk => {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
              result[i] = chunk[i] ^ 0x42;
            }
            return result;
          });
        };

        const consumer1 = shared.pull(identity);
        const consumer2 = shared.pull(xorTransform);

        const [result1, result2] = await Promise.all([
          Stream.bytes(consumer1),
          Stream.bytes(consumer2),
        ]);

        if (result1.length !== totalBytes || result2.length !== totalBytes) {
          throw new Error('Wrong size');
        }
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

        const [branch1, branch2] = source.tee();

        const t1 = new FastTransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
        });

        const t2 = new FastTransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
              result[i] = chunk[i] ^ 0x42;
            }
            controller.enqueue(result);
          },
        });

        const readBranch = async (stream: ReadableStream<Uint8Array>) => {
          const reader = stream.getReader();
          let total = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
          }
          return total;
        };

        const [total1, total2] = await Promise.all([
          readBranch(branch1.pipeThrough(t1)),
          readBranch(branch2.pipeThrough(t2)),
        ]);

        if (total1 !== totalBytes || total2 !== totalBytes) {
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
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
          },
        });

        const [branch1, branch2] = source.tee();

        const t1 = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
        });

        const t2 = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
              result[i] = chunk[i] ^ 0x42;
            }
            controller.enqueue(result);
          },
        });

        const readBranch = async (stream: ReadableStream<Uint8Array>) => {
          const reader = stream.getReader();
          let total = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
          }
          return total;
        };

        const [total1, total2] = await Promise.all([
          readBranch(branch1.pipeThrough(t1)),
          readBranch(branch2.pipeThrough(t2)),
        ]);

        if (total1 !== totalBytes || total2 !== totalBytes) {
          throw new Error('Wrong size');
        }
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Share + transforms (4KB x 500)', newStreamResult, webStreamResult, fastWebStreamResult));
  }

  // ============================================================================
  // Scenario 3: Small chunks share (stress test)
  // ============================================================================
  console.log('Running: Small chunks share...');
  {
    const chunkSize = 256;
    const chunkCount = 5000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const source = Stream.from(chunks);

        const shared = Stream.share(source, { highWaterMark: 500 });

        const consumer1 = shared.pull();
        const consumer2 = shared.pull();

        const [result1, result2] = await Promise.all([
          Stream.bytes(consumer1),
          Stream.bytes(consumer2),
        ]);

        if (result1.length !== totalBytes || result2.length !== totalBytes) {
          throw new Error('Wrong size');
        }
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

        const [branch1, branch2] = source.tee();

        const readBranch = async (stream: ReadableStream<Uint8Array>) => {
          const reader = stream.getReader();
          let total = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
          }
          return total;
        };

        const [total1, total2] = await Promise.all([readBranch(branch1), readBranch(branch2)]);

        if (total1 !== totalBytes || total2 !== totalBytes) {
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
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
          },
        });

        const [branch1, branch2] = source.tee();

        const readBranch = async (stream: ReadableStream<Uint8Array>) => {
          const reader = stream.getReader();
          let total = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
          }
          return total;
        };

        const [total1, total2] = await Promise.all([readBranch(branch1), readBranch(branch2)]);

        if (total1 !== totalBytes || total2 !== totalBytes) {
          throw new Error('Wrong size');
        }
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Small chunks share (256B x 5000)', newStreamResult, webStreamResult, fastWebStreamResult));
  }

  return comparisons;
}

// Main
console.log('Benchmark: Share/Branching Performance (with Fast WebStreams)');
console.log('Measuring stream branching efficiency');
console.log('New API: share() for pull-model multi-consumer');
console.log('Web Streams / Fast WS: tee() for branching');
console.log('(Note: "Node Stream" column shows Fast WebStreams results)');
console.log('(minimum 15-20 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printThreeWayComparison)
  .catch(console.error);
