import { filter, find, pick } from 'better-sqlite3-proxy'
import { File, proxy } from './proxy'
import { hashChunk } from './hash'
import { db } from './db'
import { basename, dirname } from 'path'
import { Code } from './code'

export let block_size = 256

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
  if (path === '/') {
    return getRootDir()
  }
  let parts = path.split('/')
  let parent_id = getRootDir()
  for (let i = 1; i < parts.length; i++) {
    let name = parts[i]
    parent_id = saveDirPart(parent_id, name)
  }
  return parent_id
}

export function getByPath(path: string): File | null {
  if (!path.startsWith('/')) {
    throw new Error('path must start with /')
  }
  if (path === '/') {
    return proxy.file[getRootDir()]
  }
  let parts = path.split('/')
  let parent_id: number | null = getRootDir()
  for (let i = 1; i < parts.length; i++) {
    let name = parts[i]
    parent_id = findFile(parent_id, name)
    if (!parent_id) return null
    if (proxy.file[parent_id].mimetype_id != dir_mimetype_id) {
      let subpath = parts.slice(0, i + 1).join('/')
      throw new Error(`path ${subpath} is not a directory`)
    }
  }
  return proxy.file[parent_id]
}

let select_by_dir = db.prepare<
  { parent_id: number },
  {
    id: number
    name: string
    size: number
    birth_time: number
    modify_time: number
    mimetype_id: number
  }
>(/* sql */ `
select
  id
, name
, size
, birth_time
, modify_time
, mimetype_id
from file where parent_id = :parent_id
`)

export function readDir(dir: File) {
  return select_by_dir.all({ parent_id: dir.id! }).map(row => {
    return {
      ...row,
      type:
        row.mimetype_id == dir_mimetype_id
          ? ('dir' as const)
          : ('file' as const),
    }
  })
}

let getRootDir = (): number => {
  let row = find(proxy.file, { name: '/' })
  let id
  if (row) {
    id = row.id!
  } else {
    let now = Date.now()
    id = proxy.file.push({
      name: '/',
      parent_id: null,
      child_count: 0,
      birth_time: now,
      modify_time: now,
      size: 0,
      mimetype_id: dir_mimetype_id,
      parts: null,
    })
  }
  getRootDir = () => id
  return id
}

// parent_id -> name -> id
let cache_dir: Array<Map<string, number>> = []

function findFile(parent_id: number, name: string): number | null {
  let dirs = cache_dir[parent_id]
  if (!dirs) {
    dirs = new Map<string, number>()
    cache_dir[parent_id] = dirs
  }

  let id = dirs.get(name)
  if (!id) {
    let row = find(proxy.file, { parent_id, name })
    if (!row) return null
    id = row.id!
  }
  dirs.set(name, id)
  return id
}

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

  let row = find(proxy.file, { parent_id, name })
  id
  if (row) {
    id = row.id!
  } else {
    let now = Date.now()
    id = proxy.file.push({
      name,
      parent_id,
      child_count: 0,
      birth_time: now,
      modify_time: now,
      size: 0,
      mimetype_id: dir_mimetype_id,
      parts: null,
    })
    proxy.file[parent_id].modify_time = now
    proxy.file[parent_id].child_count++
  }
  dirs.set(name, id)
  return id
}

/** @returns id of the file */
export function saveFile(args: {
  dir_id: number | null
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
    parent_id: args.dir_id,
    name: args.name,
    child_count: 0,
    size: content.byteLength,
    birth_time: now,
    modify_time: now,
    mimetype_id: args.mimetype_id,
    parts: parts.join(','),
  })
  if (args.dir_id != null) {
    proxy.file[args.dir_id].modify_time = now
    proxy.file[args.dir_id].child_count++
    return id
  }
}

export function updateFile(args: { file: File; content: Buffer }) {
  let file = args.file
  let content = args.content
  let now = Date.now()
  let parts = getParts(file)
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
  file.modify_time = now
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
  if (file.size === 0) return Buffer.alloc(0)
  let parts = getParts(file)
  let content = Buffer.alloc(file.size)
  let offset = 0
  for (let id of parts) {
    let chunk = proxy.block[+id].chunk
    chunk.copy(content, offset)
    offset += chunk.length
  }
  return content
}

function getParts(file: File): Array<string | number> {
  let parts = file.parts
  if (!parts) return []
  if (typeof parts === 'number') {
    return [parts]
  }
  return parts.split(',')
}

export function* getFileContentStream(file: File) {
  let parts = getParts(file)
  for (let id of parts) {
    yield proxy.block[+id].chunk
  }
}

export function deleteFile(
  file: File,
  options: {
    // e.g. for rename
    keep_parts?: boolean
  } = {},
): void {
  let now = Date.now()
  if (!options.keep_parts) {
    let parts = getParts(file)
    for (let id of parts) {
      proxy.block[+id].count--
    }
  }
  let parent_id = file.parent_id
  delete proxy.file[file.id!]
  if (parent_id != null) {
    proxy.file[parent_id].child_count--
    proxy.file[parent_id].modify_time = now
    cache_dir[parent_id].delete(file.name)
  }
}

/** @returns true if removed */
export function deleteDir(dir: File): boolean {
  if (dir.child_count > 0) {
    return false
  }
  deleteFile(dir)
  return true
}

/** @returns 0 ok, -2 ENOENT, -17 EEXIST etc */
export function renamePath(srcPath: string, destPath: string): number {
  let srcFile = getByPath(srcPath)
  if (!srcFile) {
    return Code.not_exists
  }
  let srcDir = srcFile.parent

  let destFile = getByPath(destPath)
  if (destFile) {
    return Code.already_exists
  }
  let destDir = getByPath(dirname(destPath))

  let now = Date.now()
  if (srcDir) {
    srcDir.child_count--
    srcDir.modify_time = now
  }

  if (destDir) {
    destDir.child_count++
    destDir.modify_time = now
  }
  srcFile.parent_id = destDir ? destDir.id! : null

  return 0
}

export function truncateFile(file: File, size: number): void {
  let content = getFileContent(file)
  if (content.byteLength == size) return
  let newContent: Buffer
  if (size < content.byteLength) {
    newContent = content.subarray(0, size)
  } else {
    newContent = Buffer.alloc(size)
    content.copy(newContent, 0)
  }
  updateFile({ file, content: newContent })
}

export let dir_mimetype_id = saveMimetype('inode/directory')
