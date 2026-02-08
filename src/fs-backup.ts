import * as fs from 'fs'
import { dirname, basename } from 'path'
import {
  block_size,
  getByPath,
  getByPath,
  getFileContent,
  readDir,
  saveDir,
  saveFile,
  saveMimetype,
  updateFile,
  renamePath,
  truncateFile,
  deleteFile,
  deleteDir,
} from './store'
import { File, proxy } from './proxy'
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
  let dir = getByPath(path)
  if (!dir) return cb(Fuse.ENOENT, null)
  return cb(null, readDir(dir))
}

export function getattr(
  path: string,
  cb: (err: any, stat: null | fs.Stats) => void,
): void {
  let file = getByPath(path)
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

  let dir = getByPath(path)
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
let dir_fd_counter = 0
let dir_fd_set: Set<number> = new Set()

export function open(
  path: string,
  flags: number,
  cb: (err: any, fd: number) => void,
): void {
  let file = getByPath(path)
  if (!file) return cb(Fuse.ENOENT, 0)
  let fd = fd_counter++
  fd_array[fd] = { file, pos: 0, flags }
  return cb(null, fd)
}

export function release(
  path: string,
  fd: number,
  cb: (err: any) => void,
): void {
  delete fd_array[fd]
  return cb(0)
}

export function read(
  path: string,
  fd: number,
  buf: Buffer,
  len: number,
  pos: number,
  cb: (err: any, bytesRead: number) => void,
): void {
  let ent = fd_array[fd]
  if (!ent) return cb(Fuse.EBADF, 0)
  let content = getFileContent(ent.file)
  let bytes_to_read = Math.min(len, Math.max(0, content.byteLength - pos))
  if (bytes_to_read > 0) content.copy(buf, 0, pos, pos + bytes_to_read)
  return cb(null, bytes_to_read)
}

function create(
  path: string,
  mode: number,
  cb: (err: any, fd: number) => void,
): void {
  let dir = getByPath(dirname(path))
  if (!dir) return cb(Fuse.ENOENT, 0)
  let name = basename(path)
  let existing = getByPath(path)
  if (existing) {
    let fd = fd_counter++
    fd_array[fd] = { file: existing, pos: 0, flags: 0 }
    return cb(null, fd)
  }
  let file_id = saveFile({
    dir_id: dir.id!,
    name,
    content: Buffer.alloc(0),
    mimetype_id: saveMimetype('application/octet-stream'),
  })
  let fd = fd_counter++
  fd_array[fd] = { file: proxy.file[file_id], pos: 0, flags: 0 }
  return cb(null, fd)
}

function write(
  path: string,
  fd: number,
  buf: Buffer,
  len: number,
  pos: number,
  cb: (errOrBytes: any, bytesWritten?: number) => void,
): void {
  let ent = fd_array[fd]
  if (!ent) return cb(Fuse.EBADF)
  let content = getFileContent(ent.file)
  let newSize = Math.max(content.length, pos + len)
  let newContent = Buffer.alloc(newSize)
  content.copy(newContent, 0)
  buf.copy(newContent, pos, 0, len)
  updateFile({ file: ent.file, content: newContent })
  return cb(len)
}

const S_IFREG = 0o100000
function mknod(
  pathArg: string,
  mode: number,
  dev: number,
  cb: (err: number) => void,
): void {
  if ((mode & 0o170000) !== S_IFREG) return cb(Fuse.ENOSYS)
  let dir = getByPath(dirname(pathArg))
  if (!dir) return cb(Fuse.ENOENT)
  let name = basename(pathArg)
  if (getByPath(pathArg)) return cb(0)
  let mimetype_id = saveMimetype('application/octet-stream')
  saveFile({
    dir_id: dir.id!,
    name,
    content: Buffer.alloc(0),
    mimetype_id,
  })
  return cb(0)
}

export function fgetattr(
  path: string,
  fd: number,
  cb: (err: any, stat: null | fs.Stats) => void,
): void {
  getattr(path, cb)
}

export function access(
  path: string,
  mode: number,
  cb: (err: any) => void,
): void {
  if (getByPath(path) || getByPath(path)) return cb(0)
  return cb(Fuse.ENOENT)
}

export function statfs(
  path: string,
  cb: (err: any, statfs?: any) => void,
): void {
  return cb(null, {
    bsize: 4096,
    frsize: 4096,
    blocks: 0,
    bfree: 0,
    bavail: 0,
    files: 0,
    ffree: 0,
    favail: 0,
    fsid: 0,
    flag: 0,
    namemax: 255,
  })
}

export function flush(path: string, fd: number, cb: (err: any) => void): void {
  return cb(0)
}

export function fsync(
  path: string,
  datasync: number,
  fd: number,
  cb: (err: any) => void,
): void {
  return cb(0)
}

export function fsyncdir(
  path: string,
  datasync: number,
  fd: number,
  cb: (err: any) => void,
): void {
  return cb(0)
}

export function truncate(
  path: string,
  size: number,
  cb: (err: any) => void,
): void {
  let file = getByPath(path)
  if (!file) return cb(Fuse.ENOENT)
  truncateFile(file, size)
  return cb(0)
}

export function ftruncate(
  path: string,
  fd: number,
  size: number,
  cb: (err: any) => void,
): void {
  let ent = fd_array[fd]
  if (!ent) return cb(Fuse.EBADF)
  truncateFile(ent.file, size)
  return cb(0)
}

export function utimens(
  path: string,
  atime: number,
  mtime: number,
  cb: (err: any) => void,
): void {
  let file = getByPath(path)
  if (file) {
    file.modify_time = Math.floor(mtime * 1000)
    return cb(0)
  }
  let dir = getByPath(path)
  if (dir) {
    dir.modify_time = Math.floor(mtime * 1000)
    return cb(0)
  }
  return cb(Fuse.ENOENT)
}

export function opendir(
  path: string,
  flags: number,
  cb: (err: any, fd: number) => void,
): void {
  let dir = getByPath(path)
  if (!dir) return cb(Fuse.ENOENT, 0)
  let fd = dir_fd_counter++
  dir_fd_set.add(fd)
  return cb(null, fd)
}

export function releasedir(
  path: string,
  fd: number,
  cb: (err: any) => void,
): void {
  dir_fd_set.delete(fd)
  return cb(0)
}

export function unlink(path: string, cb: (err: any) => void): void {
  let file = getByPath(path)
  if (file) {
    deleteFile(file)
    return cb(0)
  }
  return cb(Fuse.ENOENT)
}

export function rename(
  src: string,
  dest: string,
  cb: (err: any) => void,
): void {
  let err = renamePath(src, dest)
  return cb(err === 0 ? 0 : err)
}

export function mkdir(
  path: string,
  mode: number,
  cb: (err: any) => void,
): void {
  if (path === '/') return cb(0)
  let dir = getByPath(path)
  if (dir) return cb(Fuse.EEXIST)
  saveDir(path)
  return cb(0)
}

export function rmdir(path: string, cb: (err: any) => void): void {
  let dir = getByPath(path)
  if (!dir) return cb(Fuse.ENOENT)
  if (path === '/') return cb(Fuse.EBUSY)
  if (!deleteDir(dir)) return cb(Fuse.ENOTEMPTY)
  return cb(0)
}

export function readlink(
  path: string,
  cb: (err: any, linkname?: string) => void,
): void {
  return cb(Fuse.ENOSYS)
}

export function chown(
  path: string,
  uid: number,
  gid: number,
  cb: (err: any) => void,
): void {
  return cb(0)
}

export function chmod(
  path: string,
  mode: number,
  cb: (err: any) => void,
): void {
  return cb(0)
}

export function setxattr(
  path: string,
  name: string,
  value: Buffer,
  position: number,
  flags: number,
  cb: (err: any) => void,
): void {
  return cb(Fuse.ENOSYS)
}

export function getxattr(
  path: string,
  name: string,
  position: number,
  cb: (err: any, value?: Buffer) => void,
): void {
  return cb(Fuse.ENOSYS)
}

export function listxattr(
  path: string,
  cb: (err: any, list?: string[]) => void,
): void {
  return cb(Fuse.ENOSYS)
}

export function removexattr(
  path: string,
  name: string,
  cb: (err: any) => void,
): void {
  return cb(Fuse.ENOSYS)
}

export function link(src: string, dest: string, cb: (err: any) => void): void {
  return cb(Fuse.ENOSYS)
}

export function symlink(
  src: string,
  dest: string,
  cb: (err: any) => void,
): void {
  return cb(Fuse.ENOSYS)
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
  let handlers: Record<string, any> = {
    readdir,
    getattr,
    fgetattr,
    access,
    statfs,
    create,
    mknod,
    open,
    release,
    read,
    write,
    flush,
    fsync,
    fsyncdir,
    truncate,
    ftruncate,
    utimens,
    opendir,
    releasedir,
    unlink,
    rename,
    mkdir,
    rmdir,
    readlink,
    chown,
    chmod,
    setxattr,
    getxattr,
    listxattr,
    removexattr,
    link,
    symlink,
  }
  if (options.debug) {
    for (let key in handlers) {
      let fn = handlers[key]
      handlers[key] = function () {
        console.log('call', key, arguments)
        let cb = arguments[arguments.length - 1]
        arguments[arguments.length - 1] = function (err: any, result: any) {
          console.log('callback of ' + key, err, result)
          cb(err == null ? 0 : err, result)
        }
        fn.apply(this, arguments)
      }
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
