import { proxySchema } from 'better-sqlite3-proxy'
import { db } from './db'

export type Block = {
  id?: null | number
  hash: string
  count: number
  chunk: Buffer
}

export type File = {
  id?: null | number
  name: string
  parts: string // json
}

export type DBProxy = {
  block: Block[]
  file: File[]
}

export let proxy = proxySchema<DBProxy>({
  db,
  tableFields: {
    block: [],
    file: [],
  },
})
