# Stream API Samples

This folder contains comprehensive examples demonstrating all features of the new Streams API.

## Running Examples

From the project root:

```bash
# Run a specific example
npx tsx samples/01-basic-creation.ts

# Run all examples
for f in samples/*.ts; do echo "=== $f ===" && npx tsx "$f"; done
```

## Example Files

### Core Concepts

| File | Description |
|------|-------------|
| `01-basic-creation.ts` | Creating streams with `from()`, `pull()`, `push()`, `empty()`, `never()` |
| `02-consumption-methods.ts` | Reading data with `bytes()`, `text()`, `read()`, async iteration |
| `03-branching.ts` | Branching with `fork()` |

### Data Transformation

| File | Description |
|------|-------------|
| `04-transforms.ts` | Transform functions, generators, and `fork({ transform })` |
| `05-piping.ts` | `pipeTo()`, `Stream.pipeline()`, and `Stream.writer()` |

### Configuration & Control

| File | Description |
|------|-------------|
| `06-buffer-configuration.ts` | Buffer limits, overflow policies (`error`, `block`, `drop-oldest`, `drop-newest`) |
| `07-encoding.ts` | Text encodings: UTF-8, UTF-16LE, UTF-16BE, ISO-8859-1 |
| `08-cancellation.ts` | Cancellation with `cancel()` and `AbortSignal` |
| `09-resource-management.ts` | Automatic cleanup with `await using` |

### Advanced

| File | Description |
|------|-------------|
| `10-merging-concat.ts` | Combining streams with `merge()` and `concat()` |
| `11-real-world-patterns.ts` | Practical patterns: JSON Lines, CSV, SSE, progress tracking |
| `12-nodejs-interop.ts` | Adapting to/from Node.js streams, error propagation, lifecycle management |
| `13-web-streams-interop.ts` | Bidirectional interop with Web Streams API (ReadableStream, WritableStream, TransformStream) |
| `14-compression.ts` | Streaming compression/decompression with Node.js zlib (gzip, deflate, brotli) |
| `15-encryption.ts` | Streaming encryption/decryption with Node.js crypto (AES-256-GCM, CBC, ChaCha20-Poly1305) |
| `16-pipeline-sync.ts` | Synchronous pipeline processing with `pullSync()` for zero async overhead |
| `17-duplex-channels.ts` | Bidirectional communication with `duplex()` for client-server patterns |

## Browser Samples

The `html/` directory contains browser-based examples demonstrating that the API works in browsers without any Node.js dependencies.

### Running Browser Samples

```bash
# Start the local server
node samples/html/server.mjs

# Open http://localhost:3000/samples/html/ in your browser
```

### Browser Example Files

| File | Description |
|------|-------------|
| `html/01-basic-creation.html` | Creating streams with `from()`, `pull()`, generators |
| `html/02-consumption.html` | Reading with `bytes()`, `text()`, `arrayBuffer()`, iteration |
| `html/03-transforms.html` | Transform functions, generators, chaining |
| `html/04-push-streams.html` | Push-based streams with `push()` and writers |
| `html/05-piping.html` | Piping with `pipeTo()` and transform chains |
| `html/06-branching.html` | Multi-consumer with `broadcast()` and `share()` |
| `html/07-cancellation.html` | Cancellation with `AbortSignal` |
