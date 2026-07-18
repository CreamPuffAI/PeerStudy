import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const assetsDir = path.resolve('dist/assets')
const assetNames = (await readdir(assetsDir)).filter((name) => name.endsWith('.js'))

if (assetNames.length === 0) {
  throw new Error('No JavaScript assets found in dist/assets.')
}

const bundle = (
  await Promise.all(assetNames.map((name) => readFile(path.join(assetsDir, name), 'utf8')))
).join('\n')

if (bundle.includes('http://localhost:8000')) {
  throw new Error('Production bundle still contains the localhost API URL.')
}

if (!bundle.includes('/api/v1')) {
  throw new Error('Production bundle does not contain the expected API path.')
}

console.log('Production API configuration: OK')

