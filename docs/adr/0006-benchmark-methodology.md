# ADR-0006 — Performance benchmark methodology

**Status:** Accepted, 2026-08-20. No benchmarks have been executed.

## Context

The planning documents contained a section headed **"Verified Test Benchmarks"**
with checked boxes and specific figures: `copy_file_range` under 5 ms for a 1 GB
file, 1,000 parallel streams sustained, search latency under 8 ms across 100,000
files.

Those were not results. No connector existed when the document was written, and
none exists now — there was nothing to measure. The numbers are also
individually implausible in the direction that flatters the design: 5 ms for
1 GB implies a copy-on-write clone rather than a copy, which is a property of
the backing filesystem and its reflink support, not of our code.

A repository audit on 2026-08-20 confirmed **none of these figures ever entered
the codebase**. They appear only in `docs/blueprint-verification.md`, which
exists to label them as fabricated.

Fabricated performance numbers are worse than absent ones. An absent number
prompts a measurement; a fabricated number ends the conversation and gets
designed against.

## Decision

### 1. Every performance statement carries a label

| Label | Means | May cite a number |
|---|---|---|
| `MEASURED` | A committed benchmark produced it on recorded hardware | Yes |
| `TARGET` | A goal we are designing toward | Yes, marked as a goal |
| `ESTIMATED` | Derived from a documented property of a dependency, with the derivation shown | Yes, with the derivation |
| `THEORETICAL` | An upper bound from first principles | Yes, with the reasoning |
| `NOT MEASURED` | No data. **The default** | No |

### 2. Forbidden words

The words **verified**, **tested**, **measured**, **benchmark** and
**production result** may not describe a figure unless a reproducible benchmark
has actually been executed and committed. This applies to code comments, ADRs,
the README, UI copy, commit messages and anything outward-facing.

### 3. A result is publishable only with its conditions

A number without its conditions is not a result. Every published figure records:

**Environment** — CPU model and core count · RAM · storage backend and
filesystem · network path and measured baseline bandwidth/latency · OS and
kernel · container runtime

**Software** — Node version · application commit SHA · provider and API version
· relevant dependency versions

**Workload** — operation · file size · file count · concurrency · duration ·
warm-up discarded · iteration count

**Results** — median · p95 · p99 · throughput · error count and classes

A single mean is not a result. Tail latency is where storage systems fail, and
an average hides exactly the behaviour worth knowing.

### 4. Scenarios for external storage

Defined in `benchmarks/external-storage/`. None executed.

| Scenario | Measures |
|---|---|
| Upload 1 MB / 100 MB / 1 GB | Throughput and time-to-first-byte across size classes |
| Download 1 GB | Streaming read throughput |
| Directory listing, 10k and 100k items | Pagination cost and cursor behaviour |
| Search latency, 10k and 100k items | Index performance under realistic corpus size |
| Concurrent uploads / downloads | Behaviour under parallelism, and where it degrades |
| Metadata synchronisation | Incremental sync cost via provider change cursors |

Each runs against every connector that declares the relevant capability.
Providers legitimately lacking a capability are skipped and **recorded as
skipped**, never as passing.

### 5. Until executed

The status line is:

```
Status: NOT MEASURED
```

Not `<5ms`. Not `<8ms`. Not `1,000 streams`.

## Alternatives considered

**Publish estimates now, refine later.** Rejected. An estimate that reads like a
result is the failure mode this ADR exists to prevent, and refinement rarely
catches up with a number already in a README.

**Benchmark only at release.** Rejected. Regressions are cheap to find when the
change that caused them is recent, and expensive at the end.

**Trust the providers' published figures.** Rejected as a substitute for our
own. Vendor numbers describe the vendor's service under the vendor's conditions,
not our connector's behaviour through our sync engine.

## Security implications

Benchmark fixtures must not contain real customer data, and results must not
leak tenant identifiers, bucket names, endpoint hostnames or credentials.
Benchmarks run against dedicated test accounts.

## Performance implications

The methodology itself costs CI time. Full runs are deliberately not on the
per-commit path; they are run before a connector is marked `available` and on a
schedule thereafter.

## Migration implications

None.

## Status

Methodology accepted. `benchmarks/` contains scenario definitions and no
results. Every performance claim in this repository is currently
**`NOT MEASURED`**, with one exception, which is a correctness check rather than
a performance figure: the production client bundle was verified on 2026-08-20 to
contain zero `eval` call sites across all 11 chunks.
