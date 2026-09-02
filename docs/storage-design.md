# Storage Backend Design: Content-Addressed Deduplication

## Decision summary

| question | decision |
| -------- | -------- |
| dedup unit | **1-level: whole-content hash** (hash -> unique row) |
| 2-level (block chunks)? | **no** — measured pure overhead on images, marginal (+1.6pp at 40x rows) on text |
| storage | **objects on filesystem**, sqlite keeps only the tree index |
| object layout | **dynamic bucket sharding** with path stored in DB row |
| versioned text-heavy datasets | **use git as the backend** instead (pluggable port) |
| text-only without similar files | **btrfs zstd compression is sufficient**, no store-level compression |
| delta compression (git-style) | future mode only, for versioned text — immutable datasets have no history to compress |

The rest of this doc records the measurements and reasoning behind these choices.

## The two levels considered

- **1-level (whole-content hash)**: dedup unit = entire file. A `content`
  table keyed by hash; files reference it. Dedups byte-identical files.
- **2-level (block chunks)**: dedup unit = fixed-size chunks of each file,
  sharing chunks across files. Targets partial sharing (e.g. tail-only changes,
  cross-file boilerplate) — at the cost of chunk tables, refcounts, and
  multi-row reassembly on read.

## Measured redundancy on real datasets

### AI image datasets (compressed formats)

data: `feelingss-ai/datasets` — Vomit Object Dataset/image_marked (280 files, 120 MB)
+ Animal Breed + Vomit + Diarrhea AI TEST (20,405 files, 4.0 GB)

| metric | value |
| ------ | ----- |
| files | 20,685 |
| unique contents | 19,899 |
| duplicated copies | 786 (701 shared groups, max 6 copies of one file) |
| wasted by exact duplicates | 0.136 GB (3.3%) |
| block-level sharing @ 256B / 4K / 64K | 0.3% at every size |

Reading: compressed images are immutable artifacts — no block sharing exists, and
the only redundancy is byte-identical copies across label folders / train-test
splits. Whole-file hash captures 100% of it.

### Text corpus (tslib on this machine, 125.6 MB)

| strategy | saved | rows |
| -------- | ----- | ---- |
| whole-file (level 1) | 14.3 MB (11.4%) | 10,606 |
| fixed blocks @ 256B | 16.3 MB (13.0%) | 431,770 |
| fixed blocks @ 64K | 14.8 MB (11.7%) | 11,670 |

Reading: block-level converges *down* to the whole-file number as block size
grows. The max gain from block-level is +1.6pp (256B) at the cost of 40x rows.
Where does the duplication live? ~2,900 duplicate copies under
`node_modules/.pnpm/*` (es-abstract x1850, pnpm x734, repo-root x340) — i.e.
identical *files*, which whole-file hash already catches. tslib's own source
(652 files, no node_modules): 0.0% duplication at any granularity.

Note: an earlier run of this experiment (see block-size-analysis.md) reported
~75% savings at small block sizes on a larger tslib snapshot; that measured the
dedup of a corpus containing many exact-duplicate files (built dist + pnpm
copies of whole packages) where whole-file dedup applies too.

## Conclusion: level 1 only

1. **Level 1 (whole-content hash)** is the workhorse: `content` table keyed by
   hash + refcount. One row per unique content. Captures identical files.
2. **Level 2 (block/parts) is retired** for this workload: +1.6pp saving at
   best, for 40x rows, and 0% on compressed data. Fixed blocks also collapse
   when a file is edited (boundary shift). Keep only as a documented future
   mode, and only with content-defined chunking (rolling hash) — fixed-size
   blocks are the worst of both worlds (weak savings AND row explosion AND
   edit fragility).

## How git handles the same problem (reference design)

git's storage engine validates the level-1 choice, then adds a measured delta layer:

- **Loose objects**: every file is a blob addressed by `SHA-1(content)` — exactly
  the `content` table idea. Same content stored once. No blocks anywhere.
- **Packfile deltas** (lazy, at repack time): sort candidates by (type, path
  name-hash, size), slide a window (`--window`, default 10) over the sorted
  order, compute a delta for each pair, and **keep it only if it is actually
  smaller** than the whole object. Delta format = copy/insert instructions, so
  any edit position is captured byte-exactly (verified: 50KB file, 1 line
  changed mid-file → v2 stored as a 35-byte delta).
- **GC by reachability**, not refcount — simpler, never stale, but requires
  periodic GC.

Lesson: dedup by hash at write time (cheap, exact); compress by delta at rest
(lazy, measured, keep-whichever-is-smaller). The "try and keep if smaller" step
makes the whole thing format-agnostic — images fail the test and stay whole.
This is a reusable design principle: **let the outcome self-select** — no
mimetype sniffing or format detection needed; run the cheap check and keep
whichever result is smaller.

But git's delta layer exists for **version history** (v(n) vs v(n-1) edits over
time). A dataset store holds immutable files written once — there is no history
to compress. So for dedup-fs's target workloads, git minus history == level 1,
and the block design solves a problem we don't have.

## Schema (level 1, objects on filesystem)

Preferred variant: sqlite keeps only the tree index; each unique content is a
file on disk, content-addressed.

```
content
-------
id integer PK
hash text unique
path text              -- relative path of the object file (see sharding below)
size integer
count integer          -- refcount for GC

file
----
id integer PK
parent_id integer NULL FK >0- file.id
name text
content_id integer NULL FK >0- content.id   -- NULL for dirs
size integer
birth_time integer
modify_time integer
mimetype_id integer FK >0- mimetype.id
```

- `saveFile`: hash content -> hit? `count++` : write object + insert row. Then
  file row.
- `deleteFile`: `count--`; reach 0 -> `unlink(object)` + delete row.
- read = one indexed SQL lookup + one file open (no parts parsing, no N-row
  reassembly, no whole-blob materialization).

### Alternative rejected: blob in sqlite

```
content (id, hash, content blob, count)
```

Same dedup semantics, but for multi-GB datasets it pays pager overhead on huge
blobs, WAL growth on write, no zero-copy/offset reads, and VACUUM pain.
Objects-on-fs additionally unlocks transparent btrfs compression (below) and
direct `pread` serving in the FUSE `read` handler. Blob-in-sqlite remains
viable only if the whole store must be a single file.

Objects-on-fs wins on btrfs because:

- `compress=zstd:3` compresses text object files transparently; images pass
  through untouched. No application-level zlib needed (it would double-compress
  text for no space win, and no-op on images anyway).
- FUSE `read` can serve offset ranges directly from the object file (`pread`) —
  a 4 KB read of a 400 MB model file never materializes the whole blob.
- sqlite stays small (tree index only): fast `getByPath`, cheap index backup.
- btrfs reflink/CoW means identical object files cost one extent until they
  diverge.

The cost vs blob-in-sqlite is consistency across two stores. Convention:

1. Decide the path by policy, insert the row, then write the object file
   atomically (write to `objects/tmp/<random>`, then `rename()` into place —
   atomic on the same filesystem).
2. A row without its object file is recoverable: the orphan sweep finds rows
   whose file is missing (`SELECT` rows, `stat` mismatch) and rewrites the
   object from its source or deletes the row per refcount.
3. `deleteFile`: `count--`; reach 0 -> `unlink(object)` + delete row.
4. Orphan files (file on disk without a row, e.g. crash after rename but
   before the row was visible) are swept by comparing `objects/` against the
   `content` table — a hash-named file is always safe to re-adopt or delete,
   since its name is its content hash.

### Sharding: dynamic depth with path stored in the DB

A flat `objects/` dir degrades with millions of files (directory index bloat,
slow tools). Fixed fan-out (git-style `objects/ab/cdef...`) is simple but
sparse at small scale and re-sharding changes paths. Since sqlite is the index
anyway, store the relative path in `content.path` at insert time:

- **Reads**: `SELECT path FROM content WHERE hash=?` -> one `open()`. No
  bucket probing, no depth re-derivation — the row is the single source of
  truth for object location. Path resolution is one indexed SQL lookup, never
  a filesystem scan.
- **Deepening policy** (adaptive layers): start flat `objects/<hash>`; when a
  bucket exceeds a threshold (e.g. ~1,000 files), re-shard that prefix one
  level deeper (`objects/ab/<hash>`), and so on. Re-shard = `rename()` + one
  row UPDATE per object. If interrupted, rows still point at the old path —
  re-run the re-shard job (it skips objects already at the new depth).
- **Layout is an optimization, not an invariant** — mixing depth per object is
  even possible (e.g. small objects flat, huge ones sharded), invisible to
  readers.
- **Relocation**: moving the object store to another volume = one UPDATE pass
  rewriting path prefixes.

This mirrors what git cannot do (git derives path from hash because its object
DB has no external index); with sqlite as the index, exploit it.

Scale reference: 2-char fan-out covers 20k–1M objects at ~78–390 files/dir
(git has used this layout for decades); dynamic deepening kicks in ~10M+.

## Backend is pluggable: two engines behind one port

The FUSE layer (`fs-backup.ts`, 31 ops) already talks to the store only through
11 functions — a natural port boundary:

```
getByPath, readDir, getFileContent, saveDir, saveFile, saveMimetype,
updateFile, renamePath, truncateFile, deleteFile, deleteDir
```

Two adapters are conceivable:

| concern | sqlite backend (this design) | git backend |
| ------- | ---------------------------- | ----------- |
| storage | content table (row) + object files on fs | git object DB (blobs/trees/commits) |
| `saveFile` | hash lookup + INSERT | `git hash-object` + `update-index` |
| `getFileContent` | open object file by stored path | `git cat-file` / worktree read |
| `renamePath` | UPDATE row | `git mv` + commit |
| `deleteFile` | count-- , GC at 0 | commit deletion (space reclaimed at gc) |
| history | none (immutable pool) | free (git's core model) |
| GC | refcount, O(1) at delete | async `git gc`, reachability walk |
| write throughput | best for high-churn writes | index lock + staging cost on 20k files |

Rule of thumb — pick the engine by workload, this is the top-level decision:

- **immutable datasets (images, video, model weights)** -> sqlite backend,
  level-1 dedup, objects-on-fs. Simple, O(1) delete, no history needed,
  offset reads via pread.
- **versioned text-heavy corpora with many similar files** (edited over time,
  checkpoints, archives) -> **mount a git repo as the backend**. Versioning and
  delta compression are git's core model — don't reimplement them. dedup-fs's
  FUSE layer can serve a git-backed store with the same handlers, since only
  the 11-function port changes.
- **text-only datasets without many similar files** -> this design with no
  store-level compression at all; **btrfs `compress=zstd:3` already suffices**
  (the FS compresses each object file transparently, see below).

## Note: transparent filesystem compression

The dev/production filesystem is btrfs with `compress=zstd:3` (verified on the
datasets mount). Compressible object files (text) are compressed by the FS
transparently; compressed images pass through ~unchanged.

Implications:

- Do NOT add application-level compression (e.g. zlib on the blob/object) by
  default — it would double-compress text (CPU cost, no space win on btrfs)
  and no-op on images anyway.
- The measured "saved" figures above are *logical* (pre-compression). Effective
  on-disk usage on btrfs is lower for text, so the marginal value of any
  compression layer in the store is further reduced.
- If a future target filesystem lacks transparent compression (e.g. ext4),
  application-level zlib on the object file becomes worth revisiting — the
  decision belongs to the deployment environment, not the schema.

## Open FUSE-layer items (before wiring a backend)

- fd allocation uses `fd_map.size + 1` -> reuse collision after release; use a
  monotonic counter
- `write` ignores `position` (always appends)
- `rename` of a directory leaves descendant paths keyed under the old prefix