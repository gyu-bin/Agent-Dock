import { mkdir, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

/**
 * Atomic JSON write: temp file → fsync → rename.
 * Reduces torn/corrupt JSON on crash mid-write.
 */
export async function atomicWriteJson(
  filePath: string,
  data: unknown,
): Promise<void> {
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  const payload = `${JSON.stringify(data, null, 2)}\n`
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(payload, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await rename(tmp, filePath)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}
