import { createHash } from 'crypto'
import { readdirSync, readFileSync, statSync, appendFileSync } from 'fs'
import { join } from 'path'

function format_progress(acc: number, total: number) {
  let percentage = ((acc / total) * 100).toFixed(2)
  return `[${acc.toLocaleString()}/${total.toLocaleString()}] (${percentage}%)`
}

type File = {
  path: string
  size: number
  parts: number[]
}
function scan_dir(dir: string) {
  let files: File[] = []
  let dirs = [dir]
  process.stdout.write(
    `\r scanning dir... pending dirs: ${dirs.length} | found files: ${files.length}`,
  )
  for (;;) {
    let dir = dirs.shift()
    if (!dir) break
    let filenames = readdirSync(dir)
    for (let filename of filenames) {
      let path = join(dir, filename)
      let stat = statSync(path)
      if (stat.isFile()) {
        files.push({ path, size: stat.size, parts: [] })
      } else if (stat.isDirectory()) {
        dirs.push(path)
      }
    }
  }
  clear_line()
  return files
}

function clear_line() {
  process.stdout.write('\r' + ' '.repeat(process.stdout.columns - 1) + '\r')
}

function test_block_size(files: File[], block_size: number) {
  let blocks = new Map<string, { chunk: Buffer; count: number; idx: number }>()
  let hashes: string[] = []

  let total_size = 0
  for (let file of files) {
    total_size += file.size
  }

  let storage_size = 0
  let reuse_blocks = 0
  let processed_size = 0

  let last_reported_percent = 0
  for (let file of files) {
    let content = readFileSync(file.path)
    let parts = file.parts
    let acc = 0
    for (let offset = 0; offset < content.length; offset += block_size) {
      let chunk = content.subarray(offset, offset + block_size)
      acc += chunk.length
      let hash = createHash('sha256').update(chunk).digest('base64url')
      let entry = blocks.get(hash)
      let idx: number
      if (!entry) {
        idx = hashes.length
        hashes.push(hash)
        blocks.set(hash, { chunk, count: 1, idx })
        storage_size += chunk.length
      } else {
        entry.count++
        idx = entry.idx
        reuse_blocks++
      }
      parts.push(idx)
      processed_size += chunk.length
      let current_percent = (processed_size / total_size) * 100
      if (
        !last_reported_percent ||
        current_percent - last_reported_percent >= 1
      ) {
        last_reported_percent = current_percent
        let saved_size = total_size - storage_size
        let saved_percentage = (saved_size / total_size) * 100
        let stats = {
          block_size,
          total_size,
          storage_size,
          reuse_blocks,
          saved_size,
          saved_percentage: saved_percentage.toFixed(2) + '%',
        }
        process.stdout.write(
          `\r scanning files ${format_progress(
            processed_size,
            total_size,
          )}... ${Object.entries(stats)
            .map(([key, value]) => `${key}: ${value.toLocaleString()}`)
            .join(' | ')}`,
        )
      }
    }
  }
  clear_line()
  let saved_size = total_size - storage_size
  let saved_percentage = (saved_size / total_size) * 100
  return {
    block_size,
    total_size,
    storage_size,
    reuse_blocks,
    saved_size,
    saved_percentage: saved_percentage.toFixed(2) + '%',
  }
}

function test() {
  let k = 1024
  let m = k * k

  let block_sizes = [
    /* bytes */
    32,
    64,
    128,
    256,
    512,
    /* KB */
    1 * k,
    2 * k,
    4 * k,
    8 * k,
    16 * k,
    32 * k,
    64 * k,
    128 * k,
    256 * k,
    /* MB */
    1 * m,
    4 * m,
    10 * m,
  ]

  // let test_dir = '/mnt/btrfs/home/beenotung/local/opt/cursor/backup'
  let test_dir = '/home/beenotung/workspace/github.com/beenotung/tslib'

  let files = scan_dir(test_dir)

  let log_file = 'log.txt'
  appendFileSync(log_file, `\ntest_dir: ${test_dir}\n`)

  for (let block_size of block_sizes) {
    for (let file of files) {
      file.parts = []
    }
    let result = test_block_size(files, block_size)

    let line = Object.entries(result)
      .map(([key, value]) => `${key}: ${value.toLocaleString()}`)
      .join(' | ')
    console.log(line)
    appendFileSync(log_file, `${line}\n`)
  }
}

test()
