import { useEffect, useState } from 'react'
import type { SpriteManifest } from './types'
import { assetUrl } from '../assets/assetResolver'

const cache = new Map<string, Promise<SpriteManifest>>()

function loadManifest(relPath: string): Promise<SpriteManifest> {
  const url = assetUrl(relPath)
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`manifest ${url} ${r.status}`)
          return r.json() as Promise<SpriteManifest>
        })
        .catch((err) => {
          cache.delete(url)
          throw err
        }),
    )
  }
  return cache.get(url)!
}

export function useSpriteManifest(relPath: string | null) {
  const [manifest, setManifest] = useState<SpriteManifest | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!relPath) {
      setManifest(null)
      setError(null)
      return
    }
    let cancelled = false
    loadManifest(relPath)
      .then((m) => {
        if (!cancelled) {
          setManifest(m)
          setError(null)
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setManifest(null)
          setError(e.message)
        }
      })
    return () => {
      cancelled = true
    }
  }, [relPath])

  return { manifest, error }
}
