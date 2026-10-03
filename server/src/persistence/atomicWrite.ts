import { writeJsonAtomic } from '../storage/dataFs.js'

/**
 * Atomic JSON write. Local: temp file → fsync → rename.
 * Cloud: single-row upsert in Supabase (see storage/dataFs.ts).
 */
export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await writeJsonAtomic(filePath, data)
}
