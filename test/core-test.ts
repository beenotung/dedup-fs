import { mount } from '../src/fs'

async function main() {
  const result = await mount('./mnt', {
    debug: true,
    mkdir: true,
  })
  console.log('mounted')

  // await sleep(1000)
  // console.log('unmounted')
  // result.unmount()
}
main().catch(error => {
  console.error(error)
  process.exit(1)
})

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
