import { createHash } from 'crypto'

export function hashChunk(chunk: Buffer): string {
  return createHash('sha256').update(chunk).digest('base64url')
}
