# External storage benchmarks

**Status: NOT MEASURED.** No scenario in this directory has been executed. No
results exist. Nothing here may be cited as a measurement.

Methodology and the labelling rules are in
[ADR-0006](../../docs/adr/0006-benchmark-methodology.md). The short version:
`MEASURED` requires a committed result produced on recorded hardware. Everything
below is `TARGET` at best, and most of it has no target yet either.

## Why this directory is empty of results

No storage connector exists. Every external provider in the registry is
`status: "planned"` and `availableProviders()` returns `[]`. There is nothing to
benchmark until Phase 1 (S3-compatible) lands — see
[ADR-0004](../../docs/adr/0004-external-storage-federation.md).

## Scenarios

Defined in [`scenarios.json`](scenarios.json). Each names the capability it
requires; a connector that does not declare that capability is **skipped and
recorded as skipped**, never counted as passing.

| Id | Operation | Parameters |
|---|---|---|
| `upload-1mb` | Upload | 1 MB, sequential |
| `upload-100mb` | Upload | 100 MB, sequential |
| `upload-1gb` | Upload | 1 GB, sequential |
| `download-1gb` | Download | 1 GB, streaming |
| `list-10k` | Directory listing | 10,000 items |
| `list-100k` | Directory listing | 100,000 items |
| `search-10k` | Search | 10,000-item corpus |
| `search-100k` | Search | 100,000-item corpus |
| `concurrent-upload-32` | Upload | 32 parallel, 10 MB each |
| `concurrent-download-32` | Download | 32 parallel, 10 MB each |
| `metadata-sync-incremental` | Change-cursor sync | 1,000 changes over a 100,000-item corpus |

## Recording a result

A result is not publishable without its conditions. Write one JSON file per run
into `results/`, named `<provider>-<scenario>-<ISO date>.json`:

```json
{
  "scenario": "upload-100mb",
  "provider": "s3",
  "status": "MEASURED",
  "environment": {
    "cpu": "", "cores": 0, "ramGb": 0,
    "storageBackend": "", "filesystem": "",
    "networkPath": "", "baselineMbps": 0, "baselineRttMs": 0,
    "os": "", "kernel": "", "containerRuntime": ""
  },
  "software": {
    "node": "", "commit": "", "providerApiVersion": ""
  },
  "workload": {
    "fileSizeBytes": 0, "fileCount": 1, "concurrency": 1,
    "iterations": 0, "warmupDiscarded": 0, "durationSeconds": 0
  },
  "results": {
    "medianMs": 0, "p95Ms": 0, "p99Ms": 0,
    "throughputMbps": 0, "errors": 0, "errorClasses": []
  }
}
```

`status` is one of `MEASURED`, `SKIPPED` (capability not declared), or `FAILED`.
There is no status that means "we think it would be fast."

A single mean is not a result — tail latency is where storage systems fail, and
an average hides precisely the behaviour worth knowing.

## Rules

- Run against dedicated test accounts. Never against tenant data.
- Results must not contain tenant identifiers, bucket names, endpoint hostnames
  or credentials.
- Discard warm-up iterations explicitly and record how many.
- Full runs are not on the per-commit path. They gate a connector being marked
  `available`, and run on a schedule after that.
