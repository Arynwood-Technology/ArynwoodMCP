import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { describeMicError, isConstraintError, nextDeviceId, openMicStream, usableInputs } from './mic'

const device = (deviceId: string, kind: MediaDeviceKind = 'audioinput', label = ''): MediaDeviceInfo =>
  ({ deviceId, kind, label, groupId: '', toJSON: () => ({}) }) as MediaDeviceInfo

/** WebKitGTK's getUserMedia rejection: a plain object/Error with a name, not a DOMException instance. */
const webkitError = (name: string, message: string) => Object.assign(new Error(message), { name })

describe('describeMicError', () => {
  it('recognises errors by name, not by being a DOMException (the "Invalid constraint" bug)', () => {
    const e = webkitError('OverconstrainedError', 'Invalid constraint')
    expect(e instanceof DOMException).toBe(false)
    expect(describeMicError(e)).toMatch(/selected microphone is no longer available/)
    expect(describeMicError(e)).not.toMatch(/Invalid constraint/)
  })

  it('catches the bare WebKit message even when the name is missing', () => {
    expect(describeMicError(new Error('Invalid constraint'))).toMatch(/selected microphone/)
  })

  it('maps the other getUserMedia failures', () => {
    expect(describeMicError(webkitError('NotFoundError', 'x'))).toMatch(/No microphone was found/)
    expect(describeMicError(webkitError('NotReadableError', 'x'))).toMatch(/already in use/)
  })

  it('explains a denied permission differently on a plain-HTTP page', () => {
    const denied = webkitError('NotAllowedError', 'x')
    vi.stubGlobal('isSecureContext', true)
    expect(describeMicError(denied)).toMatch(/blocked/)
    vi.stubGlobal('isSecureContext', false)
    expect(describeMicError(denied)).toMatch(/secure context/)
    vi.unstubAllGlobals()
  })

  it('falls back to the message, and copes with non-errors', () => {
    expect(describeMicError(new Error('boom'))).toBe('boom')
    expect(describeMicError('plain string')).toBe('plain string')
    expect(describeMicError(null)).toBe('null')
  })
})

describe('isConstraintError', () => {
  it('is true for constraint failures and false for permission/hardware ones', () => {
    expect(isConstraintError(webkitError('OverconstrainedError', ''))).toBe(true)
    expect(isConstraintError(webkitError('ConstraintNotSatisfiedError', ''))).toBe(true)
    expect(isConstraintError(new Error('Invalid constraint'))).toBe(true)
    expect(isConstraintError(webkitError('NotAllowedError', 'denied'))).toBe(false)
    expect(isConstraintError(undefined)).toBe(false)
  })
})

describe('usableInputs / nextDeviceId', () => {
  it('drops pre-permission devices (blank ids), non-inputs and duplicates', () => {
    const list = [device(''), device('a', 'audioinput', 'Mic A'), device('a', 'audioinput', 'Mic A again'), device('spk', 'audiooutput'), device('b')]
    expect(usableInputs(list).map(d => d.deviceId)).toEqual(['a', 'b'])
    expect(usableInputs([device(''), device('')])).toEqual([])
  })

  it('keeps a selection that still exists, otherwise falls back to the first device or the default', () => {
    const inputs = [device('a'), device('b')]
    expect(nextDeviceId('b', inputs)).toBe('b')
    expect(nextDeviceId('gone', inputs)).toBe('a')
    expect(nextDeviceId('', inputs)).toBe('a')
    expect(nextDeviceId('stale', [])).toBe('')
  })
})

describe('openMicStream', () => {
  const stream = { id: 'stream' } as unknown as MediaStream
  let gum: ReturnType<typeof vi.fn>

  beforeEach(() => {
    gum = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: gum } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('asks for plain audio when no device is chosen', async () => {
    gum.mockResolvedValue(stream)
    expect(await openMicStream('')).toBe(stream)
    expect(gum).toHaveBeenCalledWith({ audio: true })
  })

  it('prefers the chosen device as ideal, never exact', async () => {
    gum.mockResolvedValue(stream)
    await openMicStream('dev1', { echoCancellation: false })
    expect(gum).toHaveBeenCalledWith({ audio: { echoCancellation: false, deviceId: { ideal: 'dev1' } } })
  })

  it('retries without the device when the browser rejects the constraints', async () => {
    gum.mockRejectedValueOnce(webkitError('OverconstrainedError', 'Invalid constraint')).mockResolvedValueOnce(stream)
    expect(await openMicStream('stale', { autoGainControl: false })).toBe(stream)
    expect(gum).toHaveBeenCalledTimes(2)
    expect(gum).toHaveBeenLastCalledWith({ audio: { autoGainControl: false } })
  })

  it('retries down to plain `true` when there were no other constraints', async () => {
    gum.mockRejectedValueOnce(new Error('Invalid constraint')).mockResolvedValueOnce(stream)
    await openMicStream('stale')
    expect(gum).toHaveBeenLastCalledWith({ audio: true })
  })

  it('does not paper over a real failure like a denied permission', async () => {
    gum.mockRejectedValue(webkitError('NotAllowedError', 'denied'))
    await expect(openMicStream('dev1')).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(gum).toHaveBeenCalledTimes(1)
  })
})
