import { describe, it, expect, vi } from 'vitest'
import { startPcmCapture, takeToAudioBuffer, type PcmTake } from './pcmCapture'

/** Just enough of an AudioContext + ScriptProcessorNode to drive onaudioprocess by hand. */
function fakeGraph(sourceChannels = 2, sampleRate = 48000) {
  const processor = {
    onaudioprocess: null as ((e: AudioProcessingEvent) => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  const ctx = {
    sampleRate,
    destination: { name: 'destination' },
    createScriptProcessor: vi.fn(() => processor),
    createBuffer: vi.fn((channels: number, length: number, rate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length))
      return { numberOfChannels: channels, length, sampleRate: rate, getChannelData: (ch: number) => data[ch] }
    }),
  }
  const source = { channelCount: sourceChannels, connect: vi.fn(), disconnect: vi.fn() }
  const output = [new Float32Array(4).fill(0.5)]
  const pump = (...perChannel: number[][]) => processor.onaudioprocess?.({
    inputBuffer: { getChannelData: (ch: number) => Float32Array.from(perChannel[ch]) },
    outputBuffer: { numberOfChannels: output.length, getChannelData: (ch: number) => output[ch] },
  } as unknown as AudioProcessingEvent)
  return { ctx: ctx as unknown as AudioContext, rawCtx: ctx, processor, source: source as unknown as AudioNode, rawSource: source, pump, output }
}

describe('startPcmCapture', () => {
  it('collects every channel in order and reports the context sample rate', () => {
    const g = fakeGraph(2, 44100)
    const capture = startPcmCapture(g.ctx, g.source)
    g.pump([1, 2], [-1, -2])
    g.pump([3], [-3])
    const take = capture.stop()
    expect(take.sampleRate).toBe(44100)
    expect(take.frames).toBe(3)
    expect(take.callbacks).toBe(2)
    expect(Array.from(take.channels[0])).toEqual([1, 2, 3])
    expect(Array.from(take.channels[1])).toEqual([-1, -2, -3])
  })

  it('wires source -> processor -> destination, and asks for one input channel per source channel', () => {
    const g = fakeGraph(1)
    startPcmCapture(g.ctx, g.source, 2048)
    expect(g.rawCtx.createScriptProcessor).toHaveBeenCalledWith(2048, 1, 1)
    expect(g.rawSource.connect).toHaveBeenCalledWith(g.processor)
    expect(g.processor.connect).toHaveBeenCalledWith(g.rawCtx.destination)
  })

  it('silences its own output so the mic never plays through the speakers', () => {
    const g = fakeGraph(1)
    startPcmCapture(g.ctx, g.source)
    g.pump([0.9, 0.9, 0.9, 0.9])
    expect(Array.from(g.output[0])).toEqual([0, 0, 0, 0])
  })

  it('stops listening on stop(), keeps the take stable, and survives an already-disconnected source', () => {
    const g = fakeGraph(1)
    g.rawSource.disconnect.mockImplementation(() => { throw new Error('InvalidAccessError') })
    const capture = startPcmCapture(g.ctx, g.source)
    g.pump([1])
    const take = capture.stop()
    expect(g.processor.onaudioprocess).toBeNull()
    expect(g.processor.disconnect).toHaveBeenCalled()
    g.pump([2])
    expect(capture.stop()).toBe(take)
    expect(take.frames).toBe(1)
  })

  it('reports a graph that never ran as 0 callbacks, not just 0 frames', () => {
    const g = fakeGraph(1)
    const take = startPcmCapture(g.ctx, g.source).stop()
    expect(take).toMatchObject({ frames: 0, callbacks: 0 })
  })
})

describe('takeToAudioBuffer', () => {
  it('copies the samples into a buffer with the take’s shape', () => {
    const g = fakeGraph()
    const take: PcmTake = { channels: [Float32Array.from([0.1, 0.2]), Float32Array.from([0.3, 0.4])], sampleRate: 22050, frames: 2, callbacks: 1 }
    const buffer = takeToAudioBuffer(g.ctx, take)
    expect(g.rawCtx.createBuffer).toHaveBeenCalledWith(2, 2, 22050)
    expect(Array.from(buffer.getChannelData(1))).toEqual([Math.fround(0.3), Math.fround(0.4)])
  })
})
