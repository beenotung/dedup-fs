import { unlink, writeFile } from 'fs/promises'
import { Worker } from 'worker_threads'

export async function fork(args: {
  fn: Function
  argv?: string[]
  on_error?: (error: Error) => void
  on_message?: (message: any) => void
  on_exit?: (code: number) => void
  /** only support cloneable objects */
  data?: any
}) {
  let { fn, argv, on_error, on_message, on_exit, data } = args
  argv = argv ?? []
  let file = '/tmp/worker-' + Math.random().toString(36).substring(2, 8) + '.js'
  let code = `(${fn})(...${JSON.stringify(argv)})`
  await writeFile(file, code)
  let worker = new Worker(file, { workerData: data })
  if (on_error) {
    worker.on('error', on_error)
  }
  if (on_message) {
    worker.on('message', on_message)
  }
  if (on_exit) {
    worker.on('exit', on_exit)
  }
  worker.on('exit', () => {
    unlink(file).catch(error => {
      console.error(
        'failed to remove worker file:',
        JSON.stringify(file),
        error,
      )
    })
  })
  return worker
}

async function main() {
  await fork({
    fn: function test() {
      let fs = require('fs')
      fs.writeFileSync(
        'result.txt',
        JSON.stringify({
          args: arguments,
        }) + '\n',
      )
    },
    argv: ['hello', 'world'],
  })
}
main().catch(error => {
  console.error(error)
  process.exit(1)
})
