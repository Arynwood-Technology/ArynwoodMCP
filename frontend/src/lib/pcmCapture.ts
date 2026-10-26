// Raw PCM capture straight off a Web Audio graph, for recording the microphone.
//
// MediaRecorder can't be trusted in the desktop app's web view: on WebKitGTK 2.52 / GStreamer 1.24 it records
// 0 bytes from a real capture device (GStreamer: "Couldn't find a compatible stream profile"; reproduced
// 2026-10-25 with a PulseAudio source, with every host plugin installed), while ScriptProcessorNode has worked
// in every engine. Video's voice-over (TimelineEditor) captures the same way. The take is plain samples, so it
// goes straight to an AudioBuffer: no container, codec or decode step in between.

export interface PcmTake {
  channels: Float32Array[]
  sampleRate: number
  frames: number
  /** onaudioprocess calls seen: 0 means the graph never ran, which is a different problem from a silent mic */
  callbacks: number
}

export interface PcmCapture {
  /** Stop capturing and return everything captured. Calling it again returns the same take. */
  stop(): PcmTake
}

export function startPcmCapture(ctx: AudioContext, source: AudioNode, bufferSize = 4096): PcmCapture {
  const channelCount = Math.max(1, source.channelCount || 1)
  const processor = ctx.createScriptProcessor(bufferSize, channelCount, 1)
  const chunks: Float32Array[][] = Array.from({ length: channelCount }, () => [])
  let callbacks = 0
  processor.onaudioprocess = e => {
    callbacks++
    for (let ch = 0; ch < channelCount; ch++) chunks[ch].push(new Float32Array(e.inputBuffer.getChannelData(ch)))
    // This node only observes the samples: zero its output so nothing reaches the speakers.
    for (let ch = 0; ch < e.outputBuffer.numberOfChannels; ch++) e.outputBuffer.getChannelData(ch).fill(0)
  }
  source.connect(processor)
  // Some engines only pump onaudioprocess while the node is part of a graph reaching the destination.
  processor.connect(ctx.destination)

  let take: PcmTake | null = null
  return {
    stop() {
      if (take) return take
      // Null the handler first so no queued callback can add a chunk after the take is assembled.
      processor.onaudioprocess = null
      processor.disconnect()
      try { source.disconnect(processor) } catch { /* the source was already disconnected */ }
      const channels = chunks.map(joinChunks)
      take = { channels, sampleRate: ctx.sampleRate, frames: channels[0].length, callbacks }
      return take
    },
  }
}

function joinChunks(list: Float32Array[]): Float32Array {
  const out = new Float32Array(list.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of list) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

export function takeToAudioBuffer(ctx: BaseAudioContext, take: PcmTake): AudioBuffer {
  const buffer = ctx.createBuffer(take.channels.length, Math.max(1, take.frames), take.sampleRate)
  take.channels.forEach((data, ch) => buffer.getChannelData(ch).set(data))
  return buffer
}
