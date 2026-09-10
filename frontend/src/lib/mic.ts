// Shared getUserMedia() error → human-readable message. Used by any component
// that records audio (studio/AudioRecorder.tsx, video/TimelineEditor.tsx).

export function describeMicError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError') {
    if (!window.isSecureContext) {
      return 'Microphone access requires a secure context. You are loading this page over plain HTTP from a non-localhost address — open it as http://localhost:5180 (or over HTTPS) instead.'
    }
    return 'Microphone access was blocked, and the browser did not even show a permission prompt — that means it was already denied for this site. Click the blocked-camera/lock icon in the address bar, set Microphone to "Allow," then reload the page and try again.'
  }
  if (name === 'NotFoundError') return 'No microphone was found. Check that one is connected and enabled in your OS sound settings.'
  if (name === 'NotReadableError') return 'The microphone is already in use by another application (or a hardware/driver error occurred).'
  if (name === 'OverconstrainedError') return 'The selected microphone is no longer available. Pick a different one from the dropdown.'
  return e instanceof Error ? e.message : String(e)
}
