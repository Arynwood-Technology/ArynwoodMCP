// Waveform peak extraction + drawing, shared by any timeline/track UI that
// needs to show audio amplitude. Peaks are computed once per decoded source
// at a fixed resolution — draw-time reads resample from that cached array
// instead of touching the raw PCM again, so zooming or resizing a track block
// never re-decodes or re-scans the source audio.

/** [min0,max0,min1,max1,...] per bucket, channels mixed down to mono by averaging. */
export function computePeaks(buffer: AudioBuffer, buckets = 1000): Float32Array {
  const length = buffer.length
  const channels = buffer.numberOfChannels
  const peaks = new Float32Array(buckets * 2)
  if (length === 0 || buckets === 0) return peaks

  const channelData: Float32Array[] = []
  for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c))

  const samplesPerBucket = length / buckets
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * samplesPerBucket)
    const end = Math.min(length, Math.floor((b + 1) * samplesPerBucket))
    let min = 0, max = 0
    for (let i = start; i < end; i++) {
      let sum = 0
      for (let c = 0; c < channels; c++) sum += channelData[c][i]
      const v = sum / channels
      if (v < min) min = v
      if (v > max) max = v
    }
    peaks[b * 2] = min
    peaks[b * 2 + 1] = max
  }
  return peaks
}

/** Draws the [startFrac, endFrac) window of `peaks` (fractions of the full
 * decoded source) stretched to fill `canvas` — used to show only a track's
 * trimmed region, resizing live as trim handles or timeline zoom change. */
export function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  opts: { startFrac: number; endFrac: number; color?: string; bg?: string },
) {
  const { startFrac, endFrac, color = '#7c6ef7', bg } = opts
  const w = canvas.width, h = canvas.height
  const ctx = canvas.getContext('2d')
  if (!ctx || w <= 0 || h <= 0) return
  ctx.clearRect(0, 0, w, h)
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h) }

  const buckets = peaks.length / 2
  if (buckets === 0) return
  const span = Math.max(endFrac - startFrac, 1e-6)

  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x < w; x++) {
    const frac = startFrac + (x / w) * span
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor(frac * buckets)))
    const min = peaks[idx * 2]
    const max = peaks[idx * 2 + 1]
    const y1 = ((1 - max) / 2) * h
    const y2 = ((1 - min) / 2) * h
    ctx.moveTo(x, y1)
    ctx.lineTo(x, Math.max(y2, y1 + 1))
  }
  ctx.stroke()
}
