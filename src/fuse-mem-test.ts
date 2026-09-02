import {
  mkdir,
  readdir,
  readFile,
  rename,
  statfs,
  truncate,
  writeFile,
} from 'fs/promises'
import { basename, dirname } from 'path'
import { createFuse, ErrorCodes, Stats } from './fuse'

async function main() {
  // pretend capacity of the in-memory fs; writes beyond it fail with ENOSPC
  let bsize = 4096
  let max_capacity = 4 * 1024 * 1024 * 1024 // 4 GiB
  let total_inodes = 1024 * 1024
  type BaseEntry = {
    atime: Date
    mtime: Date
    ctime: Date
    birthtime: Date
  }
  type DirEntry = BaseEntry & {
    type: 'dir'
  }
  type FileEntry = BaseEntry & {
    type: 'file'
    content: Buffer
  }
  type Entry = DirEntry | FileEntry
  let file_map = new Map<string, Entry>()
  {
    let now = new Date()
    file_map.set('/', {
      type: 'dir',
      atime: now,
      mtime: now,
      ctime: now,
      birthtime: now,
    })
  }
  let fd_map = new Map<number, Entry>()
  function toStats(entry: Entry): Stats {
    let isDir = entry.type === 'dir'
    let isFile = entry.type === 'file'
    return {
      isFile: () => isFile,
      isDirectory: () => isDir,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      dev: 0,
      ino: 1,
      mode: isDir ? 0o755 | 0o40000 : 0o644 | 0o100000,
      nlink: 1,
      uid: 1000,
      gid: 1000,
      rdev: 0,
      size: entry.type === 'file' ? entry.content.length : 4096,
      blksize: 4096,
      blocks: 1,
      atimeMs: entry.atime.getTime(),
      mtimeMs: entry.mtime.getTime(),
      ctimeMs: entry.ctime.getTime(),
      birthtimeMs: entry.birthtime.getTime(),
      atime: entry.atime,
      mtime: entry.mtime,
      ctime: entry.ctime,
      birthtime: entry.birthtime,
    }
  }
  function has_children(path: string): boolean {
    for (let [p, entry] of file_map) {
      if (dirname(p) === path) {
        return true
      }
    }
    return false
  }
  function truncate_entry(entry: FileEntry, length: number) {
    if (entry.content.length === length) {
      return
    }
    if (entry.content.length > length) {
      entry.content = entry.content.subarray(0, length)
      return
    }
    entry.content = Buffer.concat([
      entry.content,
      Buffer.alloc(length - entry.content.length),
    ])
  }
  function used_bytes(): number {
    let total = 0
    for (let entry of file_map.values()) {
      if (entry.type === 'file') {
        total += entry.content.length
      }
    }
    return total
  }
  let mountpoint =
    '/tmp/fuse-test/' + Math.random().toString(36).substring(2, 8)
  console.log('mountpoint:', mountpoint)
  await mkdir(mountpoint, { recursive: true })
  const fuse = createFuse({
    mountpoint,
    operations: {
      mkdir: (path, mode, cb) => {
        console.log('mkdir:', { path, mode })
        let entry = file_map.get(path)
        if (entry) {
          return cb(ErrorCodes.EEXIST)
        }
        if (file_map.size >= total_inodes) {
          return cb(ErrorCodes.ENOSPC)
        }
        let now = new Date()
        file_map.set(path, {
          type: 'dir',
          atime: now,
          mtime: now,
          ctime: now,
          birthtime: now,
        })
        cb(0)
      },
      rmdir: (path, cb) => {
        console.log('rmdir:', { path })
        let entry = file_map.get(path)
        if (!entry) {
          return cb(ErrorCodes.ENOENT)
        }
        if (entry.type !== 'dir') {
          return cb(ErrorCodes.ENOTDIR)
        }
        // the kernel does not pre-check emptiness; rmdir must return ENOTEMPTY itself
        if (has_children(path)) {
          return cb(ErrorCodes.ENOTEMPTY)
        }
        file_map.delete(path)
        cb(0)
      },
      create: (path, flags, cb) => {
        console.log('create:', { path, flags })
        let entry = file_map.get(path)
        if (entry) {
          return cb(ErrorCodes.EEXIST)
        }
        if (file_map.size >= total_inodes) {
          return cb(ErrorCodes.ENOSPC)
        }
        let fd = fd_map.size + 1
        let now = new Date()
        let file_entry: Entry = {
          type: 'file',
          atime: now,
          mtime: now,
          ctime: now,
          birthtime: now,
          content: Buffer.alloc(0),
        }
        file_map.set(path, file_entry)
        fd_map.set(fd, file_entry)
        cb(0, fd)
      },
      readdir: (path, cb) => {
        console.log('readdir:', { path })
        let entry = file_map.get(path)
        if (!entry) {
          // the kernel may call readdir on any path without prior getattr; the fs must validate
          return cb(ErrorCodes.ENOENT, null as any)
        }
        if (entry.type !== 'dir') {
          return cb(ErrorCodes.ENOTDIR, null as any)
        }
        let children = []
        for (let p of file_map.keys()) {
          if (p === path) continue
          if (dirname(p) === path) {
            children.push(basename(p))
          }
        }
        cb(null, children)
      },
      fstat: (path, fd, cb) => {
        console.log('fstat:', { path, fd })
        let entry = fd_map.get(fd)
        if (!entry) {
          return cb(ErrorCodes.ENOENT, null as any)
        }
        cb(null, toStats(entry))
      },
      lstat: (path, cb) => {
        console.log('lstat:', { path })
        let entry = file_map.get(path)
        if (!entry) {
          return cb(ErrorCodes.ENOENT, null as any)
        }
        cb(null, toStats(entry))
      },
      getattr: (path, cb) => {
        console.log('getattr:', { path })
        let entry = file_map.get(path)
        if (!entry) {
          return cb(ErrorCodes.ENOENT, null as any)
        }
        cb(null, toStats(entry))
      },
      open: (path, flags, cb) => {
        console.log('open:', { path, flags })
        let entry = file_map.get(path)
        if (!entry) {
          return cb(ErrorCodes.ENOENT)
        }
        let fd = fd_map.size + 1
        fd_map.set(fd, entry)
        cb(0, fd)
      },
      release: (path, fd, cb) => {
        console.log('release:', { path, fd })
        cb(0)
      },
      flush: (path, fd, cb) => {
        console.log('flush:', { path, fd })
        cb(0)
      },
      read: (path, fd, buffer, length, position, cb) => {
        console.log('read:', { path, fd, buffer, length, position })
        let entry = fd_map.get(fd)
        if (!entry) {
          return cb(ErrorCodes.ENOENT)
        }
        if (entry.type !== 'file') {
          return cb(ErrorCodes.ENOTDIR)
        }
        let data = entry.content.subarray(position, position + length)
        data.copy(buffer)
        cb(data.length, buffer.buffer)
      },
      write: (path, fd, buffer, length, position, cb) => {
        console.log('write:', { path, fd, buffer, length, position })
        let entry = file_map.get(path)
        if (!entry) {
          return cb(ErrorCodes.ENOENT)
        }
        if (entry.type !== 'file') {
          return cb(ErrorCodes.ENOTDIR)
        }
        let new_bytes =
          used_bytes() - entry.content.length + position + buffer.length
        if (new_bytes > max_capacity) {
          return cb(ErrorCodes.ENOSPC)
        }
        entry.content = Buffer.concat([entry.content, buffer])
        cb(buffer.length, buffer.buffer)
      },
      fsync: (path, datasync, fd, cb) => {
        console.log('fsync:', { path, datasync, fd })
        cb(0)
      },
      fsyncdir: (path, datasync, fd, cb) => {
        console.log('fsyncdir:', { path, datasync, fd })
        cb(0)
      },
      ftruncate: (path, fd, length, cb) => {
        console.log('ftruncate:', { path, fd, length })
        let entry = fd_map.get(fd)
        if (!entry) {
          return cb(ErrorCodes.ENOENT)
        }
        if (entry.type !== 'file') {
          return cb(ErrorCodes.EISDIR)
        }
        truncate_entry(entry, length)
        cb(0)
      },
      truncate: (path, length, cb) => {
        console.log('truncate:', { path, length })
        let entry = file_map.get(path)
        if (!entry) {
          return cb(ErrorCodes.ENOENT)
        }
        if (entry.type !== 'file') {
          return cb(ErrorCodes.EISDIR)
        }
        truncate_entry(entry, length)
        cb(0)
      },
      rename: (src, dest, cb) => {
        console.log('rename:', { src, dest })
        let src_entry = file_map.get(src)
        if (!src_entry) {
          return cb(ErrorCodes.ENOENT)
        }
        let dest_entry = file_map.get(dest)
        if (dest_entry) {
          if (src_entry.type === 'file' && dest_entry.type === 'dir') {
            return cb(ErrorCodes.EISDIR)
          }
          if (src_entry.type === 'dir' && dest_entry.type === 'file') {
            return cb(ErrorCodes.ENOTDIR)
          }
          if (
            src_entry.type === 'dir' &&
            dest_entry.type === 'dir' &&
            has_children(dest)
          ) {
            return cb(ErrorCodes.ENOTEMPTY)
          }
          file_map.delete(dest)
        }
        // prevent renaming a dir into its own descendant (e.g. /a -> /a/b/c)
        if (src_entry.type === 'dir' && dest.startsWith(src + '/')) {
          return cb(ErrorCodes.EINVAL)
        }
        let entries: Array<[string, Entry]> = []
        if (src_entry.type === 'dir') {
          for (let [p, entry] of file_map) {
            if (p.startsWith(src + '/')) {
              entries.push([p, entry])
            }
          }
        }
        file_map.delete(src)
        file_map.set(dest, src_entry)
        for (let [p, entry] of entries) {
          file_map.delete(p)
          file_map.set(dest + p.slice(src.length), entry)
        }
        cb(0)
      },
      statfs: (path, cb) => {
        console.log('statfs:', { path })
        // reflect the in-memory usage; when store-backed, report real free space
        let total_blocks = Math.floor(max_capacity / bsize)
        let used_blocks = Math.ceil(used_bytes() / bsize)
        cb(0, {
          bsize,
          frsize: bsize,
          blocks: total_blocks,
          bfree: total_blocks - used_blocks, // free data blocks (bytes capacity)
          bavail: total_blocks - used_blocks,
          files: total_inodes,
          ffree: total_inodes - file_map.size, // free file slots (inode capacity)
          favail: total_inodes - file_map.size,
          fsid: 1,
          flag: 0,
          namemax: 255,
        })
      },
      unlink: (path, cb) => {
        console.log('unlink:', { path })
        let entry = file_map.get(path)
        if (!entry) {
          return cb(ErrorCodes.ENOENT)
        }
        if (entry.type === 'dir') {
          return cb(ErrorCodes.EISDIR)
        }
        file_map.delete(path)
        cb(0)
      },
    },
  })
  console.log('mounting...')
  await fuse.mount()
  console.log('mounted')

  try {
    let file_1 = fuse.mountpoint + '/file_1.txt'
    let file_2 = fuse.mountpoint + '/file_2.txt'

    console.log('1. read root directory...')
    // cannot use sync version fs APIs, otherwise it will get into deadlock
    let files = await readdir(fuse.mountpoint)
    console.log('files:', files)

    console.log('2. create a file...')
    await writeFile(file_1, 'hello, world\n', 'utf-8')

    console.log('3. list the file...')
    files = await readdir(fuse.mountpoint)
    console.log('files:', files)

    console.log('4. read the file...')
    let content = await readFile(file_1, 'utf-8')
    console.log('content:', JSON.stringify(content))

    console.log('5. rename the file...')
    await rename(file_1, file_2)
    console.log('file renamed')

    console.log('6. list the file...')
    files = await readdir(fuse.mountpoint)
    console.log('files:', files)

    console.log('7. truncate the file...')
    await truncate(file_2, 5)
    let truncated = await readFile(file_2, 'utf-8')
    console.log('truncated content:', JSON.stringify(truncated))

    console.log('8. statfs...')
    let statfs_result = await statfs(fuse.mountpoint)
    console.log(
      'statfs:',
      statfs_result.bsize,
      statfs_result.blocks,
      statfs_result.bfree,
    )

    console.log('9. rename dir with children...')
    let dir_1 = fuse.mountpoint + '/dir_1'
    let dir_2 = fuse.mountpoint + '/dir_2'
    await mkdir(dir_1 + '/nested', { recursive: true })
    await writeFile(dir_1 + '/nested/child.txt', 'child content', 'utf-8')
    await rename(dir_1, dir_2)
    let child_content = await readFile(dir_2 + '/nested/child.txt', 'utf-8')
    console.log('child content:', JSON.stringify(child_content))
    let dir_files = await readdir(dir_2 + '/nested')
    console.log('dir_files:', dir_files)
    let root_files = await readdir(fuse.mountpoint)
    console.log('root_files:', root_files)
    try {
      await readFile(dir_1 + '/nested/child.txt', 'utf-8')
      console.log('ERROR: old path still readable')
    } catch (e: any) {
      console.log('old path correctly gone:', e.code)
    }

    console.log('10. rename dir into own descendant (EINVAL)...')
    try {
      await rename(dir_2, dir_2 + '/nested/inside')
      console.log('ERROR: self-descendant rename should fail')
    } catch (e: any) {
      console.log('self-descendant rename correctly rejected:', e.code)
    }
    // verify dir_2 still intact after the rejected rename
    let intact = await readdir(dir_2 + '/nested')
    console.log('dir_files after rejected rename:', intact)
  } finally {
    console.log('unmounting...')
    await fuse.unmount()
    console.log('unmounted')
  }
}
main().catch(error => {
  console.error(error)
  process.exit(1)
})

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
