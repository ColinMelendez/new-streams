/**
 * Basic Stream Creation Examples
 *
 * This file demonstrates the various ways to create streams using the new Streams API.
 */

import { Stream } from '../src/index.js';
import {section, uppercaseTransform } from './util.js';
const enc = new TextEncoder();

async function main() {
  // ============================================================================
  // Stream.from() - Create streams from existing data
  // ============================================================================
  section('Stream.from() - Creating streams from data');

  // From a string (UTF-8 encoded)
  {
    const text = await Stream.text(Stream.from('Hello, World!'));
    console.log('From string:', text);
  }

  // From a Uint8Array
  {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const text = await Stream.text(Stream.from(bytes));
    console.log('From Uint8Array:', text);
  }

  // From an ArrayBuffer
  {
    const buffer = enc.encode('From ArrayBuffer').buffer;
    const text = await Stream.text(Stream.from(buffer));
    console.log('From ArrayBuffer:', text);
  }

  // From an array of chunks (arrays are iterable)
  {
    const chunks = ['chunk1', ' ', 'chunk2', ' ', 'chunk3'];
    const text = await Stream.text(Stream.from(chunks));
    console.log('From array of chunks:', text);
  }

  // From a generator function
  {
    function* generateChunks() {
      yield 'generated';
      yield ' ';
      yield 'chunks';
    }
    const text = await Stream.text(Stream.from(generateChunks()));
    console.log('From generator:', text);
  }

  // ============================================================================
  // Empty streams - just use empty arrays or generators
  // ============================================================================
  section('Empty streams');

  {
    const bytes = await Stream.bytes(Stream.from([]));
    console.log('Empty stream bytes length:', bytes.length);

    // Iteration yields nothing
    const empty2 = Stream.from([]);
    let count = 0;
    for await (const chunks of empty2) {
      count += chunks.length;
    }
    console.log('Empty stream chunk count:', count);
  }

  // ============================================================================
  // Stream.pull() - Create pull-through pipelines with transforms
  // ============================================================================
  section('Stream.pull() - Pull pipelines');

  // Synchronous generator as source
  {
    function* lines() {
      yield 'line 1\n';
      yield 'line 2\n';
      yield 'line 3\n';
    }
    const text = await Stream.text(Stream.pull(lines()));
    console.log('Sync generator output:', text.trim());
  }

  // Async generator - great for I/O operations
  {
    async function* asyncChunks() {
      await new Promise(resolve => setTimeout(resolve, 10));
      yield 'async chunk 1\n';
      await new Promise(resolve => setTimeout(resolve, 10));
      yield 'async chunk 2\n';
      await new Promise(resolve => setTimeout(resolve, 10));
      yield 'async chunk 3\n';
    }
    const text = await Stream.text(Stream.pull(asyncChunks()));
    console.log('Async generator output:', text.trim());
  }

  // With a transform
  {
    const readable = Stream.pull(
      Stream.from(['hello', ' ', 'world']),
      uppercaseTransform()
    );
    const text = await Stream.text(readable);
    console.log('With transform:', text);
  }

  // ============================================================================
  // Stream.push() - Create streams with a writer (push-based)
  // ============================================================================
  section('Stream.push() - Push-based streams');

  // Basic push stream
  {
    const { writer, readable } = Stream.push();

    // Write data asynchronously
    (async () => {
      await writer.write('Hello ');
      await writer.write('from ');
      await writer.write('push!');
      await writer.end();
    })();

    const text = await Stream.text(readable);
    console.log('Push stream output:', text);
  }

  // Push stream with buffer configuration
  {
    const { writer, readable } = Stream.push({
      highWaterMark: 10,  // Max slots in buffer AND max pending writes
      backpressure: 'strict'  // Default - catches ignored backpressure
    });

    console.log('Initial desiredSize:', writer.desiredSize);
    await writer.write('12345'); // 5 bytes
    console.log('After write desiredSize:', writer.desiredSize);
    await writer.end();

    // Consume the readable
    await Stream.bytes(readable);
  }

  // Sync writes with writeSync
  {
    const { writer, readable } = Stream.push({ highWaterMark: 100 });

    // Try sync write - returns true if successful
    const success1 = writer.writeSync('sync write 1');
    const success2 = writer.writeSync('sync write 2');
    console.log('Sync writes succeeded:', success1 && success2);
    console.log('Desired size after sync writes:', writer.desiredSize);

    await writer.end();
    console.log('Desired size after end():', writer.desiredSize);
    const text = await Stream.text(readable);
    console.log('Sync write output:', text);
  }

  // Transforms can be applied directly in push()
  {
    // Transforms are applied lazily when consumer pulls
    const { writer, readable } = Stream.push(uppercaseTransform());

    await writer.write('lowercase input');
    await writer.end();

    const text = await Stream.text(readable);
    console.log('Push with transform:', text);
  }

  // ============================================================================
  // ToStreamable Protocol - Custom objects that convert to streams
  // ============================================================================
  section('ToStreamable Protocol - Custom streamable objects');

  // Objects with toStreamable can be used as chunks in streams
  {
    // Define a class that implements the ToStreamable protocol
    class JsonMessage {
      constructor(private data: object) {}

      // The protocol method - returns sync streamable yield
      [Stream.toStreamable](): string {
        return JSON.stringify(this.data);
      }
    }

    // Create a generator that yields JsonMessage objects
    function* messageSource() {
      yield new JsonMessage({ type: 'hello', value: 1 });
      yield '\n';
      yield new JsonMessage({ type: 'world', value: 2 });
    }

    const text = await Stream.text(Stream.from(messageSource()));
    console.log('ToStreamable output:', text);
  }

  // ToStreamable can return arrays, iterables, nested structures
  {
    class MultiPartMessage {
      constructor(private parts: string[]) {}

      *[Stream.toStreamable](): Generator<string> {
        for (let i = 0; i < this.parts.length; i++) {
          yield `${i > 0 ? '|' : ''}${this.parts[i]}`;
        }
      }
    }

    const readable = Stream.from([new MultiPartMessage(['header', 'body', 'footer'])]);
    const text = await Stream.text(readable);
    console.log('MultiPart ToStreamable:', text);
  }

  // toString is also supported
  {
    // Define a class that implements the ToStreamable protocol
    class JsonMessage {
      constructor(private data: object) {}

      // The protocol method - returns sync streamable yield
      toString(): string {
        return JSON.stringify(this.data);
      }
    }

    // Create a generator that yields JsonMessage objects
    function* messageSource() {
      yield new JsonMessage({ type: 'hello', value: 1 });
      yield '\n';
      yield new JsonMessage({ type: 'world', value: 2 });
    }

    const text = await Stream.text(Stream.from(messageSource()));
    console.log('ToString output:', text);
  }

  // toPrimitive is also supported
  {
    // Define a class that implements the ToStreamable protocol
    class JsonMessage {
      constructor(private data: object) {}

      // The protocol method - returns sync streamable yield
      [Symbol.toPrimitive](): string {
        return JSON.stringify(this.data);
      }
    }

    // Create a generator that yields JsonMessage objects
    function* messageSource() {
      yield new JsonMessage({ type: 'hello', value: 1 });
      yield '\n';
      yield new JsonMessage({ type: 'world', value: 2 });
    }

    const text = await Stream.text(Stream.from(messageSource()));
    console.log('ToPrimitive output:', text);
  }

  // ============================================================================
  // ToAsyncStreamable Protocol - Async conversion
  // ============================================================================
  section('ToAsyncStreamable Protocol - Async streamable objects');

  // Objects can implement toAsyncStreamable for async conversion
  // This is similar to toStreamable but can return async iterables or promises.
  {
    class LazyData {
      constructor(private getData: () => Promise<string>) {}

      // Async protocol - can return promises or async iterables
      async *[Stream.toAsyncStreamable]() {
        yield await this.getData();
      }
    }

    // Simulated async data fetch
    const lazyObj = new LazyData(async () => {
      await new Promise(r => setTimeout(r, 10));
      return 'async fetched data';
    });

    const text = await Stream.text(Stream.from([lazyObj]));
    console.log('ToAsyncStreamable output:', text);
  }

  // Object can implement both protocols (sync and async)
  {
    class SmartBuffer {
      constructor(private content: string) {}

      // Sync version - used in sync contexts
      [Stream.toStreamable](): string {
        return this.content;
      }

      // Async version - preferred in async contexts, can do async processing
      async *[Stream.toAsyncStreamable]() {
        // Could do async compression, transformation, etc.
        yield `[async] ${this.content}`;
      }
    }

    // In async context, toAsyncStreamable is preferred
    const asyncText = await Stream.text(Stream.from([new SmartBuffer('hello')]));
    console.log('SmartBuffer async:', asyncText);

    // In sync context, only toStreamable works
    const syncText = Stream.textSync(Stream.fromSync([new SmartBuffer('world')]));
    console.log('SmartBuffer sync:', syncText);
  }

  console.log('\n--- Examples complete! ---\n');
}

main().catch(console.error);
