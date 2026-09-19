// Shared microphone helpers. Used by any component that records audio
// (studio/AudioRecorder.tsx, video/TimelineEditor.tsx).

// WebKitGTK (the desktop app's webview) doesn't always throw a real DOMException from getUserMedia, so
// `e instanceof DOMException` is false for errors that are perfectly ordinary — go by the name instead.
function errorName(e: unknown): string {
  const name = (e as { name?: unknown } | null)?.name
  return typeof name === 'string' ? name : ''
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  const message = (e as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : String(e)
}

/** True for "the constraints you asked for can't be met" — in WebKit that surfaces as the bare message "Invalid constraint". */
export function isConstraintError(e: unknown): boolean {
  const name = errorName(e)
  return name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError' || /invalid constraint/i.test(errorMessage(e))
}

export function describeMicError(e: unknown): string {
  const name = errorName(e)
  if (name === 'NotAllowedError') {
    if (!window.isSecureContext) {
      return 'Microphone access requires a secure context. You are loading this page over plain HTTP from a non-localhost address — open it as http://localhost:5180 (or over HTTPS) instead.'
    }
    return 'Microphone access was blocked, and the browser did not even show a permission prompt — that means it was already denied for this site. Click the blocked-camera/lock icon in the address bar, set Microphone to "Allow," then reload the page and try again.'
  }
  if (name === 'NotFoundError') return 'No microphone was found. Check that one is connected and enabled in your OS sound settings.'
  if (name === 'NotReadableError') return 'The microphone is already in use by another application (or a hardware/driver error occurred).'
  if (isConstraintError(e)) return 'The selected microphone is no longer available. Pick a different one from the dropdown, or choose the default.'
  return errorMessage(e)
}

/**
 * The input devices worth offering in a dropdown. Before the first permission grant browsers list devices
 * with a blank `deviceId` (and blank label) — keeping those made the first device look selectable, and then
 * asking for it by that blank id is what produced "Invalid constraint". Duplicates are dropped as well.
 */
export function usableInputs(list: MediaDeviceInfo[]): MediaDeviceInfo[] {
  const seen = new Set<string>()
  return list.filter(d => {
    if (d.kind !== 'audioinput' || !d.deviceId || seen.has(d.deviceId)) return false
    seen.add(d.deviceId)
    return true
  })
}

/** Keep the current selection if that device still exists; otherwise fall back to the first one ('' = system default). */
export function nextDeviceId(current: string, inputs: MediaDeviceInfo[]): string {
  if (current && inputs.some(d => d.deviceId === current)) return current
  return inputs[0]?.deviceId ?? ''
}

/**
 * Open the microphone, preferring `deviceId`. The device is requested as `ideal`, never `exact`: an exact
 * request for an id that has gone stale (unplugged, or captured before permission was granted) rejects, and a
 * recorder that can't record because of a dropdown is worse than one that records from the default input.
 * If the browser rejects the constraints anyway, retry once with none.
 */
export async function openMicStream(deviceId: string, audio: MediaTrackConstraints = {}): Promise<MediaStream> {
  const ask = (constraints: MediaTrackConstraints) =>
    navigator.mediaDevices.getUserMedia({ audio: Object.keys(constraints).length ? constraints : true })
  if (!deviceId) return ask(audio)
  try {
    return await ask({ ...audio, deviceId: { ideal: deviceId } })
  } catch (e) {
    if (!isConstraintError(e)) throw e
    return ask(audio)
  }
}
