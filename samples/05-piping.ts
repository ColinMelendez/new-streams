/**
 * Stream Piping with Stream.pipeTo()
 *
 * This file demonstrates how to pipe data through transforms to a writer destination.
 */

import { Stream, type Transform } from '../src/index.js';
import { section, uppercaseTransform, MemoryWriter, SyncMemoryWriter } from './util.js';

// Shared encoder/decoder instances for efficiency
const enc = new TextEncoder();
const dec = new TextDecoder();

async function main() {
  // ============================================================================
  // Basic pipeTo - source to writer
  // ============================================================================
  section('Basic Stream.pipeTo()');

  {
    const source = Stream.from(['Hello', ' ', 'World', '!']);
    const writer = new MemoryWriter();

    const bytesWritten = await Stream.pipeTo(source, writer);

    console.log('Bytes written:', bytesWritten);
    console.log('Result:', writer.getText());
  }

  // ============================================================================
  // pipeTo with transforms
  // ============================================================================
  section('pipeTo with transforms');

  {
    function* addBrackets(chunks) {
      if (chunks === null) return null;
      for (const chunk of chunks) {
        yield enc.encode(`[${dec.decode(chunk)}]`);
      };
    }

    const source = Stream.from(['hello', ' ', 'world']);
    const writer = new MemoryWriter();

    // Transform chain: uppercase -> addBrackets -> writer
    const bytesWritten = await Stream.pipeTo(
      source,
      uppercaseTransform(),
      addBrackets,
      writer
    );

    console.log('Bytes written:', bytesWritten);
    console.log('Transformed result:', writer.getText());
  }

  // ============================================================================
  // pipeTo with options
  // ============================================================================
  section('pipeTo options');

  // preventClose - don't close writer on completion
  {
    const writer = new MemoryWriter();

    // First write
    await Stream.pipeTo(
      Stream.from('First '),
      writer,
      { preventClose: true }
    );

    // Second write to same writer
    await Stream.pipeTo(
      Stream.from('Second'),
      writer,
      { preventClose: true }
    );

    // Manually close
    await writer.end();

    console.log('Multiple writes with preventClose:', writer.getText());
  }

  // With abort signal
  {
    const writer = new MemoryWriter();

    // Create a slow source
    async function* slowSource() {
      yield 'chunk1';
      await new Promise(r => setTimeout(r, 100));
      yield 'chunk2';
      await new Promise(r => setTimeout(r, 100));
      yield 'chunk3';
    }

    try {
      await Stream.pipeTo(
        Stream.from(slowSource()),
        writer,
        { signal: AbortSignal.timeout(50) }
      );
    } catch (e) {
      console.log('pipeTo aborted:', (e as Error).name);
      console.log('Partial write:', writer.getText());
    }
  }

  // ============================================================================
  // pipeToSync - synchronous version
  // ============================================================================
  section('Stream.pipeToSync()');

  {
    const source = Stream.fromSync(['sync', ' ', 'write']);
    const writer = new SyncMemoryWriter();

    const bytesWritten = Stream.pipeToSync(source, writer);

    console.log('Sync bytes written:', bytesWritten);
    console.log('Sync result:', writer.getText());
  }

  // Sync with transform
  {
    const source = Stream.fromSync(['hello', ' ', 'sync']);
    const writer = new SyncMemoryWriter();

    const bytesWritten = Stream.pipeToSync(source, uppercaseTransform(), writer);

    console.log('Sync transformed:', writer.getText());
    console.log('Bytes:', bytesWritten);
  }

  // ============================================================================
  // Piping push stream to writer
  // ============================================================================
  section('Piping push stream');

  {
    const { writer: pushWriter, readable } = Stream.push();
    const destWriter = new MemoryWriter();

    // Start pipe in background
    const pipePromise = Stream.pipeTo(readable, destWriter);

    // Write data
    await pushWriter.write('Data from ');
    await pushWriter.write('push stream');
    await pushWriter.end();

    // Wait for pipe to complete
    const bytesWritten = await pipePromise;

    console.log('Piped from push stream:', destWriter.getText());
    console.log('Bytes:', bytesWritten);
  }

  // ============================================================================
  // Complex pipeline: push -> transform -> writer
  // ============================================================================
  section('Complex pipeline');

  {
    const newLineBytes = new Uint8Array([10]); // '\n'
    const addNewlines: Transform = function* (chunks) {
      if (chunks === null) return;
      for (const chunk of chunks) {
        yield [chunk, newLineBytes];
      }
    };

    const { writer: pushWriter, readable } = Stream.push();
    const destWriter = new MemoryWriter();

    // Setup pipeline: push -> uppercase -> addNewlines -> writer
    const pipePromise = Stream.pipeTo(
      readable,
      uppercaseTransform(),
      addNewlines,
      destWriter
    );

    // Feed data
    await pushWriter.write('line1');
    await pushWriter.write('line2');
    await pushWriter.write('line3');
    await pushWriter.end();

    await pipePromise;

    console.log('Complex pipeline result:');
    console.log(destWriter.getText());
  }

  console.log('\n--- Examples complete! ---\n');
}

main().catch(console.error);
