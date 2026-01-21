/**
 * Benchmark 17: Bun Direct ReadableStream
 *
 * Bun-only benchmark comparing the New Streams API against Bun's Direct
 * ReadableStream, which uses type: "direct" and controller.write() for
 * zero-copy data transfer without internal queue management.
 *
 * Direct ReadableStream bypasses the standard chunk queueing mechanism —
 * controller.write() sends data directly to the consumer rather than
 * copying it into an internal queue. This benchmark measures whether
 * that optimization matters versus the New Streams API's pull-based
 * batch iteration design.
 *
 * Both APIs are consumer-driven (pull-based). The key differences:
 *   - Direct RS: controller.write() + flush() → zero-copy to consumer, no queue
 *   - New Streams: Stream.from() → batched async iteration (Uint8Array[])
 *
 * Note: Direct RS requires controller.flush() after write() to send data
 * to the consumer in a one-per-pull pattern. close() implicitly flushes.
 *
 * Scenarios 1–3 use one-chunk-per-pull for a fair structural comparison.
 * Scenario 4 tests async iteration consumption.
 * Scenario 5 tests each API's optimal source-to-bytes path (burst mode).
 *
 * Run with: bun run benchmarks/17-bun-direct-streams.ts
 */

import { Stream } from '../src/index.js';
import {
  benchmark,
  BenchmarkResult,
  generateChunks,
  formatBytesPerSec,
  formatTime,
} from './utils.js';

// ---------------------------------------------------------------------------
// Bun runtime check — exit gracefully on Node.js / Deno
// ---------------------------------------------------------------------------
// @ts-ignore - Bun global
if (typeof Bun === 'undefined') {
  console.log('Benchmark 17: Bun Direct ReadableStream');
  console.log('NOTE: This benchmark requires Bun. Skipping.\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all bytes from a ReadableStream via reader.read() loop */
async function collectBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
    totalLength += value.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Create a Bun Direct ReadableStream that yields one chunk per pull() call.
 * This mirrors the standard ReadableStream pull pattern but uses write()
 * instead of enqueue() for zero-copy transfer.
 *
 * Important: controller.flush() must be called after write() in one-per-pull
 * mode. Without it, writes are buffered and the consumer never receives data.
 * (close() implicitly flushes, but we need flush() for intermediate writes.)
 */
function createDirectStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    type: 'direct',
    pull(controller: any) {
      if (index < chunks.length) {
        controller.write(chunks[index++]);
        controller.flush();
      } else {
        controller.close();
      }
    },
  } as any);
}

/**
 * Create a Bun Direct ReadableStream that writes ALL chunks in a single
 * pull() call. This is the "burst write" pattern — Direct RS's intended
 * sweet spot where the producer pushes all available data without yielding
 * between chunks.
 */
function createBurstDirectStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    type: 'direct',
    pull(controller: any) {
      for (const chunk of chunks) {
        controller.write(chunk);
      }
      controller.close();
    },
  } as any);
}

// ---------------------------------------------------------------------------
// Custom two-way comparison with "Bun Direct" label
// ---------------------------------------------------------------------------

interface BunComparison {
  scenario: string;
  newStream: BenchmarkResult;
  bunDirect: BenchmarkResult;
  speedup: number;
  confidence: string;
}

function createBunComparison(
  scenario: string,
  newStream: BenchmarkResult,
  bunDirect: BenchmarkResult
): BunComparison {
  const speedup =
    newStream.bytesPerSec && bunDirect.bytesPerSec
      ? newStream.bytesPerSec / bunDirect.bytesPerSec
      : bunDirect.mean / newStream.mean;

  // Significance check (same logic as assessSignificance in utils.ts)
  const cv1 = newStream.stdDev / newStream.mean;
  const cv2 = bunDirect.stdDev / bunDirect.mean;
  const combinedCV = Math.sqrt(cv1 * cv1 + cv2 * cv2);
  const threshold = 1 + 2 * combinedCV;
  const confidence =
    speedup > threshold || speedup < 1 / threshold ? 'significant' : 'within noise';

  return { scenario, newStream, bunDirect, speedup, confidence };
}

function printBunComparison(comparisons: BunComparison[]): void {
  console.log('\n' + '='.repeat(110));
  console.log('BENCHMARK RESULTS — New Streams API vs Bun Direct ReadableStream');
  console.log('(higher throughput = better)');
  console.log('='.repeat(110));

  const headers = ['Scenario', 'New Stream', 'Bun Direct', 'Difference', 'Significance'];
  const colWidths = [34, 20, 20, 18, 14];

  console.log(headers.map((h, i) => h.padEnd(colWidths[i])).join(' | '));
  console.log(colWidths.map((w) => '-'.repeat(w)).join('-+-'));

  for (const c of comparisons) {
    const fmt = (r: BenchmarkResult) =>
      r.bytesPerSec ? formatBytesPerSec(r.bytesPerSec) : formatTime(r.mean);

    const speedupStr =
      c.speedup >= 1
        ? `${c.speedup.toFixed(2)}x faster`
        : `${(1 / c.speedup).toFixed(2)}x slower`;

    const row = [
      c.scenario.substring(0, colWidths[0] - 1),
      fmt(c.newStream),
      fmt(c.bunDirect),
      c.confidence === 'within noise' ? '~same' : speedupStr,
      c.confidence,
    ];

    console.log(row.map((v, i) => v.padEnd(colWidths[i])).join(' | '));
  }

  console.log('='.repeat(110));

  const significant = comparisons.filter((c) => c.confidence === 'significant');
  const faster = significant.filter((c) => c.speedup >= 1).length;
  const slower = significant.filter((c) => c.speedup < 1).length;
  const noise = comparisons.length - significant.length;

  console.log(
    `\nSummary: New Stream ${faster} faster, ${slower} slower, ${noise} within noise vs Bun Direct`
  );
  console.log(`Samples per benchmark: ${comparisons[0]?.newStream.iterations || 'N/A'}`);
}

// ---------------------------------------------------------------------------
// Benchmark scenarios
// ---------------------------------------------------------------------------

async function runBenchmarks(): Promise<BunComparison[]> {
  const comparisons: BunComparison[] = [];

  // ============================================================================
  // Scenario 1: Large chunks (64KB each)
  //   One chunk per pull — isolates the zero-copy vs queue overhead at large sizes
  // ============================================================================
  console.log('Running: Large chunks (64KB)...');
  {
    const chunkSize = 64 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newResult = await benchmark(
      'New Stream',
      async () => {
        const source = Stream.from(chunks);
        const result = await Stream.bytes(source);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const bunResult = await benchmark(
      'Bun Direct',
      async () => {
        const stream = createDirectStream(chunks);
        const result = await collectBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createBunComparison('Large chunks (64KB x 500)', newResult, bunResult));
  }

  // ============================================================================
  // Scenario 2: Medium chunks (4KB each)
  //   Typical I/O chunk sizes — tests per-chunk overhead at realistic scale
  // ============================================================================
  console.log('Running: Medium chunks (4KB)...');
  {
    const chunkSize = 4 * 1024;
    const chunkCount = 4096;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newResult = await benchmark(
      'New Stream',
      async () => {
        const source = Stream.from(chunks);
        const result = await Stream.bytes(source);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const bunResult = await benchmark(
      'Bun Direct',
      async () => {
        const stream = createDirectStream(chunks);
        const result = await collectBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createBunComparison('Medium chunks (4KB x 4096)', newResult, bunResult));
  }

  // ============================================================================
  // Scenario 3: Small chunks (100 bytes each)
  //   Per-chunk overhead dominates — tests scheduling and object creation costs
  // ============================================================================
  console.log('Running: Small chunks (100B)...');
  {
    const chunkSize = 100;
    const chunkCount = 10000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newResult = await benchmark(
      'New Stream',
      async () => {
        const source = Stream.from(chunks);
        const result = await Stream.bytes(source);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const bunResult = await benchmark(
      'Bun Direct',
      async () => {
        const stream = createDirectStream(chunks);
        const result = await collectBytes(stream);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createBunComparison('Small chunks (100B x 10000)', newResult, bunResult));
  }

  // ============================================================================
  // Scenario 4: Async iteration (for-await consumption)
  //   Both sides use an async generator source so each chunk crosses an async
  //   boundary — this ensures a fair per-chunk comparison. (Stream.from(array)
  //   would batch everything into 1 microtask, making the comparison meaningless.)
  // ============================================================================
  console.log('Running: Async iteration...');
  {
    const chunkSize = 8 * 1024;
    const chunkCount = 1000;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newResult = await benchmark(
      'New Stream',
      async () => {
        async function* source() {
          for (const chunk of chunks) {
            yield chunk;
          }
        }
        const stream = Stream.from(source());
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

    const bunResult = await benchmark(
      'Bun Direct',
      async () => {
        const stream = createDirectStream(chunks);
        let total = 0;
        // @ts-ignore - Bun supports async iteration on ReadableStream
        for await (const chunk of stream) {
          total += chunk.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createBunComparison('Async iteration (8KB x 1000)', newResult, bunResult));
  }

  // ============================================================================
  // Scenario 5: Optimal byte collection — each API's fastest path
  //   New Streams:  Stream.from(chunks) -> Stream.bytes()
  //   Bun Direct:   burst-write Direct RS -> new Response(stream).arrayBuffer()
  //
  //   The burst-write pattern writes all chunks in a single pull() call,
  //   which is Direct RS's designed sweet spot. Response.arrayBuffer() is
  //   Bun's potentially optimized native consumption path.
  // ============================================================================
  console.log('Running: Optimal byte collection...');
  {
    const chunkSize = 64 * 1024;
    const chunkCount = 500;
    const totalBytes = chunkSize * chunkCount;
    const chunks = generateChunks(chunkSize, chunkCount);

    const newResult = await benchmark(
      'New Stream',
      async () => {
        const source = Stream.from(chunks);
        const result = await Stream.bytes(source);
        if (result.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    const bunResult = await benchmark(
      'Bun Direct',
      async () => {
        const stream = createBurstDirectStream(chunks);
        const ab = await new Response(stream).arrayBuffer();
        if (ab.byteLength !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(
      createBunComparison('Optimal collection (64KB x 500)', newResult, bunResult)
    );
  }

  return comparisons;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('Benchmark 17: Bun Direct ReadableStream');
console.log('Comparing: New Streams API vs Bun Direct ReadableStream (type: "direct")');
console.log('Direct RS bypasses queue management for zero-copy data transfer');
console.log('(minimum 20 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printBunComparison)
  .catch(console.error);
