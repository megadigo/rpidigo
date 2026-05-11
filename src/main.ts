import { bootstrapRegistries } from './registry/bootstrap'

async function main(): Promise<void> {
  await bootstrapRegistries()
  console.log('[rpidigo] registries ready � Firebase connected')
}

main().catch(console.error)

