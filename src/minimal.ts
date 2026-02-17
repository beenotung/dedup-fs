import * as fs from 'fs'
import { basename, dirname } from 'path'
let Fuse = require('fuse-native')

let block_size = 4096
let max_name_length = 536870888

function stat(args: { mode: 'dir' | 'file'; size: number }): fs.Stats {
  let stat =
    args.mode === 'file' ? fs.statSync('/tmp/empty-file') : fs.statSync('/')
  let accessTime = Date.now()
  let modifyTime = Date.now()
  let changeTime = Date.now()
  let birthTime = Date.now()
  // let size = args.size
  // let data: fs.Stats = {
  //   atimeMs: accessTime,
  //   mtimeMs: modifyTime,
  //   ctimeMs: changeTime,
  //   birthtimeMs: birthTime,
  //   dev: 0,
  //   ino: 0,
  //   mode: 0,
  //   nlink: 0,
  //   uid: 0,
  //   gid: 0,
  //   rdev: 0,
  //   size: size,
  //   blksize: 0,
  //   blocks: 0,
  //   atime: new Date(accessTime),
  //   mtime: new Date(modifyTime),
  //   ctime: new Date(changeTime),
  //   birthtime: new Date(birthTime),
  //   isFile: () => args.mode === 'file',
  //   isDirectory: () => args.mode === 'dir',
  //   isBlockDevice: () => false,
  //   isCharacterDevice: () => false,
  //   isSymbolicLink: () => false,
  //   isFIFO: () => false,
  //   isSocket: () => false,
  // }
  // Object.assign(stat, data)
  stat.size = args.size
  stat.blksize = block_size
  stat.blocks = Math.ceil(args.size / block_size)
  stat.atimeMs = accessTime
  stat.mtimeMs = modifyTime
  stat.ctimeMs = changeTime
  stat.birthtimeMs = birthTime
  stat.atime = new Date(accessTime)
  stat.mtime = new Date(modifyTime)
  stat.ctime = new Date(changeTime)
  stat.birthtime = new Date(birthTime)
  return stat
}

async function main() {
  if (!fs.existsSync('/tmp/empty-file')) {
    fs.writeFileSync('/tmp/empty-file', '')
  }

  let filesystem_id = Math.floor(Math.random() * 1e6 + 1000)
  let mountpoint = './mnt'
  let total_disk_size = 1 * 1024 * 1024 * 1024 // 1GB
  let all_dirs = ['/']
  let all_files = [
    {
      dir: '/',
      name: 'test',
      content: Buffer.from('hello world'),
      modify_time: Date.now(),
      birth_time: Date.now(),
    },
  ]
  function mkdir(dir: string) {
    if (all_dirs.includes(dir)) return
    all_dirs.push(dir)
  }
  function findFile(path: string) {
    let dir = dirname(path)
    let filename = basename(path)
    return all_files.find(f => f.dir === dir && f.name === filename)
  }
  let opt = {
    readdir: function (path: string, cb: (err: any, names: string[]) => void) {
      console.log('readdir', { path })
      if (!all_dirs.includes(path)) {
        return cb(Fuse.ENOENT, [])
      }
      let files = all_files
        .filter(file => file.dir === path)
        .map(file => file.name)
      return cb(null, files)
    },
    getattr: function (path: string, cb: (err: any, stat: any) => void) {
      console.log('getattr', { path })
      if (all_dirs.includes(path)) {
        console.log('getattr dir', { path })
        let size = 0
        for (const file of all_files) {
          if (file.dir === path) {
            size += file.content.byteLength
          }
        }
        return cb(null, stat({ mode: 'dir', size }))
      }
      let file = findFile(path)
      if (file) {
        console.log('getattr file', { path })
        return cb(null, stat({ mode: 'file', size: file.content.byteLength }))
      }
      console.log('getattr not found', { path })
      return cb(Fuse.ENOENT, null)
    },
    read: function (
      path: string,
      fd: number,
      buf: Buffer,
      len: number,
      pos: number,
      cb: (bytesRead: number) => void,
    ) {
      let file = findFile(path)
      if (file) {
        let bytesRead = file.content.copy(buf, 0, pos, pos + len)
        return cb(bytesRead)
      }
      return cb(0)
    },
    create: function (
      path: string,
      mode: number,
      cb: (err: number, fd?: number) => void,
    ) {
      console.log('create', { path, mode })
      let dir = dirname(path)
      let filename = basename(path)
      if (!all_dirs.includes(dir)) return cb(Fuse.ENOENT, 0)
      let file = all_files.find(f => f.dir === dir && f.name === filename)
      if (file) {
        return cb(Fuse.EEXIST, 0)
      }
      let now = Date.now()
      file = {
        dir,
        name: filename,
        content: Buffer.alloc(0),
        modify_time: now,
        birth_time: now,
      }
      all_files.push(file)
      cb(0, 0)
    },
    flush: function (path: string, fd: number, cb: (err: number) => void) {
      console.log('flush', { path, fd })
      return cb(0)
    },
    write: function (
      path: string,
      fd: number,
      buf: Buffer,
      len: number,
      offset: number,
      cb: (err_or_bytesWritten: number) => void,
    ) {
      let file = findFile(path)
      if (!file) return cb(Fuse.ENOENT)
      let newSize = Math.max(file.content.byteLength, offset + len)
      let newContent = Buffer.alloc(newSize)
      file.content.copy(newContent, 0)
      let bytesWritten = buf.copy(newContent, offset, 0, len)
      file.content = newContent
      file.modify_time = Date.now()
      console.log('write', { path, fd, buf, len, offset, bytesWritten })
      return cb(bytesWritten)
    },
    getxattr: function (
      path: string,
      name: string,
      position: number,
      cb: (err: number, value?: Buffer) => void,
    ) {
      console.log('getxattr', { path, name, position })
      return cb(0, Buffer.alloc(0))
    },
    // e.g. used by `ls -l ./mnt`
    listxattr: function (
      path: string,
      cb: (err: number, list?: string[]) => void,
    ) {
      console.log('listxattr', { path })
      return cb(0, [])
    },
    // e.g. used by `df -h ./mnt`
    statfs: function (
      path: string,
      cb: (err: number, statfs?: Record<string, number>) => void,
    ) {
      console.log('statfs', { path })
      let total_used_size = 0
      for (let file of all_files) {
        total_used_size += file.content.byteLength
      }
      console.log('statfs', { total_disk_size, total_used_size, block_size })
      console.log('statfs', {
        bsize: block_size,
        frsize: 0,
        blocks: Math.ceil(total_disk_size / block_size),
        bfree: Math.floor((total_disk_size - total_used_size) / block_size),
        bavail: Math.floor((total_disk_size - total_used_size) / block_size),
        files: all_files.length,
        ffree: Number.MAX_SAFE_INTEGER - all_files.length,
        favail: Number.MAX_SAFE_INTEGER - all_files.length,
        fsid: filesystem_id,
        flag: 0,
        namemax: max_name_length,
      })
      return cb(0, {
        bsize: block_size,
        frsize: 0,
        blocks: Math.ceil(total_disk_size / block_size),
        bfree: Math.floor((total_disk_size - total_used_size) / block_size),
        bavail: Math.floor((total_disk_size - total_used_size) / block_size),
        files: all_files.length,
        ffree: Number.MAX_SAFE_INTEGER - all_files.length,
        favail: Number.MAX_SAFE_INTEGER - all_files.length,
        fsid: filesystem_id,
        flag: 0,
        namemax: max_name_length,
      })
    },
    truncate: function (path: string, size: number, cb: (err: number) => void) {
      console.log('truncate', { path, size })
      if (all_dirs.includes(path)) {
        return cb(Fuse.EISDIR)
      }
      let file = findFile(path)
      if (!file) {
        return cb(Fuse.ENOENT)
      }
      if (size === 0) {
        file.content = Buffer.alloc(0)
      } else if (size < file.content.byteLength) {
        file.content = file.content.subarray(0, size)
      } else if (size > file.content.byteLength) {
        let buf = Buffer.alloc(size)
        file.content.copy(buf, 0)
        file.content = buf
      }
      file.modify_time = Date.now()
      return cb(0)
    },
    mkdir: function (path: string, mode: number, cb: (err: number) => void) {
      console.log('mkdir', { path, mode })
      if (all_dirs.includes(path)) {
        return cb(Fuse.EEXIST)
      }
      all_dirs.push(path)
      return cb(0)
    },
  }
  let opts = {
    debug: true,
    displayFolder: 'Minimal FS',
    force: false,
    mkdir: false,
  }
  let fuse = new Fuse(mountpoint, opt, opts)
  fuse.mount(function (err: any) {
    if (err) {
      console.error('failed to mount:', err)
      return
    }
    console.log('mounted')
  })
  function unmount() {
    fuse.unmount()
  }
  process.on('SIGINT', () => {
    console.log('SIGINT (ctrl+c) signal received')
    unmount()
    process.exit(0)
  })
  process.on('SIGUSR1', () => {
    console.log('SIGUSR1 signal received')
    unmount()
    process.exit(0)
  })
  process.on('SIGUSR2', () => {
    console.log('SIGUSR2 signal received')
    unmount()
    process.exit(0)
  })
}
main().catch(error => {
  console.error(error)
  process.exit(1)
})
