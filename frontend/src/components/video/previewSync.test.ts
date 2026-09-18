import { describe, it, expect } from 'vitest'
import { planVideoSync, HARD_SEEK_DRIFT_S, MIN_SEEK_INTERVAL_MS } from './previewSync'

const base = { isPlaying: true, seeking: false, msSinceLastSeek: 10_000, speed: 1 }

describe('planVideoSync', () => {
  it('leaves a well-synced playing video alone', () => {
    expect(planVideoSync({ ...base, drift: 0.03 })).toEqual({ seek: false, rate: 1 })
    expect(planVideoSync({ ...base, drift: -0.05 })).toEqual({ seek: false, rate: 1 })
  })

  it('does NOT seek a playing video for a small drift — it nudges playbackRate instead', () => {
    // The old code seeked at >0.2s, which stalls a long-GOP file and widens the gap: a runaway seek storm.
    const behind = planVideoSync({ ...base, drift: -0.3 })
    expect(behind.seek).toBe(false)
    expect(behind.rate).toBeGreaterThan(1)             // catch up
    const ahead = planVideoSync({ ...base, drift: 0.3 })
    expect(ahead.seek).toBe(false)
    expect(ahead.rate).toBeLessThan(1)                 // ease off
  })

  it('scales the nudge with the clip speed', () => {
    expect(planVideoSync({ ...base, speed: 2, drift: -0.3 }).rate).toBeCloseTo(2 * planVideoSync({ ...base, drift: -0.3 }).rate)
  })

  it('hard-seeks only when far off', () => {
    expect(planVideoSync({ ...base, drift: -(HARD_SEEK_DRIFT_S + 0.1) }).seek).toBe(true)
    expect(planVideoSync({ ...base, drift: HARD_SEEK_DRIFT_S + 0.1 }).seek).toBe(true)
  })

  it('never issues a correction while a seek is already in flight', () => {
    // After a seek the element reports the target position while the wall clock keeps running, so it
    // looks "behind" again at once — correcting THAT is exactly how the storm fed itself.
    expect(planVideoSync({ ...base, seeking: true, drift: -5 }).seek).toBe(false)
  })

  it('rate-limits hard seeks', () => {
    const tooSoon = planVideoSync({ ...base, drift: -3, msSinceLastSeek: MIN_SEEK_INTERVAL_MS - 1 })
    expect(tooSoon.seek).toBe(false)
    expect(tooSoon.rate).toBeGreaterThan(1)            // still nudging toward the playhead meanwhile
  })

  it('scrubbing while paused is frame-accurate', () => {
    expect(planVideoSync({ ...base, isPlaying: false, drift: 0.1 }).seek).toBe(true)
    expect(planVideoSync({ ...base, isPlaying: false, drift: 0.01 }).seek).toBe(false)
    expect(planVideoSync({ ...base, isPlaying: false, drift: 0.1 }).rate).toBe(1)
  })

  it('a simulated stall does not turn into a storm', () => {
    // 60 frames of a video frozen by a slow seek while the wall clock runs on: at most ONE hard seek.
    let seeks = 0, drift = 0, since = 10_000, seeking = false
    for (let frame = 0; frame < 60; frame++) {
      drift -= 1 / 60                                  // video frozen, timeline advancing
      const a = planVideoSync({ ...base, drift, seeking, msSinceLastSeek: since })
      since += 1000 / 60
      if (a.seek) { seeks++; since = 0; drift = 0; seeking = true }
      if (seeking && since > 200) seeking = false      // a seek takes ~200ms to complete
    }
    expect(seeks).toBeLessThanOrEqual(1)
  })
})
