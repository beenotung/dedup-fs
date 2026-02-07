import { find } from 'better-sqlite3-proxy'
import { File, proxy } from './proxy'
import { hashChunk } from './hash'

let block_size = 256

/** @returns id of the block */
function saveBlock(chunk: Buffer): number {
  let hash = hashChunk(chunk)
  let block = find(proxy.block, { hash })
  if (block) {
    block.count++
    return block.id!
  } else {
    let id = proxy.block.push({ hash, count: 1, chunk })
    return id
  }
}

/** @returns id of the dir */
export function saveDir(path: string): number {
  if (!path.startsWith('/')) {
    throw new Error('path must start with /')
  }
  let parts = path.split('/')
  let parent_id = getRootDir()
  for (let i = 1; i < parts.length; i++) {
    let name = parts[i]
    parent_id = saveDirPart(parent_id, name)
  }
  return parent_id
}

let getRootDir = (): number => {
  let row = find(proxy.dir, { name: '/' })
  let id
  if (row) {
    id = row.id!
  } else {
    let now = Date.now()
    id = proxy.dir.push({ name: '/', parent_id: null, ctime: now, mtime: now })
  }
  getRootDir = () => id
  return id
}

// parent_id -> name -> id
let cache_dir: Array<Map<string, number>> = []

function saveDirPart(parent_id: number, name: string): number {
  let dirs = cache_dir[parent_id]
  if (!dirs) {
    dirs = new Map<string, number>()
    cache_dir[parent_id] = dirs
  }

  let id = dirs.get(name)
  if (id) {
    return id
  }

  let row = find(proxy.dir, { parent_id, name })
  id
  if (row) {
    id = row.id!
  } else {
    let now = Date.now()
    id = proxy.dir.push({ name, parent_id, ctime: now, mtime: now })
    proxy.dir[parent_id].mtime = now
  }
  dirs.set(name, id)
  return id
}

/** @returns id of the file */
export function saveFile(args: {
  dir_id: number
  name: string
  content: Buffer
  mimetype_id: number
}) {
  let content = args.content
  let now = Date.now()
  let parts: Array<number> = []
  for (let offset = 0; offset < content.length; offset += block_size) {
    let chunk = content.subarray(offset, offset + block_size)
    let id = saveBlock(chunk)
    parts.push(id)
  }
  let id = proxy.file.push({
    dir_id: args.dir_id,
    name: args.name,
    size: content.byteLength,
    ctime: now,
    mtime: now,
    mimetype_id: args.mimetype_id,
    parts: parts.join(','),
  })
  proxy.dir[args.dir_id].mtime = now
  return id
}

export function updateFile(args: { file: File; content: Buffer }) {
  let file = args.file
  let content = args.content
  let now = Date.now()
  let parts: Array<string | number> = file.parts.split(',')
  for (let id of parts) {
    proxy.block[+id].count--
  }
  parts = []
  for (let offset = 0; offset < content.length; offset += block_size) {
    let chunk = content.subarray(offset, offset + block_size)
    let id = saveBlock(chunk)
    parts.push(id)
  }
  file.size = content.byteLength
  file.mtime = now
  file.parts = parts.join(',')
}

// name -> id
let cache_mimetype: Map<string, number> = new Map<string, number>()

export function saveMimetype(name: string): number {
  let id = cache_mimetype.get(name)
  if (id) {
    return id
  }
  let row = find(proxy.mimetype, { name })
  if (row) {
    id = row.id!
  } else {
    id = proxy.mimetype.push({ name })
  }
  cache_mimetype.set(name, id)
  return id
}

export function getFileContent(file: File): Buffer {
  let parts: Array<string | number> = file.parts.split(',')
  let content = Buffer.alloc(file.size)
  let offset = 0
  for (let id of parts) {
    let chunk = proxy.block[+id].chunk
    chunk.copy(content, offset)
    offset += chunk.length
  }
  return content
}

export function* getFileContentStream(file: File) {
  let parts: Array<string | number> = file.parts.split(',')
  for (let id of parts) {
    yield proxy.block[+id].chunk
  }
}
