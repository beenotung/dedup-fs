import { proxySchema } from 'better-sqlite3-proxy'
import { db } from './db'

export type Block = {
  id?: null | number
  hash: string
  count: number
  chunk: Buffer
}

export type Dir = {
  id?: null | number
  name: string
  birth_time: number
  modify_time: number
  parent_id: null | number
  parent?: Parent
}

export type Mimetype = {
  id?: null | number
  name: string
}

export type File = {
  id?: null | number
  dir_id: number
  dir?: Dir
  name: string
  size: number
  birth_time: number
  modify_time: number
  mimetype_id: number
  mimetype?: Mimetype
  parts: string // json
}

export type DBProxy = {
  block: Block[]
  dir: Dir[]
  mimetype: Mimetype[]
  file: File[]
}

export let proxy = proxySchema<DBProxy>({
  db,
  tableFields: {
    block: [],
    dir: [
      /* foreign references */
      ['parent', { field: 'parent_id', table: 'parent' }],
    ],
    mimetype: [],
    file: [
      /* foreign references */
      ['dir', { field: 'dir_id', table: 'dir' }],
      ['mimetype', { field: 'mimetype_id', table: 'mimetype' }],
    ],
  },
})
