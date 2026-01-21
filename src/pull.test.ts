/**
 * Tests for Pull Pipeline - pull(), pullSync(), pipeTo(), pipeToSync()
 *
 * Requirements covered: See REQUIREMENTS.md Sections 3-4 (PULL-xxx, PIPE-xxx)
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { pull, pullSync, pipeTo, pipeToSync } from './pull.js';
import { fromSync, from } from './from.js';
import type { Writer, SyncWriter, Transform, SyncTransform } from './types.js';
import { concatBytes } from './utils.js';

// Helper to collect all bytes from an async iterable
async function collectBytes(source: AsyncIterable<Uint8Array[]>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const batch of source) {
    chunks.push(...batch);
  }
  return concatBytes(chunks);
}

// Helper to collect all bytes from a sync iterable
function collectBytesSync(source: Iterable<Uint8Array[]>): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const batch of source) {
    chunks.push(...batch);
  }
  return concatBytes(chunks);
}

// Helper to decode Uint8Array to string
function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// Create a mock sync writer for testing
function createMockSyncWriter(): SyncWriter & { chunks: Uint8Array[]; closed: boolean; aborted: Error | undefined } {
  const writer = {
    chunks: [] as Uint8Array[],
    closed: false,
    aborted: undefined as Error | undefined,
    get desiredSize() {
      return this.closed ? null : 10;
    },
    write(chunk: Uint8Array | string) {
      if (this.closed) throw new Error('Writer is closed');
      const data = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      this.chunks.push(data);
    },
    writev(chunks: (Uint8Array | string)[]) {
      for (const chunk of chunks) {
        this.write(chunk);
      }
    },
    end() {
      this.closed = true;
      return this.chunks.reduce((acc, c) => acc + c.byteLength, 0);
    },
    abort(reason?: Error) {
      this.aborted = reason;
      this.closed = true;
    },
  };
  return writer;
}

// Create a mock async writer for testing
function createMockWriter(): Writer & { chunks: Uint8Array[]; closed: boolean; aborted: Error | undefined } {
  const writer = {
    chunks: [] as Uint8Array[],
    closed: false,
    aborted: undefined as Error | undefined,
    get desiredSize() {
      return this.closed ? null : 10;
    },
    async write(chunk: Uint8Array | string) {
      if (this.closed) throw new Error('Writer is closed');
      const data = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      this.chunks.push(data);
    },
    async writev(chunks: (Uint8Array | string)[]) {
      for (const chunk of chunks) {
        await this.write(chunk);
      }
    },
    writeSync(chunk: Uint8Array | string) {
      if (this.closed) return false;
      const data = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      this.chunks.push(data);
      return true;
    },
    writevSync(chunks: (Uint8Array | string)[]) {
      for (const chunk of chunks) {
        if (!this.writeSync(chunk)) return false;
      }
      return true;
    },
    async end() {
      this.closed = true;
      return this.chunks.reduce((acc, c) => acc + c.byteLength, 0);
    },
    endSync() {
      this.closed = true;
      return this.chunks.reduce((acc, c) => acc + c.byteLength, 0);
    },
    async abort(reason?: Error) {
      this.aborted = reason;
      this.closed = true;
    },
    abortSync(reason?: Error) {
      this.aborted = reason;
      this.closed = true;
      return true;
    },
  };
  return writer;
}

describe('pullSync()', () => {
  describe('basic usage', () => {
    it('should pass through source without transforms [PULL-003]', () => {
      const source = fromSync('Hello, World!');
      const output = pullSync(source);
      const result = collectBytesSync(output);
      assert.strictEqual(decode(result), 'Hello, World!');
    });

    it('should apply a single transform [PULL-006]', () => {
      const source = fromSync('hello');
      const toUpper: SyncTransform = (chunks) => {
        if (chunks === null) return null;
        return chunks.map((c) => new TextEncoder().encode(decode(c).toUpperCase()));
      };
      const output = pullSync(source, toUpper);
      const result = collectBytesSync(output);
      assert.strictEqual(decode(result), 'HELLO');
    });

    it('should chain multiple transforms [PULL-007]', () => {
      const source = fromSync('hello');
      const toUpper: SyncTransform = (chunks) => {
        if (chunks === null) return null;
        return chunks.map((c) => new TextEncoder().encode(decode(c).toUpperCase()));
      };
      const addExclaim: SyncTransform = (chunks) => {
        if (chunks === null) return null;
        return chunks.map((c) => new TextEncoder().encode(decode(c) + '!'));
      };
      const output = pullSync(source, toUpper, addExclaim);
      const result = collectBytesSync(output);
      assert.strictEqual(decode(result), 'HELLO!');
    });
  });

  describe('transform output types', () => {
    it('should handle transform returning Uint8Array[] [PULL-010]', () => {
      const source = fromSync('test');
      const transform: SyncTransform = (chunks) => {
        if (chunks === null) return null;
        return [new Uint8Array([65, 66, 67])]; // ABC
      };
      const output = pullSync(source, transform);
      const result = collectBytesSync(output);
      assert.strictEqual(decode(result), 'ABC');
    });

    it('should handle transform returning string (via generator) [PULL-011]', () => {
      const source = fromSync('test');
      const transform: SyncTransform = function* (chunks) {
        if (chunks === null) return;
        yield 'transformed';
      };
      const output = pullSync(source, transform);
      const result = collectBytesSync(output);
      assert.strictEqual(decode(result), 'transformed');
    });

    it('should handle transform returning nested iterables [PULL-012]', () => {
      const source = fromSync('test');
      const transform: SyncTransform = function* (chunks) {
        if (chunks === null) return;
        yield 'a';
        yield (function* () {
          yield 'b';
          yield 'c';
        })();
        yield 'd';
      };
      const output = pullSync(source, transform);
      const result = collectBytesSync(output);
      assert.strictEqual(decode(result), 'abcd');
    });
  });

  describe('stateful transforms', () => {
    it('should support stateful transform object [PULL-030]', () => {
      const source = fromSync(['chunk1', 'chunk2']);
      // Object = stateful transform (receives entire source as iterable)
      const transform: SyncTransform = {
        transform: function* (sourceIter) {
          let count = 0;
          for (const chunks of sourceIter) {
            if (chunks === null) {
              yield `total:${count}`;
            } else {
              count += chunks.length;
              for (const chunk of chunks) {
                yield chunk;
              }
            }
          }
        },
      };
      const output = pullSync(source, transform);
      const result = collectBytesSync(output);
      // Note: Each array element becomes a separate batch, so count = 2
      assert.ok(decode(result).includes('total:'));
    });
  });

  describe('flush signal', () => {
    it('should receive null flush signal at end [PULL-031]', () => {
      const source = fromSync('test');
      let flushed = false;
      const transform: SyncTransform = (chunks) => {
        if (chunks === null) {
          flushed = true;
          return null;
        }
        return chunks;
      };
      const output = pullSync(source, transform);
      collectBytesSync(output);
      assert.strictEqual(flushed, true);
    });
  });
});

describe('pull()', () => {
  describe('basic usage', () => {
    it('should pass through source without transforms [PULL-001]', async () => {
      const source = from('Hello, World!');
      const output = pull(source);
      const result = await collectBytes(output);
      assert.strictEqual(decode(result), 'Hello, World!');
    });

    it('should work with sync source [PULL-002]', async () => {
      const source = fromSync('Sync Source');
      const output = pull(source);
      const result = await collectBytes(output);
      assert.strictEqual(decode(result), 'Sync Source');
    });

    it('should apply a single transform [PULL-004]', async () => {
      const source = from('hello');
      const toUpper: Transform = (chunks) => {
        if (chunks === null) return null;
        return chunks.map((c) => new TextEncoder().encode(decode(c).toUpperCase()));
      };
      const output = pull(source, toUpper);
      const result = await collectBytes(output);
      assert.strictEqual(decode(result), 'HELLO');
    });

    it('should chain multiple transforms [PULL-005]', async () => {
      const source = from('hello');
      const toUpper: Transform = (chunks) => {
        if (chunks === null) return null;
        return chunks.map((c) => new TextEncoder().encode(decode(c).toUpperCase()));
      };
      const addExclaim: Transform = (chunks) => {
        if (chunks === null) return null;
        return chunks.map((c) => new TextEncoder().encode(decode(c) + '!'));
      };
      const output = pull(source, toUpper, addExclaim);
      const result = await collectBytes(output);
      assert.strictEqual(decode(result), 'HELLO!');
    });
  });

  describe('async transforms', () => {
    it('should handle async transform function [PULL-020]', async () => {
      const source = from('test');
      const asyncTransform: Transform = async (chunks) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (chunks === null) return null;
        return chunks;
      };
      const output = pull(source, asyncTransform);
      const result = await collectBytes(output);
      assert.strictEqual(decode(result), 'test');
    });

    it('should handle transform returning promise [PULL-021]', async () => {
      const source = from('test');
      const transform: Transform = (chunks) => {
        return Promise.resolve(chunks);
      };
      const output = pull(source, transform);
      const result = await collectBytes(output);
      assert.strictEqual(decode(result), 'test');
    });

    it('should handle transform returning async generator [PULL-022]', async () => {
      const source = from('test');
      const transform: Transform = async function* (chunks) {
        if (chunks === null) return;
        yield 'async';
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield 'gen';
      };
      const output = pull(source, transform);
      const result = await collectBytes(output);
      assert.strictEqual(decode(result), 'asyncgen');
    });
  });

  describe('options', () => {
    it('should accept options as last argument [PULL-040]', async () => {
      const source = from('test');
      const transform: Transform = (chunks) => chunks;
      const output = pull(source, transform, { signal: undefined });
      const result = await collectBytes(output);
      assert.strictEqual(decode(result), 'test');
    });

    it('should respect AbortSignal [PULL-041]', async () => {
      const controller = new AbortController();
      const source = from(
        (async function* () {
          yield 'chunk1';
          await new Promise((resolve) => setTimeout(resolve, 100));
          yield 'chunk2';
        })()
      );

      const output = pull(source, { signal: controller.signal });

      // Abort after first chunk
      setTimeout(() => controller.abort(), 20);

      await assert.rejects(async () => {
        await collectBytes(output);
      }, /Abort/);
    });

    it('should handle already-aborted signal [PULL-042]', async () => {
      const controller = new AbortController();
      controller.abort();
      const source = from('test');
      const output = pull(source, { signal: controller.signal });

      await assert.rejects(async () => {
        await collectBytes(output);
      }, /Abort/);
    });
  });

  describe('error handling', () => {
    it('should call abort on transforms when error occurs [PULL-032]', async () => {
      let abortCalled = false;
      const source = from('test');
      // Object = stateful transform (receives entire source as async iterable)
      const transform1: Transform = {
        async *transform(source) {
          for await (const chunks of source) {
            if (chunks) yield chunks;
          }
        },
        abort: () => {
          abortCalled = true;
        },
      };
      const transform2: Transform = () => {
        throw new Error('Transform error');
      };

      const output = pull(source, transform1, transform2);

      await assert.rejects(async () => {
        await collectBytes(output);
      }, /Transform error/);

      assert.strictEqual(abortCalled, true);
    });
  });
});

describe('pipeToSync()', () => {
  describe('basic usage', () => {
    it('should write source to writer without transforms [WRITE-004]', () => {
      const source = fromSync('Hello, World!');
      const writer = createMockSyncWriter();
      const bytesWritten = pipeToSync(source, writer);

      assert.strictEqual(bytesWritten, 13);
      assert.strictEqual(writer.closed, true);
      assert.strictEqual(decode(concatBytes(writer.chunks)), 'Hello, World!');
    });

    it('should apply transforms before writing [WRITE-005]', () => {
      const source = fromSync('hello');
      const toUpper: SyncTransform = (chunks) => {
        if (chunks === null) return null;
        return chunks.map((c) => new TextEncoder().encode(decode(c).toUpperCase()));
      };
      const writer = createMockSyncWriter();
      const bytesWritten = pipeToSync(source, toUpper, writer);

      assert.strictEqual(bytesWritten, 5);
      assert.strictEqual(decode(concatBytes(writer.chunks)), 'HELLO');
    });
  });

  describe('options', () => {
    it('should respect preventClose option [WRITE-010]', () => {
      const source = fromSync('test');
      const writer = createMockSyncWriter();
      pipeToSync(source, writer, { preventClose: true });

      assert.strictEqual(writer.closed, false);
    });

    it('should respect preventAbort option [WRITE-011]', () => {
      const source = {
        *[Symbol.iterator]() {
          yield [new TextEncoder().encode('test')];
          throw new Error('Source error');
        },
      };
      const writer = createMockSyncWriter();

      assert.throws(() => {
        pipeToSync(source, writer, { preventAbort: true });
      }, /Source error/);

      assert.strictEqual(writer.aborted, undefined);
    });
  });

  describe('error handling', () => {
    it('should abort writer on source error [WRITE-020]', () => {
      const source = {
        *[Symbol.iterator]() {
          yield [new TextEncoder().encode('test')];
          throw new Error('Source error');
        },
      };
      const writer = createMockSyncWriter();

      assert.throws(() => {
        pipeToSync(source, writer);
      }, /Source error/);

      assert.ok(writer.aborted);
    });

    it('should throw if no writer provided [WRITE-021]', () => {
      const source = fromSync('test');
      assert.throws(() => {
        pipeToSync(source);
      }, /pipeTo requires a writer argument/);
    });
  });
});

describe('pipeTo()', () => {
  describe('basic usage', () => {
    it('should write source to writer without transforms [WRITE-001]', async () => {
      const source = from('Hello, World!');
      const writer = createMockWriter();
      const bytesWritten = await pipeTo(source, writer);

      assert.strictEqual(bytesWritten, 13);
      assert.strictEqual(writer.closed, true);
    });

    it('should work with sync source [WRITE-002]', async () => {
      const source = fromSync('Sync Source');
      const writer = createMockWriter();
      const bytesWritten = await pipeTo(source, writer);

      assert.strictEqual(bytesWritten, 11);
    });

    it('should apply transforms before writing [WRITE-003]', async () => {
      const source = from('hello');
      const toUpper: Transform = (chunks) => {
        if (chunks === null) return null;
        return chunks.map((c) => new TextEncoder().encode(decode(c).toUpperCase()));
      };
      const writer = createMockWriter();
      const bytesWritten = await pipeTo(source, toUpper, writer);

      assert.strictEqual(bytesWritten, 5);
      assert.strictEqual(decode(concatBytes(writer.chunks)), 'HELLO');
    });
  });

  describe('options', () => {
    it('should respect preventClose option [WRITE-010]', async () => {
      const source = from('test');
      const writer = createMockWriter();
      await pipeTo(source, writer, { preventClose: true });

      assert.strictEqual(writer.closed, false);
    });

    it('should respect preventAbort option [WRITE-011]', async () => {
      const source = from(
        (async function* () {
          yield [new TextEncoder().encode('test')];
          throw new Error('Source error');
        })()
      );
      const writer = createMockWriter();

      await assert.rejects(async () => {
        await pipeTo(source, writer, { preventAbort: true });
      }, /Source error/);

      assert.strictEqual(writer.aborted, undefined);
    });

    it('should respect AbortSignal [WRITE-012]', async () => {
      const controller = new AbortController();
      const source = from(
        (async function* () {
          yield [new TextEncoder().encode('chunk1')];
          await new Promise((resolve) => setTimeout(resolve, 100));
          yield [new TextEncoder().encode('chunk2')];
        })()
      );
      const writer = createMockWriter();

      // Abort after first chunk
      setTimeout(() => controller.abort(), 20);

      await assert.rejects(async () => {
        await pipeTo(source, writer, { signal: controller.signal });
      }, /Abort/);
    });
  });

  describe('error handling', () => {
    it('should abort writer on source error [WRITE-020]', async () => {
      const source = from(
        (async function* () {
          yield [new TextEncoder().encode('test')];
          throw new Error('Source error');
        })()
      );
      const writer = createMockWriter();

      await assert.rejects(async () => {
        await pipeTo(source, writer);
      }, /Source error/);

      assert.ok(writer.aborted);
    });

    it('should throw if no writer provided [WRITE-021]', async () => {
      const source = from('test');
      await assert.rejects(async () => {
        await pipeTo(source);
      }, /pipeTo requires a writer argument/);
    });
  });

  describe('transform-writer', () => {
    it('should handle writer that is also a transform [WRITE-030]', async () => {
      const source = from('hello');
      const hashes: string[] = [];
      const writerChunks: Uint8Array[] = [];
      // TransformObject = stateful transform, receives entire source as async iterable
      const hashingWriter: Writer & { transform: (source: AsyncIterable<Uint8Array[] | null>) => AsyncGenerator<Uint8Array[]> } = {
        async *transform(source) {
          for await (const chunks of source) {
            if (chunks) {
              for (const c of chunks) {
                hashes.push(`hash:${c.byteLength}`);
              }
              yield chunks;
            }
          }
        },
        get desiredSize() {
          return 10;
        },
        async write(chunk: Uint8Array | string) {
          const data = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
          writerChunks.push(data);
        },
        async writev(chunks: (Uint8Array | string)[]) {
          for (const chunk of chunks) {
            await this.write(chunk);
          }
        },
        writeSync() { return true; },
        writevSync() { return true; },
        async end() {
          return writerChunks.reduce((acc, c) => acc + c.byteLength, 0);
        },
        endSync() { return 0; },
        async abort() {},
        abortSync() { return true; },
      };

      await pipeTo(source, hashingWriter);

      assert.ok(hashes.length > 0);
      assert.ok(hashes[0].startsWith('hash:'));
    });
  });
});
