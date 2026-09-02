import { Stats } from 'fs'
export { Stats } from 'fs'

let Fuse = require('fuse-native')

export type FuseOperations = {
  readdir(path: string, cb: (err: any, names: string[]) => void): void
  getattr(path: string, cb: (err: any, stat: Stats) => void): void
  fstat(path: string, fd: number, cb: (err: any, stat: Stats) => void): void
  lstat(path: string, cb: (err: any, stat: Stats) => void): void
  create(path: string, mode: number, cb: (err: any, fd?: number) => void): void
  mkdir(path: string, mode: number, cb: (err: any) => void): void
  rmdir(path: string, cb: (err: any) => void): void
  unlink(path: string, cb: (err: any) => void): void
  open(path: string, flags: number, cb: (err: any, fd?: number) => void): void
  release(path: string, fd: number, cb: (err: any) => void): void
  flush(path: string, fd: number, cb: (err: any) => void): void
  read(
    path: string,
    fd: number,
    buffer: Buffer,
    length: number,
    position: number,
    cb: (bytesRead: number, buffer?: ArrayBufferLike) => void,
  ): void
  write(
    path: string,
    fd: number,
    buffer: Buffer,
    length: number,
    position: number,
    cb: (bytesWritten: number, buffer?: ArrayBufferLike) => void,
  ): void
  fsync(
    path: string,
    datasync: number,
    fd: number,
    cb: (err: any) => void,
  ): void
  fsyncdir(
    path: string,
    datasync: number,
    fd: number,
    cb: (err: any) => void,
  ): void
  ftruncate(
    path: string,
    fd: number,
    length: number,
    cb: (err: any) => void,
  ): void
  truncate(path: string, length: number, cb: (err: any) => void): void
  rename(src: string, dest: string, cb: (err: any) => void): void
  statfs(
    path: string,
    cb: (err: any, statfs: {
      bsize: number
      frsize: number
      blocks: number
      bfree: number
      bavail: number
      files: number
      ffree: number
      favail: number
      fsid: number
      flag: number
      namemax: number
    }) => void,
  ): void
}

export function createFuse(args: {
  mountpoint: string
  operations: FuseOperations
  options?: {
    debug?: boolean
    displayFolder?: string
    force?: boolean
    mkdir?: boolean
  }
  /** default is `true` */
  auto_umount?: boolean
}) {
  let fuse = new Fuse(args.mountpoint, args.operations, args.options)
  function mount() {
    return new Promise<void>((resolve, reject) => {
      fuse.mount(function (err: any) {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }
  function unmount() {
    return new Promise<void>((resolve, reject) => {
      fuse.unmount(function (err: any) {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }
  if (args.auto_umount !== false) {
    process.once('SIGINT', () => {
      // receive ctrl+c
      unmount()
      process.exit(0)
    })
    process.once('SIGUSR1', () => {
      // receive SIGUSR1
      unmount()
      process.exit(0)
    })
    process.once('SIGUSR2', () => {
      // receive SIGUSR2
      unmount()
      process.exit(0)
    })
    process.once('SIGTERM', () => {
      // receive SIGTERM
      unmount()
      process.exit(0)
    })
  }
  return {
    fuse,
    mountpoint: args.mountpoint,
    mount,
    unmount,
  }
}

export let ErrorCodes = {
  ENOENT: Fuse.ENOENT,
  ENOTDIR: Fuse.ENOTDIR,
  EEXIST: Fuse.EEXIST,
  ENOTEMPTY: Fuse.ENOTEMPTY,
  EISDIR: Fuse.EISDIR,
  EINVAL: Fuse.EINVAL,
}
