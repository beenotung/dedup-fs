import * as fs from 'fs'
import { block_size, getDir, getFile, getFileContent, readDir } from './store'
import { File } from './proxy'
let Fuse = require('fuse-native')

let dev = 1 + Math.floor(Math.random() * 100000)

function stat(args: {
  id: number
  modify_time: number
  birth_time: number
  size: number
  type: 'file' | 'dir'
}): fs.Stats {
  let type = args.type
  let data: fs.Stats = {
    atimeMs: args.modify_time,
    mtimeMs: args.modify_time,
    ctimeMs: args.modify_time,
    birthtimeMs: args.birth_time,
    dev: dev,
    ino: args.id,
    mode:
      type === 'file'
        ? // 0o644
          33188
        : // 0o40755
          16877,
    nlink: 1,
    uid: 1000,
    gid: 1000,
    rdev: 0,
    size: args.size,
    blksize: block_size,
    blocks: Math.ceil(args.size / block_size),
    atime: new Date(args.modify_time),
    mtime: new Date(args.modify_time),
    ctime: new Date(args.modify_time),
    birthtime: new Date(args.birth_time),
    isFile: () => type === 'file',
    isDirectory: () => type === 'dir',
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  }
  return data
  // if (args.type === 'file') {
  //   let stats = fs.statSync(__filename)
  //   return Object.assign(stats, data)
  // }
  // if (args.type === 'dir') {
  //   let stats = fs.statSync(__filename)
  //   return Object.assign(stats, data)
  // }
  // throw new Error(`invalid type: ${args.type}`)
}

export function readdir(
  path: string,
  cb: (err: any, filenames: null | string[]) => void,
): void {
  let dir = getDir(path)
  if (!dir) return cb(Fuse.ENOENT, null)
  return cb(null, readDir(dir))
}

export function getattr(
  path: string,
  cb: (err: any, stat: null | fs.Stats) => void,
): void {
  let file = getFile(path)
  if (file) {
    return cb(
      null,
      stat({
        id: file.id!,
        modify_time: file.modify_time,
        birth_time: file.birth_time,
        size: file.size,
        type: 'file',
      }),
    )
  }

  let dir = getDir(path)
  if (dir) {
    return cb(
      null,
      stat({
        id: dir.id!,
        modify_time: dir.modify_time,
        birth_time: dir.birth_time,
        size: 4096,
        type: 'dir',
      }),
    )
  }

  return cb(Fuse.ENOENT, null)
}

let fd_counter = 0

type FileDescriptor = {
  file: File
  pos: number
  flags: number
}
let fd_array: FileDescriptor[] = []

export function open(
  path: string,
  flags: number,
  cb: (err: any, fd: number) => void,
): void {
  let file = getFile(path)
  if (file) {
    let fd = fd_counter++
    fd_array.push({ file, pos: 0, flags })
    return cb(null, fd)
  }
  return cb(Fuse.ENOENT, 0)
}

export function release(
  path: string,
  fd: number,
  cb: (err: any) => void,
): void {
  delete fd_array[fd]
  return cb(null)
}

export function read(
  path: string,
  fd: number,
  buf: Buffer,
  len: number,
  pos: number,
  cb: (bytesRead: number) => void,
): void {
  let file = fd_array[fd]
  if (!file) return cb(Fuse.EBADF)
  let content = getFileContent(file.file)
  let bytes_to_read = Math.min(len, content.byteLength - file.pos)
  content.copy(buf, pos, file.pos, file.pos + bytes_to_read)
  file.pos += bytes_to_read
  return cb(bytes_to_read)
}

type MountResult = {
  unmount: () => void
}

type MountOptions = {
  debug?: boolean
  displayFolder?: string
  force?: boolean
  mkdir?: boolean
}

export function mount(
  mountpoint: string,
  options: MountOptions = {},
): Promise<MountResult> {
  let handlers = {
    readdir,
    getattr,
    open,
    release,
    read,
  }
  if (options.debug) {
    handlers.readdir = (path, cb) => {
      console.log('readdir', { path })
      readdir(path, cb)
    }
    handlers.getattr = (path, cb) => {
      console.log('getattr', { path })
      getattr(path, (err, result) => {
        console.log('getattr', {
          path,
          err,
          result: result?.isFile()
            ? 'file'
            : result?.isDirectory()
            ? 'dir'
            : 'unknown',
        })
        cb(null, result)
      })
    }
    handlers.open = (path, flags, cb) => {
      console.log('open', { path, flags })
      open(path, flags, cb)
    }
    handlers.release = (path, fd, cb) => {
      console.log('release', { path, fd })
      release(path, fd, cb)
    }
    handlers.read = (path, fd, buf, len, pos, cb) => {
      console.log('read', { path, fd, buf, len, pos })
      read(path, fd, buf, len, pos, cb)
    }
  }
  let opts = {
    debug: options.debug ?? false,
    // debug: false,
    displayFolder: options.displayFolder ?? 'DedupFS Folder',
    force: options.force ?? false,
    mkdir: options.mkdir ?? false,
  }
  let fuse = new Fuse(mountpoint, handlers, opts)
  function unmount() {
    fuse.unmount()
  }
  let result: MountResult = {
    unmount,
  }

  // handle ctrl+c signal
  process.on('SIGINT', () => {
    if (options.debug) {
      console.log('SIGINT (ctrl+c) signal received')
    }
    unmount()
  })

  // handle kill signal (from nodemon)
  process.on('SIGUSR1', () => {
    if (options.debug) {
      console.log('SIGUSR1 signal received')
    }
    unmount()
  })
  process.on('SIGUSR2', () => {
    if (options.debug) {
      console.log('SIGUSR2 signal received')
    }
    unmount()
  })

  // TODO handle restart from ts-node-dev

  return new Promise<MountResult>((resolve, reject) => {
    fuse.mount((err: any) => {
      if (err) reject(err)
      resolve(result)
    })
  })
}
