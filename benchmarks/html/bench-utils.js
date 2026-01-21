/**
 * Shared benchmark utilities for browser benchmarks.
 */

/**
 * Run a benchmark function multiple times and measure performance.
 * @param {string} name - Benchmark name
 * @param {() => Promise<void>} fn - Async function to benchmark
 * @param {object} options - Benchmark options
 * @returns {Promise<{name: string, ops: number, ms: number, iterations: number}>}
 */
export async function bench(name, fn, options = {}) {
  const {
    warmup = 5,
    iterations = 50,
    minTimeMs = 1000,
  } = options;
  
  // Warmup
  for (let i = 0; i < warmup; i++) {
    await fn();
  }
  
  // Allow GC between warmup and measurement
  await new Promise(r => setTimeout(r, 10));
  
  // Run iterations
  let totalMs = 0;
  let count = 0;
  const startTime = performance.now();
  
  while (count < iterations || totalMs < minTimeMs) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    totalMs += (end - start);
    count++;
    
    // Safety limit
    if (count > iterations * 10) break;
  }
  
  const avgMs = totalMs / count;
  const ops = 1000 / avgMs;
  
  return {
    name,
    ops,
    ms: avgMs,
    iterations: count,
  };
}

/**
 * Run a sync benchmark function.
 * @param {string} name - Benchmark name
 * @param {() => void} fn - Sync function to benchmark
 * @param {object} options - Benchmark options
 * @returns {{name: string, ops: number, ms: number, iterations: number}}
 */
export function benchSync(name, fn, options = {}) {
  const {
    warmup = 10,
    iterations = 100,
    minTimeMs = 1000,
  } = options;
  
  // Warmup
  for (let i = 0; i < warmup; i++) {
    fn();
  }
  
  // Run iterations
  let totalMs = 0;
  let count = 0;
  
  while (count < iterations || totalMs < minTimeMs) {
    const start = performance.now();
    fn();
    const end = performance.now();
    totalMs += (end - start);
    count++;
    
    // Safety limit
    if (count > iterations * 10) break;
  }
  
  const avgMs = totalMs / count;
  const ops = 1000 / avgMs;
  
  return {
    name,
    ops,
    ms: avgMs,
    iterations: count,
  };
}

/**
 * Format benchmark results as a comparison table.
 * @param {Array<{name: string, ops: number, ms: number}>} results
 * @returns {string}
 */
export function formatResults(results) {
  if (results.length === 0) return 'No results';
  
  // Find the fastest
  const maxOps = Math.max(...results.map(r => r.ops));
  
  let output = '';
  output += '┌─────────────────────────────────┬──────────────┬───────────┬──────────┐\n';
  output += '│ Benchmark                       │     ops/sec  │    ms/op  │ relative │\n';
  output += '├─────────────────────────────────┼──────────────┼───────────┼──────────┤\n';
  
  for (const r of results) {
    const relative = r.ops / maxOps;
    const relStr = relative === 1 ? 'fastest' : `${(relative * 100).toFixed(1)}%`;
    const name = r.name.padEnd(31).slice(0, 31);
    const ops = r.ops.toFixed(1).padStart(12);
    const ms = r.ms.toFixed(3).padStart(9);
    const rel = relStr.padStart(8);
    output += `│ ${name} │ ${ops} │ ${ms} │ ${rel} │\n`;
  }
  
  output += '└─────────────────────────────────┴──────────────┴───────────┴──────────┘';
  
  return output;
}

/**
 * Format a single comparison between two results.
 * @param {{name: string, ops: number}} newStream
 * @param {{name: string, ops: number}} webStream
 * @returns {string}
 */
export function formatComparison(newStream, webStream) {
  const ratio = newStream.ops / webStream.ops;
  const faster = ratio > 1;
  const diff = faster ? ratio : 1 / ratio;
  const winner = faster ? 'New Streams' : 'Web Streams';
  
  return `${winner} is ${diff.toFixed(2)}x faster`;
}

/**
 * Create a visual bar comparison.
 * @param {number} newOps
 * @param {number} webOps
 * @param {number} width
 * @returns {string}
 */
export function formatBar(newOps, webOps, width = 40) {
  const maxOps = Math.max(newOps, webOps);
  const newWidth = Math.round((newOps / maxOps) * width);
  const webWidth = Math.round((webOps / maxOps) * width);
  
  const newBar = '█'.repeat(newWidth) + '░'.repeat(width - newWidth);
  const webBar = '█'.repeat(webWidth) + '░'.repeat(width - webWidth);
  
  return `New Streams: ${newBar} ${newOps.toFixed(1)} ops/s\nWeb Streams: ${webBar} ${webOps.toFixed(1)} ops/s`;
}

/**
 * Generate test data of specified size.
 * @param {number} sizeBytes
 * @returns {Uint8Array}
 */
export function generateData(sizeBytes) {
  const data = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) {
    data[i] = i % 256;
  }
  return data;
}

/**
 * Generate test data chunks.
 * @param {number} chunkSize
 * @param {number} numChunks
 * @returns {Uint8Array[]}
 */
export function generateChunks(chunkSize, numChunks) {
  const chunks = [];
  for (let i = 0; i < numChunks; i++) {
    const chunk = new Uint8Array(chunkSize);
    for (let j = 0; j < chunkSize; j++) {
      chunk[j] = (i + j) % 256;
    }
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * CSS styles for benchmark pages.
 */
export const benchmarkStyles = `
  :root {
    --bg: #1a1a2e;
    --surface: #16213e;
    --primary: #0f3460;
    --accent: #e94560;
    --text: #eaeaea;
    --text-muted: #a0a0a0;
    --code-bg: #0d1b2a;
    --success: #4ecca3;
    --warning: #ffc107;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    margin: 0;
    padding: 2rem;
    line-height: 1.6;
  }
  .container { max-width: 900px; margin: 0 auto; }
  h1 { color: var(--accent); margin-bottom: 0.5rem; }
  h2 { color: var(--accent); margin-top: 2rem; }
  .subtitle { color: var(--text-muted); margin-bottom: 2rem; }
  a { color: var(--accent); }
  .nav { margin-bottom: 1rem; }
  .nav a { margin-right: 1rem; }
  
  .output {
    background: var(--code-bg);
    border-radius: 8px;
    padding: 1.5rem;
    font-family: 'SF Mono', Monaco, 'Courier New', monospace;
    font-size: 0.85rem;
    white-space: pre-wrap;
    word-wrap: break-word;
    min-height: 200px;
    overflow: auto;
  }
  
  .results-table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
  }
  .results-table th,
  .results-table td {
    padding: 0.75rem 1rem;
    text-align: left;
    border-bottom: 1px solid var(--primary);
  }
  .results-table th {
    background: var(--surface);
    color: var(--accent);
  }
  .results-table tr:hover {
    background: var(--surface);
  }
  
  .bar-container {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .bar {
    height: 20px;
    background: var(--accent);
    border-radius: 3px;
    transition: width 0.3s;
  }
  .bar.web {
    background: var(--primary);
  }
  
  .status {
    padding: 0.5rem 1rem;
    border-radius: 4px;
    margin-bottom: 1rem;
  }
  .status.running {
    background: var(--warning);
    color: #000;
  }
  .status.complete {
    background: var(--success);
    color: #000;
  }
  
  .comparison {
    font-size: 1.2rem;
    font-weight: bold;
    padding: 1rem;
    background: var(--surface);
    border-radius: 8px;
    margin: 1rem 0;
  }
  .comparison.faster {
    border-left: 4px solid var(--success);
  }
  .comparison.slower {
    border-left: 4px solid var(--warning);
  }
  
  button {
    background: var(--accent);
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 4px;
    font-size: 1rem;
    cursor: pointer;
    margin-right: 0.5rem;
  }
  button:hover {
    opacity: 0.9;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
