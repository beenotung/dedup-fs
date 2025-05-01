import * as fs from 'fs'
import * as path from 'path'
let Fuse = require('fuse-native')

let mnt = './mnt'
let handlers = {
  readdir: function (
    path: string,
    cb: (err: any, filenames: null | string[]) => void,
  ) {
    if (path === '/') return cb(null, ['test'])
    return cb(Fuse.ENOENT, null)
  },
  getattr: function (path: string, cb: (err: any, stat: null | any) => void) {
    if (path === '/') return cb(null, stat({ mode: 'dir', size: 4096 }))
    if (path === '/test') return cb(null, stat({ mode: 'file', size: 11 }))
    return cb(Fuse.ENOENT, null)
  },
  open: function (
    path: string,
    flags: number,
    cb: (err: any, fd: number) => void,
  ) {
    return cb(0, 42)
  },
  release: function (path: string, fd: number, cb: (err: any) => void) {
    return cb(0)
  },
  read: function (
    path: string,
    fd: number,
    buf: Buffer,
    len: number,
    pos: number,
    cb: (bytesRead: number) => void,
  ) {
    var str = 'hello world'.slice(pos, pos + len)
    if (!str) return cb(0)
    buf.write(str)
    return cb(str.length)
  },
}
let opts = {
  debug: true,
  displayFolder: 'LiteFS Folder',
  force: false,
  mkdir: false,
}

let fileStat = () => {
  let stat = fs.statSync('package.json')
  fileStat = () => stat
  return stat
}

let dirStat = () => {
  let stat = fs.statSync('/')
  dirStat = () => stat
  return stat
}

function stat(options: { mode: 'dir' | 'file'; size: number }): fs.Stats {
  let stat: fs.Stats
  // TODO also handle the atime, mtime, ctime, birthtime
  if (options.mode === 'dir') {
    stat = dirStat()
  } else {
    stat = fileStat()
  }
  stat.size = options.size
  return stat
}

let fuse = new Fuse(mnt, handlers, opts)
fuse.mount(function (err: any) {
  if (err) {
    console.error('failed to mount:', err)
    return
  }
  fs.readFile(path.join(mnt, 'test'), function (err: any, data: Buffer) {
    if (err) {
      console.error('failed to read:', err)
      return
    }
    console.log('read:', data.toString())
  })
})

process.on('SIGINT', () => {
  console.log('unmounting')
  fuse.unmount()
})
