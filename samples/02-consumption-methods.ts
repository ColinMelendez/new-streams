/**
 * Stream Consumption Methods
 *
 * This file demonstrates the various ways to consume/read data from streams.
 */

import { Stream } from '../src/index.js';
import { section } from './util.js';

// Shared decoder instance for efficiency
const decoder = new TextDecoder();

async function main() {
  // ============================================================================
  // Stream.bytes() - Consume entire stream as Uint8Array
  // ============================================================================
  section('Stream.bytes() - Get all bytes');

  {
    const bytes = await Stream.bytes(Stream.from('Hello, bytes!'));
    console.log('Type:', bytes.constructor.name);
    console.log('Length:', bytes.length);
    console.log('First 5 bytes:', Array.from(bytes.slice(0, 5)));
  }

  // With signal for cancellation
  {
    const { writer, readable } = Stream.push();

    // Start a slow write
    (async () => {
      await writer.write('chunk1');
      await new Promise(r => setTimeout(r, 100));
      await writer.write('chunk2');
      await writer.end();
    })();

    try {
      await Stream.bytes(readable, { signal: AbortSignal.timeout(50) });
    } catch (e) {
      console.log('bytes() cancelled:', (e as Error).name);
    }
  }

  // With limit to prevent memory exhaustion
  {
    const readable = Stream.from('This is a long string that exceeds our limit');
    try {
      await Stream.bytes(readable, { limit: 10 });
    } catch (e) {
      console.log('bytes() limit exceeded:', (e as Error).message);
    }
  }

  // ============================================================================
  // Stream.arrayBuffer() - Consume entire stream as ArrayBuffer
  // ============================================================================
  section('Stream.arrayBuffer() - Get as ArrayBuffer');

  {
    const buffer = await Stream.arrayBuffer(Stream.from('Hello, ArrayBuffer!'));
    console.log('Type:', buffer.constructor.name);
    console.log('Byte length:', buffer.byteLength);
  }

  // ============================================================================
  // Stream.text() - Consume entire stream as decoded string
  // ============================================================================
  section('Stream.text() - Get as string');

  // Default UTF-8 decoding
  {
    const text = await Stream.text(Stream.from('Hello, text!'));
    console.log('Decoded text:', text);
  }

  // Explicit encoding
  {
    // Create UTF-16LE encoded data
    const utf16bytes = new Uint8Array([0x48, 0x00, 0x69, 0x00]); // "Hi" in UTF-16LE
    const readable = Stream.from(utf16bytes);
    const text = await Stream.text(readable, { encoding: 'utf-16le' });
    console.log('UTF-16LE decoded:', text);
  }

  // ============================================================================
  // Async iteration - for await...of
  // ============================================================================
  section('Async iteration - for await...of');

  // Basic iteration - yields Uint8Array[] batches
  {
    const readable = Stream.from(['chunk1\n', 'chunk2\n', 'chunk3\n']);
    console.log('Iterating over batches:');
    for await (const chunks of readable) {
      for (const chunk of chunks) {
        console.log('  Got:', decoder.decode(chunk).trim());
      }
    }
  }

  // Breaking early terminates the stream
  {
    async function* countingGenerator() {
      let i = 0;
      try {
        while (true) {
          yield `chunk${i++}`;
          await new Promise(r => setTimeout(r, 10));
        }
      } finally {
        console.log('Generator cleanup called at i =', i);
      }
    }

    const readable = Stream.from(countingGenerator());

    console.log('\nBreaking early:');
    for await (const chunks of readable) {
      for (const chunk of chunks) {
        console.log('  Got:', decoder.decode(chunk));
        break; // Break inner loop
      }
      break; // Break outer loop
    }
  }

  // ============================================================================
  // Sync consumers - bytesSync, textSync, arrayBufferSync
  // ============================================================================
  section('Sync consumers');

  {
    const bytes = Stream.bytesSync(Stream.fromSync('Hello, sync!'));
    console.log('bytesSync length:', bytes.length);
  }

  {
    const text = Stream.textSync(Stream.fromSync('Hello, text sync!'));
    console.log('textSync:', text);
  }

  {
    const readable = Stream.fromSync('Hello, arrayBuffer sync!');
    const buffer = Stream.arrayBufferSync(readable);
    console.log('arrayBufferSync byteLength:', buffer.byteLength);
  }

  // Sync iteration
  {
    const readable = Stream.fromSync(['sync1', 'sync2', 'sync3']);
    console.log('\nSync iteration:');
    for (const chunks of readable) {
      for (const chunk of chunks) {
        console.log('  Got:', decoder.decode(chunk));
      }
    }
  }

  console.log('\n--- Examples complete! ---\n');
}

main().catch(console.error);
