/**
 * Benchmark: Consumption Methods
 *
 * Measures performance of different ways to consume stream data:
 * bytes(), text(), async iteration
 *
 * All three APIs use equivalent patterns for fair comparison.
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

async function runBenchmarks(): Promise<ThreeWayComparison[]> {
  const comparisons: ThreeWayComparison[] = [];

  // ============================================================================
  // Scenario 1: bytes() - collect all data
  // ============================================================================
  console.log('Running: bytes() collection...');
  {
    const chunkSize = 16 * 1024;
    const chunkCount = 500;
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

        const reader = stream.getReader();
        const result: Uint8Array[] = [];
        let totalLength = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          result.push(value);
          totalLength += value.length;
        }

        // Concatenate (equivalent work to bytes())
        const concat = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of result) {
          concat.set(chunk, offset);
          offset += chunk.length;
        }
        if (concat.length !== totalBytes) throw new Error('Wrong size');
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

        const result: Uint8Array[] = [];
        let totalLength = 0;
        for await (const chunk of stream) {
          result.push(chunk);
          totalLength += chunk.length;
        }

        // Concatenate (equivalent work to bytes())
        const concat = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of result) {
          concat.set(chunk, offset);
          offset += chunk.length;
        }
        if (concat.length !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('bytes() (16KB x 500)', newStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 2: text() - decode to string
  // ============================================================================
  console.log('Running: text() decode...');
  {
    const text = 'Hello, World! This is a test message. '.repeat(5000);
    const textBytes = new TextEncoder().encode(text);
    const chunkSize = 1024;
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < textBytes.length; i += chunkSize) {
      chunks.push(textBytes.subarray(i, Math.min(i + chunkSize, textBytes.length)));
    }
    const totalBytes = textBytes.length;

    const newStreamResult = await benchmark(
      'New Stream',
      async () => {
        const source = Stream.from(chunks);
        const result = await Stream.text(source);
        if (result.length !== text.length) throw new Error('Wrong size');
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

        const reader = stream.getReader();
        const result: Uint8Array[] = [];
        let totalLength = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          result.push(value);
          totalLength += value.length;
        }
        const concat = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of result) {
          concat.set(chunk, offset);
          offset += chunk.length;
        }
        const decoded = new TextDecoder().decode(concat);
        if (decoded.length !== text.length) throw new Error('Wrong size');
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

        const result: Uint8Array[] = [];
        let totalLength = 0;
        for await (const chunk of stream) {
          result.push(chunk);
          totalLength += chunk.length;
        }
        const concat = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of result) {
          concat.set(chunk, offset);
          offset += chunk.length;
        }
        const decoded = new TextDecoder().decode(concat);
        if (decoded.length !== text.length) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('text() (1KB chunks)', newStreamResult, webStreamResult, nodeStreamResult));
  }

  // ============================================================================
  // Scenario 3: Async iteration
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
        // New API yields batches (Uint8Array[])
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
  // Scenario 4: Reader-style loop with batches
  // ============================================================================
  console.log('Running: Direct iterator consumption...');
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
        const iterator = source[Symbol.asyncIterator]();
        while (true) {
          const { value, done } = await iterator.next();
          if (done) break;
          // value is Uint8Array[] batch
          for (const chunk of value) {
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

        const reader = stream.getReader();
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
        const stream = new Readable({
          read() {
            if (index < chunks.length) {
              this.push(chunks[index++]);
            } else {
              this.push(null);
            }
          },
        });

        const iterator = stream[Symbol.asyncIterator]();
        let total = 0;
        while (true) {
          const { value, done } = await iterator.next();
          if (done) break;
          total += value.length;
        }
        if (total !== totalBytes) throw new Error('Wrong size');
      },
      { totalBytes, minSamples: 20, minTimeMs: 3000 }
    );

    comparisons.push(createThreeWayComparison('Iterator loop (8KB x 1000)', newStreamResult, webStreamResult, nodeStreamResult));
  }

  return comparisons;
}

// Main
console.log('Benchmark: Consumption Methods');
console.log('Measuring different ways to read stream data');
console.log('Comparing: New Streams vs Web Streams vs Node.js Streams');
console.log('(minimum 20 samples, 3 seconds per test)\n');

runBenchmarks()
  .then(printThreeWayComparison)
  .catch(console.error);
