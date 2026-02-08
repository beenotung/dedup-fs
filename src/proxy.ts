import { proxySchema } from 'better-sqlite3-proxy'
import { db } from './db'

export type Block = {
  id?: null | number
  hash: string
  count: number
  chunk: Buffer
}

export type Mimetype = {
  id?: null | number
  name: string
}

export type File = {
  id?: null | number
  parent_id: null | number
  parent?: File
  name: string
  size: number
  birth_time: number
  modify_time: number
  mimetype_id: number
  mimetype?: Mimetype
  parts: null | string
  child_count: number
}

export type DBProxy = {
  block: Block[]
  mimetype: Mimetype[]
  file: File[]
}

export let proxy = proxySchema<DBProxy>({
  db,
  tableFields: {
    block: [],
    mimetype: [],
    file: [
      /* foreign references */
      ['parent', { field: 'parent_id', table: 'file' }],
      ['mimetype', { field: 'mimetype_id', table: 'mimetype' }],
    ],
  },
})
