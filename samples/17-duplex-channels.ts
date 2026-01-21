/**
 * Duplex Channel Examples
 *
 * This file demonstrates bidirectional communication using Stream.duplex().
 * Duplex channels are useful for client-server communication, protocols,
 * and any scenario requiring two-way data flow.
 */

import { Stream } from '../src/index.js';
import { section } from './util.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function decode(chunk: Uint8Array): string {
  return dec.decode(chunk);
}

async function main() {
  // ============================================================================
  // Basic Echo Server
  // ============================================================================
  section('Basic Echo Server');

  {
    const [client, server] = Stream.duplex();

    // Server: echo back everything received
    const serverTask = (async () => {
      console.log('[Server] Started, waiting for messages...');
      for await (const chunks of server.readable) {
        for (const chunk of chunks) {
          console.log('[Server] Received:', decode(chunk));
          await server.writer.write(chunk); // Echo back
        }
      }
      console.log('[Server] Client disconnected');
      await server.close();
    })();

    // Client: send messages and read responses
    await client.writer.write('Hello');
    await client.writer.write('World');
    await client.close(); // Signal we're done sending

    // Read echoed responses
    for await (const chunks of client.readable) {
      for (const chunk of chunks) {
        console.log('[Client] Received echo:', decode(chunk));
      }
    }

    await serverTask;
  }

  // ============================================================================
  // Request-Response Protocol
  // ============================================================================
  section('Request-Response Protocol');

  {
    const [client, server] = Stream.duplex({ highWaterMark: 4 });

    // Simple HTTP-like server
    const serverTask = (async () => {
      for await (const chunks of server.readable) {
        const request = decode(chunks[0]);
        console.log('[Server] Request:', request);

        if (request.startsWith('GET /hello')) {
          await server.writer.write('HTTP/1.1 200 OK\r\n\r\nHello, World!');
        } else if (request.startsWith('GET /time')) {
          await server.writer.write(`HTTP/1.1 200 OK\r\n\r\n${new Date().toISOString()}`);
        } else {
          await server.writer.write('HTTP/1.1 404 Not Found\r\n\r\n');
        }
      }
      await server.close();
    })();

    // Client makes requests
    await client.writer.write('GET /hello HTTP/1.1\r\n');
    await client.close();

    const response = await Stream.text(client.readable);
    console.log('[Client] Response:', response);

    await serverTask;
  }

  // ============================================================================
  // Using await using for Automatic Cleanup
  // ============================================================================
  section('Automatic Cleanup with await using');

  {
    const [client, server] = Stream.duplex();

    // Server with automatic cleanup
    const serverTask = (async () => {
      await using srv = server; // Automatically closed when scope exits
      for await (const chunks of srv.readable) {
        await srv.writer.writev(chunks);
      }
      console.log('[Server] Auto-cleanup triggered');
    })();

    // Client with automatic cleanup
    {
      await using conn = client;
      await conn.writer.write('Auto-cleanup test');
      console.log('[Client] Sent message');
    } // client.close() called automatically here
    console.log('[Client] Auto-cleanup triggered');

    await serverTask;
  }

  // ============================================================================
  // Per-Direction Buffer Configuration
  // ============================================================================
  section('Per-Direction Buffer Configuration');

  {
    // Different buffer sizes for each direction
    // Useful when one direction has higher throughput than the other
    const [client, server] = Stream.duplex({
      a: { highWaterMark: 2, backpressure: 'strict' },  // Client→Server: small buffer
      b: { highWaterMark: 8, backpressure: 'strict' },  // Server→Client: larger buffer
    });

    console.log('Client→Server buffer (a): highWaterMark=2');
    console.log('Server→Client buffer (b): highWaterMark=8');

    // Demonstrate the difference
    console.log('\nClient writer desiredSize:', client.writer.desiredSize); // 2
    console.log('Server writer desiredSize:', server.writer.desiredSize); // 8

    // Fill client→server buffer
    client.writer.writeSync('msg1');
    client.writer.writeSync('msg2');
    console.log('\nAfter 2 client writes, client.writer.desiredSize:', client.writer.desiredSize); // 0

    // Server→Client has more room
    for (let i = 0; i < 8; i++) {
      server.writer.writeSync(`response${i}`);
    }
    console.log('After 8 server writes, server.writer.desiredSize:', server.writer.desiredSize); // 0

    await client.close();
    await server.close();
  }

  // ============================================================================
  // Chat Simulation
  // ============================================================================
  section('Chat Simulation');

  {
    const [alice, bob] = Stream.duplex({ highWaterMark: 10 });

    // Alice's perspective
    const aliceTask = (async () => {
      // Send messages
      await alice.writer.write('Hi Bob!');
      await alice.writer.write('How are you?');

      // Read Bob's responses
      const messages: string[] = [];
      for await (const chunks of alice.readable) {
        for (const chunk of chunks) {
          messages.push(decode(chunk));
        }
      }
      console.log('[Alice] Received from Bob:', messages);
    })();

    // Bob's perspective
    const bobTask = (async () => {
      // Read Alice's messages
      const messages: string[] = [];
      for await (const chunks of bob.readable) {
        for (const chunk of chunks) {
          messages.push(decode(chunk));
        }
      }
      console.log('[Bob] Received from Alice:', messages);

      // Send responses
      await bob.writer.write("Hi Alice!");
      await bob.writer.write("I'm doing great!");
      await bob.close();
    })();

    // Close Alice's writer after a short delay to let messages flow
    await new Promise(resolve => setTimeout(resolve, 10));
    await alice.close();

    await Promise.all([aliceTask, bobTask]);
  }

  // ============================================================================
  // Pipeline with Transforms
  // ============================================================================
  section('Pipeline with Transforms');

  {
    const [client, server] = Stream.duplex();

    // Server uppercases everything
    const serverTask = (async () => {
      for await (const chunks of server.readable) {
        for (const chunk of chunks) {
          const text = decode(chunk).toUpperCase();
          await server.writer.write(text);
        }
      }
      await server.close();
    })();

    // Client sends and receives
    await client.writer.write('hello');
    await client.writer.write('world');
    await client.close();

    const response = await Stream.text(client.readable);
    console.log('Sent: hello world');
    console.log('Received:', response); // HELLOWORLD
    
    await serverTask;
  }

  console.log('\n✓ All duplex examples completed');
}

main().catch(console.error);
