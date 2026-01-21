/**
 * Benchmark: pullSync vs pull vs Web Streams
 *
 * Compares the performance of:
 * 1. Stream.pullSync() - fully synchronous pipeline
 * 2. Stream.pull() - async pipeline with transforms
 * 3. Web Streams ReadableStream with sync pull + TransformStream
 *
 * This benchmark measures the overhead of async machinery when processing
 * data that could be handled synchronously.
 */

import { Stream } from '../src/index.js';
import type { Transform, SyncTransform } from '../src/index.js';
import {
  benchmark,
  BenchmarkResult,
  formatBytesPerSec,
  formatTime,
  generateChunks,
} from './utils.js';

interface ThreeWayComparison {
  scenario: string;
  pullSync: BenchmarkResult;
  pullAsync: BenchmarkResult;
  webStreams: BenchmarkResult;
}

/**
 * Print three-way comparison table
 */
function printThreeWayComparison(comparisons: ThreeWayComparison[]): void {
  console.log('\n' + '='.repeat(130));
  console.log('BENCHMARK RESULTS - Sync Pipeline Comparison');
  console.log('='.repeat(130));

  const headers = ['Scenario', 'pullSync', 'pull (async)', 'Web Streams', 'Sync vs Async', 'Sync vs Web'];
  const colWidths = [28, 18, 18, 18, 16, 16];

  // Print header
  console.log(headers.map((h, i) => h.padEnd(colWidths[i])).join(' | '));
  console.log(colWidths.map((w) => '-'.repeat(w)).join('-+-'));

  // Print rows
  for (const c of comparisons) {
    const syncStr = c.pullSync.bytesPerSec
      ? formatBytesPerSec(c.pullSync.bytesPerSec)
      : formatTime(c.pullSync.mean);

    const asyncStr = c.pullAsync.bytesPerSec
      ? formatBytesPerSec(c.pullAsync.bytesPerSec)
      : formatTime(c.pullAsync.mean);

    const webStr = c.webStreams.bytesPerSec
      ? formatBytesPerSec(c.webStreams.bytesPerSec)
      : formatTime(c.webStreams.mean);

    // Calculate speedups (using time - lower is better)
    const syncVsAsync = c.pullAsync.mean / c.pullSync.mean;
    const syncVsWeb = c.webStreams.mean / c.pullSync.mean;

    const syncVsAsyncStr = syncVsAsync >= 1
      ? `${syncVsAsync.toFixed(1)}x faster`
      : `${(1 / syncVsAsync).toFixed(1)}x slower`;

    const syncVsWebStr = syncVsWeb >= 1
      ? `${syncVsWeb.toFixed(1)}x faster`
      : `${(1 / syncVsWeb).toFixed(1)}x slower`;

    const row = [
      c.scenario.substring(0, colWidths[0] - 1),
      syncStr,
      asyncStr,
      webStr,
      syncVsAsyncStr,
      syncVsWebStr,
    ];

    console.log(row.map((v, i) => v.padEnd(colWidths[i])).join(' | '));
  }

  console.log('='.repeat(130));

  // Print summary
  const avgSyncVsAsync = comparisons.reduce((sum, c) => sum + c.pullAsync.mean / c.pullSync.mean, 0) / comparisons.length;
  const avgSyncVsWeb = comparisons.reduce((sum, c) => sum + c.webStreams.mean / c.pullSync.mean, 0) / comparisons.length;

  console.log(`\nAverage speedup of pullSync vs pull: ${avgSyncVsAsync.toFixed(1)}x`);
  console.log(`Average speedup of pullSync vs Web Streams: ${avgSyncVsWeb.toFixed(1)}x`);
  console.log(`\nNote: pullSync returns a sync generator (no async overhead)`);
  console.log(`      pull and Web Streams use async iteration`);
}

/**
 * Create a Web Streams pipeline with sync pull source and transforms
 */
function createWebStreamPipeline(
  chunks: Uint8Array[],
  transforms: Array<(chunk: Uint8Array) => Uint8Array | null>
): ReadableStream<Uint8Array> {
  let index = 0;

  // Create ReadableStream with sync pull
  let stream: ReadableStream<Uint8Array> = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    }
  });

  // Chain transforms
  for (const transformFn of transforms) {
    stream = stream.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        const result = transformFn(chunk);
        if (result !== null) {
          controller.enqueue(result);
        }
      }
    }));
  }

  return stream;
}

/**
 * Consume a Web Stream and return total bytes
 */
async function consumeWebStream(stream: ReadableStream<Uint8Array>): Promise<number> {
  const reader = stream.getReader();
  let totalBytes = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
  }

  return totalBytes;
}

/**
 * Consume sync pipeline and return total bytes
 */
function consumeSyncPipeline(source: Iterable<Uint8Array[]>): number {
  let totalBytes = 0;
  for (const batch of source) {
    for (const chunk of batch) {
      totalBytes += chunk.byteLength;
    }
  }
  return totalBytes;
}

/**
 * Consume async pipeline and return total bytes
 */
async function consumeAsyncPipeline(source: AsyncIterable<Uint8Array[]>): Promise<number> {
  let totalBytes = 0;
  for await (const batch of source) {
    for (const chunk of batch) {
      totalBytes += chunk.byteLength;
    }
  }
  return totalBytes;
}

async function runBenchmarks(): Promise<ThreeWayComparison[]> {
  const comparisons: ThreeWayComparison[] = [];

  // ============================================================================
  // Scenario 1: Passthrough (no transform) - measures pure overhead
  // ============================================================================
  console.log('Running: Passthrough (no transforms)...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 1000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    // pullSync - no transforms
    const syncResult = await benchmark(
      'pullSync',
      async () => {
        const source = Stream.fromSync(chunks);
        const pipeline = Stream.pullSync(source);
        const bytes = consumeSyncPipeline(pipeline);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    // pull (async) - no transforms
    const asyncResult = await benchmark(
      'pull (async)',
      async () => {
        const source = Stream.from(chunks);
        const pipeline = Stream.pull(source);
        const bytes = await consumeAsyncPipeline(pipeline);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    // Web Streams - no transforms
    const webResult = await benchmark(
      'Web Streams',
      async () => {
        const stream = createWebStreamPipeline(chunks, []);
        const bytes = await consumeWebStream(stream);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    comparisons.push({
      scenario: 'Passthrough (8KB x 1000)',
      pullSync: syncResult,
      pullAsync: asyncResult,
      webStreams: webResult,
    });
  }

  // ============================================================================
  // Scenario 2: Single transform (uppercase-style transform)
  // ============================================================================
  console.log('Running: Single transform...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 1000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    // Transform function that modifies bytes
    const upperCaseTransform = (chunk: Uint8Array): Uint8Array => {
      const result = new Uint8Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        result[i] = (c >= 97 && c <= 122) ? c - 32 : c;
      }
      return result;
    };

    // pullSync
    const syncTransform: SyncTransform = (batch) => {
      if (batch === null) return null;
      return batch.map(upperCaseTransform);
    };

    const syncResult = await benchmark(
      'pullSync',
      async () => {
        const source = Stream.fromSync(chunks);
        const pipeline = Stream.pullSync(source, syncTransform);
        const bytes = consumeSyncPipeline(pipeline);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    // pull (async)
    const asyncTransform: Transform = (batch) => {
      if (batch === null) return null;
      return batch.map(upperCaseTransform);
    };

    const asyncResult = await benchmark(
      'pull (async)',
      async () => {
        const source = Stream.from(chunks);
        const pipeline = Stream.pull(source, asyncTransform);
        const bytes = await consumeAsyncPipeline(pipeline);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    // Web Streams
    const webResult = await benchmark(
      'Web Streams',
      async () => {
        const stream = createWebStreamPipeline(chunks, [upperCaseTransform]);
        const bytes = await consumeWebStream(stream);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    comparisons.push({
      scenario: 'Single transform (4KB x 1000)',
      pullSync: syncResult,
      pullAsync: asyncResult,
      webStreams: webResult,
    });
  }

  // ============================================================================
  // Scenario 3: Chain of 3 transforms
  // ============================================================================
  console.log('Running: Chain of 3 transforms...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    // Three simple transforms
    const transform1 = (chunk: Uint8Array): Uint8Array => {
      const result = new Uint8Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) result[i] = chunk[i] ^ 0x55;
      return result;
    };

    const transform2 = (chunk: Uint8Array): Uint8Array => {
      const result = new Uint8Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) result[i] = chunk[chunk.length - 1 - i];
      return result;
    };

    const transform3 = (chunk: Uint8Array): Uint8Array => {
      const result = new Uint8Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) result[i] = chunk[i] ^ 0xAA;
      return result;
    };

    // pullSync
    const t1: SyncTransform = (batch) => batch === null ? null : batch.map(transform1);
    const t2: SyncTransform = (batch) => batch === null ? null : batch.map(transform2);
    const t3: SyncTransform = (batch) => batch === null ? null : batch.map(transform3);

    const syncResult = await benchmark(
      'pullSync',
      async () => {
        const source = Stream.fromSync(chunks);
        const pipeline = Stream.pullSync(source, t1, t2, t3);
        const bytes = consumeSyncPipeline(pipeline);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    // pull (async)
    const at1: Transform = (batch) => batch === null ? null : batch.map(transform1);
    const at2: Transform = (batch) => batch === null ? null : batch.map(transform2);
    const at3: Transform = (batch) => batch === null ? null : batch.map(transform3);

    const asyncResult = await benchmark(
      'pull (async)',
      async () => {
        const source = Stream.from(chunks);
        const pipeline = Stream.pull(source, at1, at2, at3);
        const bytes = await consumeAsyncPipeline(pipeline);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    // Web Streams
    const webResult = await benchmark(
      'Web Streams',
      async () => {
        const stream = createWebStreamPipeline(chunks, [transform1, transform2, transform3]);
        const bytes = await consumeWebStream(stream);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    comparisons.push({
      scenario: '3 transforms (4KB x 500)',
      pullSync: syncResult,
      pullAsync: asyncResult,
      webStreams: webResult,
    });
  }

  // ============================================================================
  // Scenario 4: Many small chunks (high iteration overhead)
  // ============================================================================
  console.log('Running: Many small chunks...');
  {
    const chunkSize = 256;
    const chunkCount = 10000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const identityTransform = (chunk: Uint8Array): Uint8Array => chunk;

    // pullSync
    const syncIdentity: SyncTransform = (batch) => batch === null ? null : batch.map(identityTransform);

    const syncResult = await benchmark(
      'pullSync',
      async () => {
        const source = Stream.fromSync(chunks);
        const pipeline = Stream.pullSync(source, syncIdentity);
        const bytes = consumeSyncPipeline(pipeline);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    // pull (async)
    const asyncIdentity: Transform = (batch) => batch === null ? null : batch.map(identityTransform);

    const asyncResult = await benchmark(
      'pull (async)',
      async () => {
        const source = Stream.from(chunks);
        const pipeline = Stream.pull(source, asyncIdentity);
        const bytes = await consumeAsyncPipeline(pipeline);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    // Web Streams
    const webResult = await benchmark(
      'Web Streams',
      async () => {
        const stream = createWebStreamPipeline(chunks, [identityTransform]);
        const bytes = await consumeWebStream(stream);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    comparisons.push({
      scenario: 'Small chunks (256B x 10000)',
      pullSync: syncResult,
      pullAsync: asyncResult,
      webStreams: webResult,
    });
  }

  // ============================================================================
  // Scenario 5: Tiny chunks (extreme async overhead)
  // ============================================================================
  console.log('Running: Tiny chunks (extreme case)...');
  {
    const chunkSize = 64;
    const chunkCount = 20000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    // pullSync
    const syncResult = await benchmark(
      'pullSync',
      async () => {
        const source = Stream.fromSync(chunks);
        const pipeline = Stream.pullSync(source);
        const bytes = consumeSyncPipeline(pipeline);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    // pull (async)
    const asyncResult = await benchmark(
      'pull (async)',
      async () => {
        const source = Stream.from(chunks);
        const pipeline = Stream.pull(source);
        const bytes = await consumeAsyncPipeline(pipeline);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    // Web Streams
    const webResult = await benchmark(
      'Web Streams',
      async () => {
        const stream = createWebStreamPipeline(chunks, []);
        const bytes = await consumeWebStream(stream);
        if (bytes !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    comparisons.push({
      scenario: 'Tiny chunks (64B x 20000)',
      pullSync: syncResult,
      pullAsync: asyncResult,
      webStreams: webResult,
    });
  }

  return comparisons;
}

// Main
console.log('Benchmark: pullSync vs pull vs Web Streams');
console.log('Comparing synchronous pipeline processing performance');
console.log('(minimum 30 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printThreeWayComparison)
  .catch(console.error);
