import * as fs from 'fs'
import { dirname, basename } from 'path'
import {
  block_size,
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
  getByPath,
  dir_mimetype_id,
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
          0o777
        : // 0o40755
          0o777,
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
  let stat = fs.statSync(args.type == 'file' ? __filename : __dirname)
  return Object.assign(stat, data)
  return data
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
  let ops: Record<string, Function> = {
    readdir(
      path: string,
      cb: (err: any, names: string[], stats?: Partial<fs.Stats>[]) => void,
    ) {
      let dir = getByPath(path)
      if (!dir) return cb(Fuse.ENOENT, [])
      let files = readDir(dir)
      let names = files.map(file => file.name)
      let stats = files.map(file =>
        stat({
          id: file.id!,
          modify_time: file.modify_time,
          birth_time: file.birth_time,
          size: file.size,
          type: file.type,
        }),
      )
      return cb(null, names, stats)
    },
    getattr(path: string, cb: (err: any, stat: null | fs.Stats) => void) {
      let file = getByPath(path)
      if (!file) return cb(Fuse.ENOENT, null)
      return cb(
        null,
        stat({
          id: file.id!,
          modify_time: file.modify_time,
          birth_time: file.birth_time,
          size: file.size,
          type: file.mimetype_id == dir_mimetype_id ? 'dir' : 'file',
        }),
      )
    },
    access(path: string, mode: number, cb: (err: number) => void) {
      let file = getByPath(path)
      return cb(file ? 0 : Fuse.ENOENT)
    },
    // Return ENOSYS so kernel has no dir handle and uses READDIR(path) not READDIRPLUS
    opendir(
      path: string,
      flags: number,
      cb: (err: number, fd?: number) => void,
    ) {
      return cb(Fuse.ENOSYS, 0)
    },
  }
  if (options.debug) {
    for (let key in ops) {
      let fn = ops[key]
      ops[key] = function () {
        console.log('call', key, arguments)
        let cb = arguments[arguments.length - 1]
        arguments[arguments.length - 1] = function (err: any, result: any) {
          if (key == 'getattr' && result) {
            result = {
              id: result.ino,
              type: result.isFile() ? 'file' : 'dir',
            }
          }
          console.log('callback of ' + key, err, result)
          cb.apply(this, arguments)
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
    autoCache: false,
  }
  let fuse = new Fuse(mountpoint, ops, opts)
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
    process.exit(0)
  })
  process.on('SIGUSR2', () => {
    if (options.debug) {
      console.log('SIGUSR2 signal received')
    }
    unmount()
    process.exit(0)
  })

  // TODO handle restart from ts-node-dev

  return new Promise<MountResult>((resolve, reject) => {
    fuse.mount((err: any) => {
      if (err) reject(err)
      resolve(result)
    })
  })
}
