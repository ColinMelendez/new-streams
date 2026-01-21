/**
 * Merging and Concatenating Streams
 *
 * This file demonstrates stream combining patterns with the new API.
 *
 * Key concepts:
 * - Stream.merge() - temporal interleaving (first-come ordering)
 * - Sequential concatenation via generators (yield* pattern)
 * - Array concatenation for sync sources
 */

import { Stream, type Transform } from '../src/index.js';
import { section } from './util.js';

// Shared encoder/decoder instances for efficiency
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function main() {
  // ============================================================================
  // Sequential concatenation via generators
  // ============================================================================
  section('Sequential concatenation');

  // Basic concatenation using generator
  {
    async function* concat<T>(...sources: AsyncIterable<T>[]) {
      for (const source of sources) {
        yield* source;
      }
    }

    const stream1 = Stream.from('Hello ');
    const stream2 = Stream.from('World');
    const stream3 = Stream.from('!');

    const combined = concat(stream1, stream2, stream3);
    const text = await Stream.text(combined);

    console.log('Concatenated:', text);
  }

  // Using from() with nested iterables (automatic flattening)
  {
    // Stream.from() flattens nested iterables, so we can use arrays
    const parts = ['Part1 ', 'Part2 ', 'Part3'];
    const readable = Stream.from(parts);
    console.log('From array:', await Stream.text(readable));
  }

  // Sequential from async generators
  {
    async function* part1() {
      yield 'First ';
      await new Promise((r) => setTimeout(r, 20));
      yield 'part';
    }

    async function* part2() {
      yield ' Second ';
      await new Promise((r) => setTimeout(r, 20));
      yield 'part';
    }

    async function* combined() {
      yield* Stream.from(part1());
      yield* Stream.from(part2());
    }

    const text = await Stream.text(combined());
    console.log('Sequential async:', text);
  }

  // Sync concatenation
  {
    function* syncConcat() {
      yield 'Sync ';
      yield 'concat ';
      yield 'parts';
    }

    const readable = Stream.fromSync(syncConcat());
    const text = Stream.textSync(readable);
    console.log('Sync concat:', text);
  }

  // ============================================================================
  // Stream.merge() - Temporal interleaving
  // ============================================================================
  section('Stream.merge() - Temporal interleaving');

  // Basic merge - interleaves data from multiple streams
  {
    async function* fast() {
      yield 'F1';
      await new Promise((r) => setTimeout(r, 10));
      yield 'F2';
      await new Promise((r) => setTimeout(r, 10));
      yield 'F3';
    }

    async function* slow() {
      await new Promise((r) => setTimeout(r, 15));
      yield 'S1';
      await new Promise((r) => setTimeout(r, 15));
      yield 'S2';
    }

    const merged = Stream.merge(Stream.from(fast()), Stream.from(slow()));

    const chunks: string[] = [];
    for await (const batches of merged) {
      for (const chunk of batches) {
        chunks.push(decoder.decode(chunk));
      }
    }

    console.log('Merged order:', chunks.join(' '));
    console.log('(first-come ordering, not round-robin)');
  }

  // Empty sources
  {
    const merged = Stream.merge();
    const bytes = await Stream.bytes(merged);
    console.log('Empty merge:', bytes.length, 'bytes');
  }

  // Single source
  {
    const single = Stream.from('single source');
    const merged = Stream.merge(single);
    console.log('Single merge:', await Stream.text(merged));
  }

  // Many sources
  {
    async function* makeSource(id: number) {
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, Math.random() * 20));
        yield `[${id}:${i}]`;
      }
    }

    const sources = [Stream.from(makeSource(1)), Stream.from(makeSource(2)), Stream.from(makeSource(3))];

    const merged = Stream.merge(...sources);

    const chunks: string[] = [];
    for await (const batches of merged) {
      for (const chunk of batches) {
        chunks.push(decoder.decode(chunk));
      }
    }

    console.log('Many sources merged:', chunks.join(' '));
  }

  // ============================================================================
  // Merge with AbortSignal
  // ============================================================================
  section('Merge with cancellation');

  {
    async function* infiniteSource(id: string) {
      let i = 0;
      while (true) {
        yield `${id}:${i++}`;
        await new Promise((r) => setTimeout(r, 30));
      }
    }

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const merged = Stream.merge(Stream.from(infiniteSource('A')), Stream.from(infiniteSource('B')), {
      signal: controller.signal,
    });

    const chunks: string[] = [];
    try {
      for await (const batches of merged) {
        for (const chunk of batches) {
          chunks.push(decoder.decode(chunk));
        }
      }
    } catch (e) {
      console.log('Merge aborted:', (e as Error).name);
    }

    console.log('Chunks before abort:', chunks.join(' '));
  }

  // ============================================================================
  // Error handling in merge
  // ============================================================================
  section('Error handling in merge');

  {
    async function* goodSource() {
      yield 'good';
      await new Promise((r) => setTimeout(r, 50));
      yield 'more good';
    }

    async function* badSource() {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('Source error!');
    }

    const merged = Stream.merge(Stream.from(goodSource()), Stream.from(badSource()));

    try {
      await Stream.text(merged);
    } catch (e) {
      console.log('Error propagated:', (e as Error).message);
    }
  }

  // ============================================================================
  // Practical patterns
  // ============================================================================
  section('Practical patterns');

  // Multi-part form data assembly (sequential)
  {
    console.log('\n--- Multi-part assembly ---');

    async function* multipartBody() {
      const boundary = '----boundary----';

      yield `${boundary}\r\n`;
      yield `Content-Disposition: form-data; name="field1"\r\n\r\n`;
      yield 'value1';
      yield `\r\n${boundary}\r\n`;
      yield `Content-Disposition: form-data; name="field2"\r\n\r\n`;
      yield 'value2';
      yield `\r\n${boundary}--\r\n`;
    }

    const result = await Stream.text(Stream.from(multipartBody()));
    console.log('Assembled multipart:');
    result.split('\r\n').forEach((line) => console.log('  ' + line));
  }

  // HTTP chunked transfer encoding
  {
    console.log('\n--- Chunked transfer encoding ---');

    function* chunkedEncode(chunks: string[]) {
      for (const chunk of chunks) {
        const encoded = encoder.encode(chunk);
        yield `${encoded.length.toString(16)}\r\n`;
        yield encoded;
        yield '\r\n';
      }
      yield '0\r\n\r\n'; // Final chunk
    }

    const chunks = ['Hello', ' ', 'World', '!'];
    const chunkedBody = Stream.fromSync(chunkedEncode(chunks));
    const result = Stream.textSync(chunkedBody);

    console.log('Chunked encoding:');
    result.split('\r\n').forEach((line, i) => {
      if (line) console.log(`  ${i}: "${line}"`);
    });
  }

  // Log aggregation from multiple servers
  {
    console.log('\n--- Log aggregation ---');

    async function* serverLogs(name: string, delay: number) {
      yield `[${name}] Starting...\n`;
      await new Promise((r) => setTimeout(r, delay));
      yield `[${name}] Processing...\n`;
      await new Promise((r) => setTimeout(r, delay));
      yield `[${name}] Done.\n`;
    }

    const aggregated = Stream.merge(
      Stream.from(serverLogs('ServerA', 10)),
      Stream.from(serverLogs('ServerB', 15)),
      Stream.from(serverLogs('ServerC', 12))
    );

    console.log('Aggregated logs:');
    for await (const batches of aggregated) {
      for (const chunk of batches) {
        const line = decoder.decode(chunk).trim();
        console.log('  ' + line);
      }
    }
  }

  // HTTP response assembly
  {
    console.log('\n--- HTTP response assembly ---');

    async function* httpResponse() {
      yield 'HTTP/1.1 200 OK\r\n';
      yield 'Content-Type: text/plain\r\n';
      yield 'X-Custom: value\r\n';
      yield '\r\n';
      yield 'Response body content';
    }

    const response = Stream.from(httpResponse());
    const result = await Stream.text(response);

    console.log('Assembled response:');
    result.split('\r\n').forEach((line) => {
      console.log('  ' + (line || '(empty line)'));
    });
  }

  // Race pattern with merge
  {
    console.log('\n--- Race pattern (first to finish wins) ---');

    async function* source1() {
      await new Promise((r) => setTimeout(r, 50));
      yield 'Source1 won';
    }

    async function* source2() {
      await new Promise((r) => setTimeout(r, 30));
      yield 'Source2 won';
    }

    async function* source3() {
      await new Promise((r) => setTimeout(r, 70));
      yield 'Source3 won';
    }

    // Race: take first value from merged stream
    const merged = Stream.merge(Stream.from(source1()), Stream.from(source2()), Stream.from(source3()));

    let winner = '';
    for await (const batches of merged) {
      for (const chunk of batches) {
        winner = decoder.decode(chunk);
        break;
      }
      break;
    }

    console.log('Winner:', winner);
  }

  // Combining with transforms
  {
    console.log('\n--- Merge with transforms ---');

    const addPrefix =
      (prefix: string): Transform =>
      (chunks) => {
        if (chunks === null) return null;
        return chunks.map((chunk) => {
          const text = decoder.decode(chunk);
          return encoder.encode(`${prefix}${text}`);
        });
      };

    async function* source1() {
      yield 'msg1';
      await new Promise((r) => setTimeout(r, 20));
      yield 'msg2';
    }

    async function* source2() {
      await new Promise((r) => setTimeout(r, 10));
      yield 'msgA';
      await new Promise((r) => setTimeout(r, 20));
      yield 'msgB';
    }

    // Apply different prefixes to each source
    const prefixed1 = Stream.pull(Stream.from(source1()), addPrefix('[S1] '));
    const prefixed2 = Stream.pull(Stream.from(source2()), addPrefix('[S2] '));

    const merged = Stream.merge(prefixed1, prefixed2);

    const messages: string[] = [];
    for await (const batches of merged) {
      for (const chunk of batches) {
        messages.push(decoder.decode(chunk));
      }
    }

    console.log('Merged with prefixes:', messages.join(', '));
  }

  console.log('\n--- Examples complete! ---\n');
}

main().catch(console.error);
