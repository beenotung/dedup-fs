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
  type BaseEntry = {
    atime: Date
    mtime: Date
    ctime: Date
    birthtime: Date
  }
  type DirEntry = BaseEntry & {
    type: 'dir'
    children: string[]
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
      children: [],
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
  function get_parent(path: string, cb: (err: any, parent: DirEntry) => void) {
    let parent_path = dirname(path)
    let parent = file_map.get(parent_path)
    if (!parent) {
      return cb(ErrorCodes.ENOENT, null as any)
    }
    if (parent.type !== 'dir') {
      return cb(ErrorCodes.ENOTDIR, null as any)
    }
    cb(null, parent)
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
        let now = new Date()
        file_map.set(path, {
          type: 'dir',
          atime: now,
          mtime: now,
          ctime: now,
          birthtime: now,
          children: [],
        })
        get_parent(path, (err, parent) => {
          if (err) {
            return cb(err)
          }
          parent.children.push(basename(path))
          cb(0)
        })
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
        if (entry.children.length > 0) {
          return cb(ErrorCodes.ENOTEMPTY)
        }
        get_parent(path, (err, parent) => {
          if (err) {
            return cb(err)
          }
          let name = basename(path)
          remove_in_array(parent.children, name)
          file_map.delete(path)
          cb(0)
        })
      },
      create: (path, flags, cb) => {
        console.log('create:', { path, flags })
        let entry = file_map.get(path)
        if (entry) {
          return cb(ErrorCodes.EEXIST)
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
        get_parent(path, (err, parent) => {
          if (err) {
            return cb(err)
          }
          parent.children.push(basename(path))
          file_map.set(path, file_entry)
          fd_map.set(fd, file_entry)
          cb(0, fd)
        })
      },
      readdir: (path, cb) => {
        console.log('readdir:', { path })
        let entry = file_map.get(path)
        if (!entry) {
          return cb(ErrorCodes.ENOENT, null as any)
        }
        if (entry.type !== 'dir') {
          return cb(ErrorCodes.ENOTDIR, null as any)
        }
        cb(null, entry.children)
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
        get_parent(src, (err, src_parent) => {
          if (err) {
            return cb(err)
          }
          get_parent(dest, (err, dest_parent) => {
            if (err) {
              return cb(err)
            }
            let src_entry = file_map.get(src)
            if (!src_entry) {
              return cb(ErrorCodes.ENOENT)
            }
            let src_name = basename(src)
            let dest_name = basename(dest)
            let dest_entry = file_map.get(dest)
            if (!dest_entry) {
              // move from src_parent to dest_parent
              remove_in_array(src_parent.children, src_name)
              dest_parent.children.push(dest_name)
              file_map.delete(src)
              file_map.set(dest, src_entry)
              return cb(0)
            }
            if (dest_entry.type === 'dir') {
              // move src_parent into dest directory
              if (!dest_entry.children.includes(src_name)) {
                dest_entry.children.push(src_name)
              }
              remove_in_array(src_parent.children, src_name)
              file_map.delete(src)
              file_map.set(dest + '/' + src_name, src_entry)
              return cb(0)
            }
            // overwrite dest_entry with src_entry, and remove src_entry
            remove_in_array(src_parent.children, src_name)
            file_map.delete(src)
            file_map.set(dest, src_entry)
            cb(0)
          })
        })
      },
      statfs: (path, cb) => {
        console.log('statfs:', { path })
        cb(0, {
          bsize: 4096,
          frsize: 4096,
          blocks: 1000000,
          bfree: 990000,
          bavail: 990000,
          files: 1000000,
          ffree: 999000,
          favail: 999000,
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
        if (entry.type !== 'file') {
          return cb(ErrorCodes.EISDIR)
        }
        get_parent(path, (err, parent) => {
          if (err) {
            return cb(err)
          }
          let name = basename(path)
          parent.children = parent.children.filter(c => c !== name)
          file_map.delete(path)
          cb(0)
        })
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

function remove_in_array(list: string[], name: string) {
  let index = list.indexOf(name)
  if (index !== -1) {
    list.splice(index, 1)
  }
}
