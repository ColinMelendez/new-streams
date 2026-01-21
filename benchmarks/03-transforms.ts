/**
 * Benchmark: Transform Performance
 *
 * Measures performance of data transformations through streams.
 * All three APIs use equivalent transform patterns for fair comparison.
 *
 * Note: New API transforms receive Uint8Array[] batches, not single chunks.
 */

import { Stream } from '../src/index.js';
import type { Transform } from '../src/index.js';
import { Readable, Transform as NodeTransform } from 'node:stream';
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
        // Transform receives batch (Uint8Array[]), returns batch
        const identity: Transform = (batch) => batch;
        const pipeline = Stream.pull(source, identity);
        // Just iterate and count - comparable to Web Streams reader loop
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

    comparisons.push(createThreeWayComparison('Identity transform (8KB x 1000)', newStreamResult, webStreamResult, nodeStreamResult));
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
        // Transform receives batch, XOR each chunk in the batch
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
        // Just iterate and count - comparable to Web Streams reader loop
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

    comparisons.push(createThreeWayComparison('XOR transform (8KB x 500)', newStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 3: Expanding transform (1:2)
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
        const source = Stream.from(chunks);
        // Generator transform that yields two copies of each chunk in the batch
        const expandTransform: Transform = function* (batch) {
          if (batch === null) return;
          for (const chunk of batch) {
            yield chunk;
            yield chunk;
          }
        };
        const pipeline = Stream.pull(source, expandTransform);
        // Just iterate and count - comparable to Web Streams reader loop
        let total = 0;
        for await (const batch of pipeline) {
          for (const chunk of batch) {
            total += chunk.length;
          }
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
            if (index < chunks.length) {
              this.push(chunks[index++]);
            } else {
              this.push(null);
            }
          },
        });

        const transform = new NodeTransform({
          transform(chunk, encoding, callback) {
            this.push(chunk);
            this.push(chunk);
            callback();
          },
        });

        const piped = source.pipe(transform);
        let total = 0;
        for await (const chunk of piped) {
          total += chunk.length;
        }
        if (total !== outputBytes) throw new Error('Wrong size');
      },
      { totalBytes: outputBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Expanding 1:2 (4KB x 500)', newStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 4: Chained transforms (3 stages)
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
        // Chain 3 transforms using pull()
        const pipeline = Stream.pull(source, identity, identity, identity);
        // Just iterate and count - comparable to Web Streams reader loop
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

        const t1 = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
        });
        const t2 = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
        });
        const t3 = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
        });

        const reader = source.pipeThrough(t1).pipeThrough(t2).pipeThrough(t3).getReader();
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

    comparisons.push(createThreeWayComparison('Chained 3x (8KB x 500)', newStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 5: Async transform
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
        // Just iterate and count - comparable to Web Streams reader loop
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

    comparisons.push(createThreeWayComparison('Async transform (8KB x 300)', newStreamResult, webStreamResult, nodeStreamResult));
  }

  return comparisons;
}

// Main
console.log('Benchmark: Transform Performance');
console.log('Measuring data transformation speed');
console.log('Comparing: New Streams vs Web Streams vs Node.js Streams');
console.log('(minimum 15-20 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printThreeWayComparison)
  .catch(console.error);
