/**
 * Text Encoding and Decoding
 *
 * This file demonstrates text encoding/decoding with the new streams API.
 *
 * Key design decision: The new API is UTF-8 only for ENCODING (strings to bytes).
 * However, DECODING (bytes to strings) supports multiple encodings via Stream.text().
 *
 * This simplifies the API while still supporting legacy data formats.
 */

import { Stream } from '../src/index.js';
import { section } from './util.js';

async function main() {
  // ============================================================================
  // UTF-8 Encoding (the only encoding option)
  // ============================================================================
  section('UTF-8 - The Only Encoding');

  {
    // All strings are encoded as UTF-8
    const readable = Stream.from('Hello, World! Bonjour! 你好!');
    const bytes = await Stream.bytes(readable);

    console.log('UTF-8 encoded bytes:', bytes.length);
    console.log('Sample bytes:', Array.from(bytes.slice(0, 10)));

    // Decode back to text (default is UTF-8)
    const decoded = await Stream.text(Stream.from(bytes));
    console.log('Decoded:', decoded);
  }

  // Multi-chunk example
  {
    const readable = Stream.from(['Hello, ', 'World!']);
    const text = await Stream.text(readable);
    console.log('\nMulti-chunk text:', text);
  }

  // ============================================================================
  // Decoding with Different Encodings
  // ============================================================================
  section('Decoding - Multiple Encodings Supported');

  // Default UTF-8 decoding
  {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello" in UTF-8
    const text = await Stream.text(Stream.from(bytes)); // Default: UTF-8
    console.log('UTF-8 decoded:', text);
  }

  // ISO-8859-1 (Latin-1) decoding
  {
    // Latin-1 bytes for "Café" - note é is 0xE9 in Latin-1
    const latin1Bytes = new Uint8Array([67, 97, 102, 0xe9]);
    const readable = Stream.from(latin1Bytes);
    const text = await Stream.text(readable, { encoding: 'iso-8859-1' });
    console.log('Latin-1 decoded:', text);
  }

  // UTF-16LE decoding
  {
    // UTF-16LE bytes for "Hi"
    const utf16leBytes = new Uint8Array([72, 0, 105, 0]); // 'H' = 0x0048, 'i' = 0x0069
    const readable = Stream.from(utf16leBytes);
    const text = await Stream.text(readable, { encoding: 'utf-16le' });
    console.log('UTF-16LE decoded:', text);
  }

  // UTF-16BE decoding
  {
    // UTF-16BE bytes for "Hi"
    const utf16beBytes = new Uint8Array([0, 72, 0, 105]); // 'H' = 0x0048, 'i' = 0x0069
    const readable = Stream.from(utf16beBytes);
    const text = await Stream.text(readable, { encoding: 'utf-16be' });
    console.log('UTF-16BE decoded:', text);
  }

  // Windows-1252 decoding
  {
    // Windows-1252 has special characters in 0x80-0x9F range
    const win1252Bytes = new Uint8Array([0x93, 0x68, 0x69, 0x94]); // "hi" with smart quotes
    const readable = Stream.from(win1252Bytes);
    const text = await Stream.text(readable, { encoding: 'windows-1252' });
    console.log('Windows-1252 decoded:', text);
  }

  // ============================================================================
  // Sync Consumers
  // ============================================================================
  section('Sync Text Decoding');

  {
    const bytes = Stream.bytesSync(Stream.fromSync('Hello from sync!'));
    console.log('Sync bytes:', bytes.length);

    const text = Stream.textSync(Stream.fromSync(bytes));
    console.log('Sync decoded:', text);
  }

  // Sync with encoding option
  {
    const latin1Bytes = new Uint8Array([67, 97, 102, 0xe9]); // "Café"
    const readable = Stream.fromSync(latin1Bytes);
    const text = Stream.textSync(readable, { encoding: 'iso-8859-1' });
    console.log('Sync Latin-1 decoded:', text);
  }

  // ============================================================================
  // Push Streams (always UTF-8)
  // ============================================================================
  section('Push Streams - UTF-8 Only');

  {
    const { writer, readable } = Stream.push();

    // Start consuming in background (important: must start before writes!)
    const textPromise = Stream.text(readable);

    // Write strings (always UTF-8 encoded)
    await writer.write('Push stream ');
    await writer.write('with UTF-8');
    await writer.end();

    const text = await textPromise;
    console.log('Push stream text:', text);
  }

  // Mixed content (strings and binary)
  {
    const { writer, readable } = Stream.push();

    // Start consuming in background
    const textPromise = Stream.text(readable);

    await writer.write('text '); // UTF-8 encoded
    await writer.write(new Uint8Array([240, 159, 154, 128])); // Rocket emoji in UTF-8
    await writer.write(' more text'); // UTF-8 encoded
    await writer.end();

    const text = await textPromise;
    console.log('Mixed content:', text);
  }

  // ============================================================================
  // Working with Legacy Data
  // ============================================================================
  section('Working with Legacy Data');

  // Reading legacy CSV with Latin-1 encoding
  {
    console.log('\n--- Legacy CSV with Latin-1 ---');

    // Simulate reading Latin-1 encoded CSV bytes
    // "name,city\nJosé,São Paulo" in Latin-1
    const latin1Csv = new Uint8Array([
      110, 97, 109, 101, 44, 99, 105, 116, 121, 10, // "name,city\n"
      74, 111, 115, 0xe9, 44, // "José,"
      83, 0xe3, 111, 32, 80, 97, 117, 108, 111, // "São Paulo"
    ]);

    const csvText = await Stream.text(Stream.from(latin1Csv), { encoding: 'iso-8859-1' });
    console.log('Decoded CSV:');
    csvText.split('\n').forEach((line) => console.log('  ' + line));
  }

  // Reading Windows text files
  {
    console.log('\n--- Windows-1252 text file ---');

    // Windows-1252 encoded text with smart quotes and euro sign
    // "Price: €50" with smart quotes
    const win1252Text = new Uint8Array([
      0x93, // opening smart quote
      80, 114, 105, 99, 101, 58, 32, // "Price: "
      0x80, // euro sign in Windows-1252
      53, 48, // "50"
      0x94, // closing smart quote
    ]);

    const text = await Stream.text(Stream.from(win1252Text), { encoding: 'windows-1252' });
    console.log('Windows-1252 text:', text);
  }

  // ============================================================================
  // Error Handling - Invalid Byte Sequences
  // ============================================================================
  section('Error Handling - Invalid Sequences');

  {
    // Invalid UTF-8 sequence (0xFF is not valid in UTF-8)
    const invalidUtf8 = new Uint8Array([72, 101, 108, 108, 111, 0xff, 87, 111, 114, 108, 100]);

    try {
      await Stream.text(Stream.from(invalidUtf8));
      console.log('ERROR: Should have thrown!');
    } catch (e) {
      console.log('Correctly caught invalid UTF-8:', (e as Error).message);
    }
  }

  // Using Latin-1 to read arbitrary bytes (it accepts all byte values 0-255)
  {
    const anyBytes = new Uint8Array([72, 101, 108, 108, 111, 0xff, 87, 111, 114, 108, 100]);

    // Latin-1 maps bytes 1:1 to code points, so it never fails
    const text = await Stream.text(Stream.from(anyBytes), { encoding: 'iso-8859-1' });
    console.log('Latin-1 reads any bytes:', text);
  }

  // ============================================================================
  // Byte Limits
  // ============================================================================
  section('Byte Limits for Safety');

  {
    const largeData = 'x'.repeat(1000);
    const readable = Stream.from(largeData);

    try {
      // Try to read with a small limit
      await Stream.text(readable, { limit: 100 });
      console.log('ERROR: Should have thrown!');
    } catch (e) {
      console.log('Correctly limited:', (e as Error).message);
    }
  }

  // ============================================================================
  // Manual Encoding (when UTF-8 isn't enough)
  // ============================================================================
  section('Manual Encoding for Other Encodings');

  {
    // If you need to encode as something other than UTF-8,
    // use TextEncoder directly (only available for UTF-8)
    // or a library like iconv-lite for other encodings

    console.log('For UTF-8 encoding, use Stream.from(string)');
    console.log('For other encodings, encode manually before streaming:');

    // Example: manually encoding as UTF-16LE using Buffer (Node.js)
    // or you could use a library like iconv-lite
    const text = 'Hello';
    const utf16leBytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      utf16leBytes[i * 2] = code & 0xff; // Low byte
      utf16leBytes[i * 2 + 1] = (code >> 8) & 0xff; // High byte
    }

    console.log('Manually encoded UTF-16LE bytes:', Array.from(utf16leBytes));

    // Now stream the pre-encoded bytes
    const readable = Stream.from(utf16leBytes);
    const decoded = await Stream.text(readable, { encoding: 'utf-16le' });
    console.log('Decoded back:', decoded);
  }

  console.log('\n--- Examples complete! ---\n');
}

main().catch(console.error);
