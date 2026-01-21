/**
 * Benchmark: Raw Throughput
 *
 * Measures how fast data can flow through streams with minimal processing.
 * All three APIs use equivalent pull-based patterns for fair comparison.
 *
 * New API: Uses batched iteration (Uint8Array[]) for amortized async overhead
 * Web Streams: Uses single-chunk iteration (Uint8Array)
 * Node.js Streams: Uses Node's native stream implementation
 */

import { Stream } from '../src/index.js';
import { Readable } from 'node:stream';

import {
  benchmark,
  createThreeWayComparison,
  ThreeWayComparison,
  printThreeWayComparison,
  generateChunks,
} from './utils.js';

// Helper to collect all bytes from a web stream (equivalent to bytes())
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
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// Helper to collect all bytes from a Node.js stream
function collectNodeStreamBytes(stream: Readable): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  const { promise, resolve } = Promise.withResolvers();

  stream.on('data', (chunk: Uint8Array) => {
    chunks.push(chunk);
    totalLength += chunk.length;
  });

  stream.on('end', () => {
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    resolve(result);
  });

  return promise as Promise<Uint8Array>;
}

async function runBenchmarks(): Promise<ThreeWayComparison[]> {
  const comparisons: ThreeWayComparison[] = [];

  // ============================================================================
  // Scenario 1: Large chunks (64KB each)
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
        // New API: from() creates an async iterable, bytes() consumes it
        const source = Stream.from(chunks);
        const result = await Stream.bytes(source);
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
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
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
            if (index < chunks.length) {
              this.push(chunks[index++]);
            } else {
              this.push(null);
            }
          },
        });
        const result = await collectNodeStreamBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Large chunks (64KB x 500)', newStreamResult, webStreamResult, nodeStreamResult));
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
        const source = Stream.from(chunks);
        const result = await Stream.bytes(source);
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
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
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
            if (index < chunks.length) {
              this.push(chunks[index++]);
            } else {
              this.push(null);
            }
          },
        });
        const result = await collectNodeStreamBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Medium chunks (8KB x 2000)', newStreamResult, webStreamResult, nodeStreamResult));
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
        const source = Stream.from(chunks);
        const result = await Stream.bytes(source);
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
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
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
            if (index < chunks.length) {
              this.push(chunks[index++]);
            } else {
              this.push(null);
            }
          },
        });
        const result = await collectNodeStreamBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Small chunks (1KB x 5000)', newStreamResult, webStreamResult, nodeStreamResult));
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
        const source = Stream.from(chunks);
        const result = await Stream.bytes(source);
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
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
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
            if (index < chunks.length) {
              this.push(chunks[index++]);
            } else {
              this.push(null);
            }
          },
        });
        const result = await collectNodeStreamBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Tiny chunks (100B x 10000)', newStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 5: Async iteration consumption (batched vs single-chunk)
  // ============================================================================
  console.log('Running: Async iteration...');
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
        // New API yields Uint8Array[] batches
        for await (const batch of source) {
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
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index < chunks.length) {
              controller.enqueue(chunks[index++]);
            } else {
              controller.close();
            }
          },
        });
        let total = 0;
        // @ts-ignore - Node.js supports async iteration
        for await (const chunk of stream) {
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
        const stream = new Readable({
          read() {
            if (index < chunks.length) {
              this.push(chunks[index++]);
            } else {
              this.push(null);
            }
          },
        });
        let total = 0;
        for await (const chunk of stream) {
          total += chunk.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Async iteration (8KB x 1000)', newStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 6: Generator source with pull pipeline
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
        // Using async generator source - fair comparison uses async generator for both
        async function* source() {
          for (const chunk of chunks) {
            yield chunk;
          }
        }
        const stream = Stream.from(source());
        // Just iterate and count - fair comparison
        let total = 0;
        for await (const batch of stream) {
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
        // Use async generator for fair comparison
        async function* source() {
          for (const chunk of chunks) {
            yield chunk;
          }
        }
        // @ts-ignore - ReadableStream.from exists in Node.js
        const stream = ReadableStream.from(source());
        // Just iterate and count
        let total = 0;
        // @ts-ignore
        for await (const chunk of stream) {
          total += chunk.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const nodeStreamResult = await benchmark(
      'Node Stream',
      async () => {
        // Use async generator for fair comparison
        async function* source() {
          for (const chunk of chunks) {
            yield chunk;
          }
        }
        const stream = Readable.from(source());
        // Just iterate and count
        let total = 0;
        for await (const chunk of stream) {
          total += chunk.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Generator source (8KB x 1000)', newStreamResult, webStreamResult, nodeStreamResult));
  }

  return comparisons;
}

// Main
console.log('Benchmark: Raw Throughput');
console.log('Measuring data flow speed through streams');
console.log('Comparing: New Streams vs Web Streams vs Node.js Streams');
console.log('New API uses batched iteration (Uint8Array[]) for amortized overhead');
console.log('(minimum 20 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printThreeWayComparison)
  .catch(console.error);
