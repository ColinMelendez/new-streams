/**
 * Benchmark: Sync vs Async API Comparison
 *
 * Compares the performance of sync and async APIs when processing
 * data that could be handled synchronously (pre-generated arrays).
 * 
 * This benchmark shows when to use:
 * - fromSync + pullSync + bytesSync (fully sync path)
 * - from + pull + bytes (async path with sync source)
 * - from + pull + bytes (async path with async source)
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
  syncPath: BenchmarkResult;
  asyncSyncSource: BenchmarkResult;
  asyncAsyncSource: BenchmarkResult;
}

function printThreeWayComparison(comparisons: ThreeWayComparison[]): void {
  console.log('\n' + '='.repeat(130));
  console.log('BENCHMARK RESULTS - Sync vs Async API Comparison');
  console.log('='.repeat(130));

  const headers = ['Scenario', 'Sync Path', 'Async (sync src)', 'Async (async src)', 'Sync vs Async', 'Sync vs AsyncGen'];
  const colWidths = [28, 16, 16, 16, 16, 16];

  console.log(headers.map((h, i) => h.padEnd(colWidths[i])).join(' | '));
  console.log(colWidths.map((w) => '-'.repeat(w)).join('-+-'));

  for (const c of comparisons) {
    const syncStr = c.syncPath.bytesPerSec
      ? formatBytesPerSec(c.syncPath.bytesPerSec)
      : formatTime(c.syncPath.mean);

    const asyncSyncStr = c.asyncSyncSource.bytesPerSec
      ? formatBytesPerSec(c.asyncSyncSource.bytesPerSec)
      : formatTime(c.asyncSyncSource.mean);

    const asyncAsyncStr = c.asyncAsyncSource.bytesPerSec
      ? formatBytesPerSec(c.asyncAsyncSource.bytesPerSec)
      : formatTime(c.asyncAsyncSource.mean);

    const syncVsAsync = c.asyncSyncSource.mean / c.syncPath.mean;
    const syncVsAsyncGen = c.asyncAsyncSource.mean / c.syncPath.mean;

    const syncVsAsyncStr = syncVsAsync >= 1
      ? `${syncVsAsync.toFixed(1)}x faster`
      : `${(1 / syncVsAsync).toFixed(1)}x slower`;

    const syncVsAsyncGenStr = syncVsAsyncGen >= 1
      ? `${syncVsAsyncGen.toFixed(1)}x faster`
      : `${(1 / syncVsAsyncGen).toFixed(1)}x slower`;

    const row = [
      c.scenario.substring(0, colWidths[0] - 1),
      syncStr,
      asyncSyncStr,
      asyncAsyncStr,
      syncVsAsyncStr,
      syncVsAsyncGenStr,
    ];

    console.log(row.map((v, i) => v.padEnd(colWidths[i])).join(' | '));
  }

  console.log('='.repeat(130));

  const avgSyncVsAsync = comparisons.reduce((sum, c) => sum + c.asyncSyncSource.mean / c.syncPath.mean, 0) / comparisons.length;
  const avgSyncVsAsyncGen = comparisons.reduce((sum, c) => sum + c.asyncAsyncSource.mean / c.syncPath.mean, 0) / comparisons.length;

  console.log(`\nAverage speedup of sync path vs async (sync source): ${avgSyncVsAsync.toFixed(1)}x`);
  console.log(`Average speedup of sync path vs async (async generator): ${avgSyncVsAsyncGen.toFixed(1)}x`);
  console.log('\nRecommendation: Use sync APIs (fromSync, pullSync, bytesSync) when source data is synchronously available.');
}

async function runBenchmarks(): Promise<ThreeWayComparison[]> {
  const comparisons: ThreeWayComparison[] = [];

  // ============================================================================
  // Scenario 1: bytes() consumption
  // ============================================================================
  console.log('Running: bytes() consumption...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 2000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const syncResult = await benchmark(
      'Sync Path',
      async () => {
        const result = Stream.bytesSync(Stream.fromSync(chunks));
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    const asyncSyncResult = await benchmark(
      'Async (sync src)',
      async () => {
        const result = await Stream.bytes(Stream.from(chunks));
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    const asyncAsyncResult = await benchmark(
      'Async (async src)',
      async () => {
        async function* source() {
          for (const chunk of chunks) yield chunk;
        }
        const result = await Stream.bytes(Stream.from(source()));
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    comparisons.push({
      scenario: 'bytes() (8KB x 2000)',
      syncPath: syncResult,
      asyncSyncSource: asyncSyncResult,
      asyncAsyncSource: asyncAsyncResult,
    });
  }

  // ============================================================================
  // Scenario 2: text() consumption
  // ============================================================================
  console.log('Running: text() consumption...');
  {
    const text = 'Hello, World! This is a test. '.repeat(10000);
    const textBytes = new TextEncoder().encode(text);
    const chunkSize = 1024;
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < textBytes.length; i += chunkSize) {
      chunks.push(textBytes.subarray(i, Math.min(i + chunkSize, textBytes.length)));
    }
    const totalBytes = textBytes.length;

    const syncResult = await benchmark(
      'Sync Path',
      async () => {
        const result = Stream.textSync(Stream.fromSync(chunks));
        if (result.length !== text.length) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    const asyncSyncResult = await benchmark(
      'Async (sync src)',
      async () => {
        const result = await Stream.text(Stream.from(chunks));
        if (result.length !== text.length) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    const asyncAsyncResult = await benchmark(
      'Async (async src)',
      async () => {
        async function* source() {
          for (const chunk of chunks) yield chunk;
        }
        const result = await Stream.text(Stream.from(source()));
        if (result.length !== text.length) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    comparisons.push({
      scenario: 'text() (1KB chunks)',
      syncPath: syncResult,
      asyncSyncSource: asyncSyncResult,
      asyncAsyncSource: asyncAsyncResult,
    });
  }

  // ============================================================================
  // Scenario 3: Pipeline with transform
  // ============================================================================
  console.log('Running: Pipeline with identity transform...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 1000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const syncTransform: SyncTransform = (batch) => batch;
    const asyncTransform: Transform = (batch) => batch;

    const syncResult = await benchmark(
      'Sync Path',
      async () => {
        const pipeline = Stream.pullSync(Stream.fromSync(chunks), syncTransform);
        const result = Stream.bytesSync(pipeline);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    const asyncSyncResult = await benchmark(
      'Async (sync src)',
      async () => {
        const pipeline = Stream.pull(Stream.from(chunks), asyncTransform);
        const result = await Stream.bytes(pipeline);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    const asyncAsyncResult = await benchmark(
      'Async (async src)',
      async () => {
        async function* source() {
          for (const chunk of chunks) yield chunk;
        }
        const pipeline = Stream.pull(Stream.from(source()), asyncTransform);
        const result = await Stream.bytes(pipeline);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    comparisons.push({
      scenario: 'Transform (4KB x 1000)',
      syncPath: syncResult,
      asyncSyncSource: asyncSyncResult,
      asyncAsyncSource: asyncAsyncResult,
    });
  }

  // ============================================================================
  // Scenario 4: Iteration consumption
  // ============================================================================
  console.log('Running: Iteration consumption...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 1000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const syncResult = await benchmark(
      'Sync Path',
      async () => {
        let total = 0;
        for (const batch of Stream.pullSync(Stream.fromSync(chunks))) {
          for (const chunk of batch) {
            total += chunk.length;
          }
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    const asyncSyncResult = await benchmark(
      'Async (sync src)',
      async () => {
        let total = 0;
        for await (const batch of Stream.from(chunks)) {
          for (const chunk of batch) {
            total += chunk.length;
          }
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    const asyncAsyncResult = await benchmark(
      'Async (async src)',
      async () => {
        async function* source() {
          for (const chunk of chunks) yield chunk;
        }
        let total = 0;
        for await (const batch of Stream.from(source())) {
          for (const chunk of batch) {
            total += chunk.length;
          }
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    comparisons.push({
      scenario: 'Iteration (8KB x 1000)',
      syncPath: syncResult,
      asyncSyncSource: asyncSyncResult,
      asyncAsyncSource: asyncAsyncResult,
    });
  }

  // ============================================================================
  // Scenario 5: Many tiny chunks (extreme async overhead)
  // ============================================================================
  console.log('Running: Many tiny chunks...');
  {
    const chunkSize = 64;
    const chunkCount = 20000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const syncResult = await benchmark(
      'Sync Path',
      async () => {
        const result = Stream.bytesSync(Stream.fromSync(chunks));
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    const asyncSyncResult = await benchmark(
      'Async (sync src)',
      async () => {
        const result = await Stream.bytes(Stream.from(chunks));
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    const asyncAsyncResult = await benchmark(
      'Async (async src)',
      async () => {
        async function* source() {
          for (const chunk of chunks) yield chunk;
        }
        const result = await Stream.bytes(Stream.from(source()));
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 30, minTimeMs: 3000 }
    );

    comparisons.push({
      scenario: 'Tiny chunks (64B x 20000)',
      syncPath: syncResult,
      asyncSyncSource: asyncSyncResult,
      asyncAsyncSource: asyncAsyncResult,
    });
  }

  return comparisons;
}

// Main
console.log('Benchmark: Sync vs Async API Comparison');
console.log('Comparing sync path (fromSync + pullSync + bytesSync) vs async path');
console.log('(minimum 30 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printThreeWayComparison)
  .catch(console.error);
