import { describe, it, expect } from 'vitest'
import { describeStartFailure } from './useMusicJobPoll'

describe('describeStartFailure', () => {
  it('uses the backend\'s own explanation instead of a generic message', () => {
    expect(describeStartFailure(400, { detail: 'Provide input_audio (upload) or input_asset_id (an existing asset)' }))
      .toBe('Provide input_audio (upload) or input_asset_id (an existing asset)')
  })

  it('flattens a 422 list of field errors', () => {
    const data = { detail: [{ loc: ['body', 'duration_seconds'], msg: 'Input should be less than or equal to 60' }, { loc: ['body', 'provider'], msg: 'Field required' }] }
    expect(describeStartFailure(422, data)).toBe('duration_seconds: Input should be less than or equal to 60; provider: Field required')
  })

  it('never returns an empty message', () => {
    expect(describeStartFailure(500, null)).toMatch(/HTTP 500/)
    expect(describeStartFailure(502, { detail: '' })).toMatch(/HTTP 502/)
    expect(describeStartFailure(500, {})).toMatch(/HTTP 500/)
  })
})
