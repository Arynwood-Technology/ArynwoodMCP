/**
 * How the preview <video> is steered toward the timeline's playhead.
 *
 * The playhead runs off performance.now() while the <video> has its own clock, so they drift apart by
 * a few frames. The editor used to hard-seek whenever they differed by more than 0.2s. That is a trap:
 * a seek leaves the element reporting the target position while the playhead keeps running, so it looks
 * "behind" again immediately and gets seeked again — a runaway loop (~25 seeks in 12s of undisturbed
 * playback, measured) that turns playback into stepped frames with ~1s freezes on long-GOP files.
 * Instead: never correct while a seek is in flight, absorb small drift by nudging playbackRate (invisible),
 * and hard-seek only when far off, at a limited rate.
 */
export const HARD_SEEK_DRIFT_S = 0.75      // beyond this a nudge would take too long to converge
export const MIN_SEEK_INTERVAL_MS = 400
export const SCRUB_TOLERANCE_S = 0.04      // paused: frame-accurate
const NUDGE_DEADBAND_S = 0.08              // within this, do nothing
const NUDGE_FACTOR = 0.06                  // ±6% speed: imperceptible, closes 0.3s in ~5s

export interface VideoSyncInput {
  /** video.currentTime − intended source time; positive means the video is ahead. */
  drift: number
  isPlaying: boolean
  /** video.seeking */
  seeking: boolean
  msSinceLastSeek: number
  /** The clip's own speed (playbackRate when in sync). */
  speed: number
}

export interface VideoSyncAction { seek: boolean; rate: number }

export function planVideoSync({ drift, isPlaying, seeking, msSinceLastSeek, speed }: VideoSyncInput): VideoSyncAction {
  if (!isPlaying) return { seek: Math.abs(drift) > SCRUB_TOLERANCE_S, rate: speed }
  if (seeking) return { seek: false, rate: speed }
  if (Math.abs(drift) > HARD_SEEK_DRIFT_S && msSinceLastSeek > MIN_SEEK_INTERVAL_MS) return { seek: true, rate: speed }
  if (Math.abs(drift) > NUDGE_DEADBAND_S) return { seek: false, rate: speed * (drift < 0 ? 1 + NUDGE_FACTOR : 1 - NUDGE_FACTOR) }
  return { seek: false, rate: speed }
}
