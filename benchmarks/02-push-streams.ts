/**
 * Benchmark: Push Stream Performance
 *
 * Measures performance of push-based streams where a producer
 * writes data and a consumer reads it concurrently.
 *
 * All three APIs run with concurrent read/write for fair comparison.
 */

import { Stream } from '../src/index.js';
import { PassThrough } from 'node:stream';
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
        // Generate fresh chunks each iteration (Writer detaches buffers)
        const chunks = generateChunks(chunkSize, chunkCount);
        const { writer, readable } = Stream.push({ highWaterMark: 100 });

        const writePromise = (async () => {
          for (const chunk of chunks) {
            await writer.write(chunk);
          }
          await writer.end();
        })();

        // Just iterate and count - fair comparison with Web Streams
        const readPromise = (async () => {
          let total = 0;
          for await (const batch of readable) {
            for (const chunk of batch) {
              total += chunk.length;
            }
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
        // Generate fresh chunks each iteration for fair comparison
        const chunks = generateChunks(chunkSize, chunkCount);
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
        });

        const writePromise = (async () => {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
            await Promise.resolve(); // Yield to simulate async
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
        // Generate fresh chunks each iteration for fair comparison
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
          for await (const chunk of stream) {
            total += chunk.length;
          }
          return total;
        })();

        const [, total] = await Promise.all([writePromise, readPromise]);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Concurrent push (4KB x 1000)', newStreamResult, webStreamResult, nodeStreamResult));
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
        // Generate fresh chunks each iteration
        const chunks = generateChunks(chunkSize, chunkCount);
        const { writer, readable } = Stream.push({ highWaterMark: 1000 });

        const writePromise = (async () => {
          for (const chunk of chunks) {
            await writer.write(chunk);
          }
          await writer.end();
        })();

        // Just iterate and count - fair comparison with Web Streams
        const readPromise = (async () => {
          let total = 0;
          for await (const batch of readable) {
            for (const chunk of batch) {
              total += chunk.length;
            }
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
        // Generate fresh chunks for fair comparison
        const chunks = generateChunks(chunkSize, chunkCount);
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
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
        // Generate fresh chunks for fair comparison
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
          for await (const chunk of stream) {
            total += chunk.length;
          }
          return total;
        })();

        const [, total] = await Promise.all([writePromise, readPromise]);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 15, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Many small writes (64B x 10000)', newStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 3: Batch writes (writev)
  // ============================================================================
  console.log('Running: Batch writes...');
  {
    const chunkSize = 512;
    const chunksPerBatch = 20;
    const batchCount = 200;
    const totalBytes = chunkSize * chunksPerBatch * batchCount;

    // Helper to generate fresh batches
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
        // Generate fresh batches
        const batches = generateBatches();
        const { writer, readable } = Stream.push({ highWaterMark: 50 });

        const writePromise = (async () => {
          for (const batch of batches) {
            await writer.writev(batch);
          }
          await writer.end();
        })();

        // Just iterate and count - fair comparison with Web Streams
        const readPromise = (async () => {
          let total = 0;
          for await (const batch of readable) {
            for (const chunk of batch) {
              total += chunk.length;
            }
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
        // Generate fresh batches for fair comparison
        const batches = generateBatches();
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
        });

        const writePromise = (async () => {
          for (const batch of batches) {
            for (const chunk of batch) {
              controller.enqueue(chunk);
            }
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
        // Generate fresh batches for fair comparison
        const batches = generateBatches();
        const stream = new PassThrough({ highWaterMark: 50 * chunkSize * chunksPerBatch });

        const writePromise = (async () => {
          for (const batch of batches) {
            stream.cork();
            for (const chunk of batch) {
              stream.write(chunk);
            }
            stream.uncork();
            await Promise.resolve();
          }
          stream.end();
        })();

        const readPromise = (async () => {
          let total = 0;
          for await (const chunk of stream) {
            total += chunk.length;
          }
          return total;
        })();

        const [, total] = await Promise.all([writePromise, readPromise]);
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Batch writes (512B x 20 x 200)', newStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 4: Async iteration consumption
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
        const { writer, readable } = Stream.push({ highWaterMark: 100 });

        const writePromise = (async () => {
          for (const chunk of chunks) {
            await writer.write(chunk);
          }
          await writer.end();
        })();

        let total = 0;
        // New API yields Uint8Array[] batches
        for await (const batch of readable) {
          for (const chunk of batch) {
            total += chunk.length;
          }
        }
        await writePromise;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const webStreamResult = await benchmark(
      'Web Stream',
      async () => {
        // Generate fresh chunks for fair comparison
        const chunks = generateChunks(chunkSize, chunkCount);
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
        });

        const writePromise = (async () => {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
            await Promise.resolve();
          }
          controller.close();
        })();

        let total = 0;
        // @ts-ignore
        for await (const chunk of stream) {
          total += chunk.length;
        }
        await writePromise;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        // Generate fresh chunks for fair comparison
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
        for await (const chunk of stream) {
          total += chunk.length;
        }
        await writePromise;
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Push + async iter (2KB x 1000)', newStreamResult, webStreamResult, nodeStreamResult));
  }

  return comparisons;
}

// Main
console.log('Benchmark: Push Stream Performance');
console.log('Measuring concurrent write/read patterns');
console.log('Comparing: New Streams vs Web Streams vs Node.js Streams');
console.log('(minimum 15-20 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printThreeWayComparison)
  .catch(console.error);
