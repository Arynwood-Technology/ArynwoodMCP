// Escape hatch for the `<audio src>` bypass problem: a browser fetches a bare `src`
// attribute (and `<video src>`/`new Audio()`) using its own native media loader, which
// never goes through a monkey-patched `window.fetch` — confirmed via lib/api.ts's own
// apiUrl() doc comment. So even a perfect fetchInterceptor.ts route can only ever satisfy
// a manual fetch() call, never an actual playback tag. The fix: resolve those `src`
// values to a real local `blob:` URL instead, via this tiny registry.
//
// Deliberately tiny with zero heavy deps — statically imported by MusicAssetCard.tsx,
// JamWithAI.tsx, StemSeparator.tsx, VoiceConversion.tsx, and VocalBooth.tsx (all always
// in the real app's bundle), same "always safe to import" tier as flag.ts. The actual
// audio synthesis/DSP that populates it lives behind main.tsx's dynamic bootstrap import
// and only ever calls registerDemoAudio() — none of that heavier code is reachable from
// here, so importing this file pulls in nothing extra for the real build.
const blobs = new Map<string, Blob>()
const urls = new Map<string, string>()

export function registerDemoAudio(key: string, blob: Blob): string {
  const existing = urls.get(key)
  if (existing) URL.revokeObjectURL(existing)
  const url = URL.createObjectURL(blob)
  blobs.set(key, blob)
  urls.set(key, url)
  return url
}

export function getDemoAudioUrl(key: string): string | undefined {
  return urls.get(key)
}

export function getDemoAudioBlob(key: string): Blob | undefined {
  return blobs.get(key)
}
