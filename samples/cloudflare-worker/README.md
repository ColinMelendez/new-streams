# Cloudflare Worker: Stream API Comparison

This Cloudflare Worker demonstrates the differences between the standard Web Streams API
and the new streams API in a real-world scenario, highlighting key architectural differences.

## What it does

Both endpoints perform the same operation:

1. **Generate** 10 MB of random lorem ipsum text
2. **Transform** the stream by batching output into 16 KB chunks
3. **Hash** each chunk with SHA-256 and log to console
4. **Return** the data to the HTTP response

## Endpoints

- `GET /` - Usage information and performance notes
- `GET /web-streams` - Process using Web Streams API
- `GET /new-streams` - Process using new streams API (optimized)

### Query Parameters

- `?seed=<number>` - Random seed for reproducible output (default: 42)

## Setup

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## Usage

```bash
# Test web streams implementation
curl -o /dev/null http://localhost:8787/web-streams

# Test new streams implementation
curl -o /dev/null http://localhost:8787/new-streams

# Use a specific seed for reproducible output
curl -o /dev/null http://localhost:8787/new-streams?seed=123
```

## Key Architectural Difference: Branching vs Tapping

### Web Streams: Must Branch with `tee()`

```typescript
// Create source and transform
const source = new ReadableStream({ ... });
const batched = source.pipeThrough(batchTransform);

// MUST tee() to observe AND return data
const [responseBranch, hashBranch] = batched.tee();

// Two separate consumers, each with their own buffers
processHashes(hashBranch);  // Runs concurrently
return new Response(responseBranch);
```

**Problems:**
- `tee()` duplicates the entire stream
- Two separate consumers with independent buffers
- More memory usage, more coordination overhead
- Limited to exactly 2 branches

### New Streams API: Simple Pipeline with `tap()`

```typescript
// Single pipeline with inline observation
const pipeline = Stream.pull(
  Stream.from(generateLoremIpsum()),  // Source
  batchTransform,                      // Transform
  Stream.tap(async (chunks) => {       // Observe without branching!
    for (const chunk of chunks) {
      const hash = await crypto.subtle.digest('SHA-256', chunk);
      console.log(toHex(hash));
    }
  })
);

return new Response(toReadableStream(pipeline));
```

**Benefits:**
- No branching needed - `tap()` observes inline
- Single pipeline, single buffer
- Chunks pass through unchanged
- Much simpler mental model

## Performance Optimizations

### 1. `Stream.tap()` for Observation
```typescript
Stream.tap(async (chunks) => {
  // Observe chunks without creating a branch
  // Chunks pass through unchanged
});
```
- No broadcast/tee overhead
- No stream duplication
- Hash computation is just a side effect in the pipeline

### 2. Generator-based Source
```typescript
async function* generateLoremIpsum() {
  while (bytesGenerated < targetSize) {
    yield generateParagraph();
  }
}
const source = Stream.from(generateLoremIpsum());
```
- Clean async generator vs manual `ReadableStream` controller
- Natural backpressure via `for await...of`

### 3. Batch-oriented Processing
```typescript
// New API yields Uint8Array[] batches, not individual chunks
for await (const batch of pipeline) {
  for (const chunk of batch) { ... }
}
```
- Reduces per-item overhead and function call costs
- Better cache utilization
- Enables batch-level optimizations

### 4. Parallel Hash Computation
```typescript
Stream.tap(async (chunks) => {
  // Hash all chunks in batch concurrently
  const results = await Promise.all(
    chunks.map(chunk => crypto.subtle.digest('SHA-256', chunk))
  );
});
```
- Leverages batch structure for parallelization
- Better utilization of async I/O subsystem

### 5. Lazy Pipeline Execution
```typescript
// Pipeline is lazy - nothing runs until consumed
const pipeline = Stream.pull(source, transform1, transform2);

// Data flows on-demand as response is read
return new Response(toReadableStream(pipeline));
```
- No eager buffering or coordination
- Memory efficient - only buffers what's needed
- Natural backpressure from response consumption

## Comparison Summary

| Aspect | Web Streams | New Streams API |
|--------|-------------|-----------------|
| Observation | Requires `tee()` branching | `Stream.tap()` inline |
| Stream count | 2 (duplicated) | 1 (single pipeline) |
| Buffers | 2 (one per branch) | 1 |
| Data model | Single chunks | Batched `Uint8Array[]` |
| Source creation | `new ReadableStream()` | `Stream.from(generator)` |
| Complexity | Higher (coordination) | Lower (linear pipeline) |

## Viewing Hash Logs

When running locally with `npm run dev`, hash logs appear in the terminal.

When deployed, use `npm run tail` to stream logs from your production worker.
