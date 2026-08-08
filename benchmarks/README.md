# Hikari Studio Large Project Benchmark

The release benchmark is generated in memory and does not touch user projects.

Profile:

- 10 chapters and 100 Fragments
- 10,000 Blocks
- 5,000 assets
- 1,000 timeline clips with 2,000 keyframes

Run the shared TypeScript engine benchmark:

```powershell
cd frontend
pnpm run benchmark:large-project
```

The frontend benchmark runs Node with `--expose-gc`. `heapDeltaBytes` measures the
raw allocation pressure before collection, while `retainedHeapDeltaBytes` measures
the heap still retained after an explicit collection outside the timed region.

It measures fixture generation, JSON serialization and parsing, asset references,
diagnostics, Web build preflight, 1,000 timeline evaluations, and preview seeking
across all 100 Fragments. Preview seeking reports both cold fragment execution and
an exact-cache pass so snapshot reuse remains covered by the release budget.

Run the Windows desktop persistence benchmark:

```powershell
python -m benchmarks.large_project_backend
```

It measures v3 directory-project save and reload duration, disk size, and peak
Python allocation. Reload duration is measured without `tracemalloc`; peak memory
uses a separate reload pass so allocation tracing does not inflate the desktop
latency result. Both commands emit a JSON line suitable for CI collection and fail
when a release budget is exceeded.

## Installed desktop reload profiling

The Windows editor records one correlated reload profile from Python project
loading through the first stable React paint. Open **Application Maintenance >
Reload Performance** to inspect the latest result. The same report is written as
structured `details` in the standard Windows application log at
`logs/hikari-studio.jsonl`.

The report separates Python project reads, Python JSON serialization, WebView2
bridge transfer, frontend JSON parsing, recovery/history loading, React commit,
and stable-paint latency. It only includes timings, payload size, and aggregate
project counts; project text, asset contents, and paths are excluded.
