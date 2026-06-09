// Converts an AudioBuffer to an MP3 Blob using lamejs (loaded from CDN as window.lamejs).
// Expects a 1- or 2-channel AudioBuffer. Channels above 2 are dropped to stereo
// (left + right only). Bitrate defaults to 128 kbps.

function floatTo16BitPCM(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return output;
}

export async function encodeMP3(audioBuffer, bitrate = 128) {
  if (!window.lamejs || typeof window.lamejs.Mp3Encoder !== 'function') {
    throw new Error('lamejs.Mp3Encoder unavailable — check the CDN <script> in index.html');
  }
  if (!audioBuffer.numberOfChannels) {
    throw new Error('encodeMP3: AudioBuffer has zero channels');
  }
  const channels = audioBuffer.numberOfChannels >= 2 ? 2 : 1;
  const sampleRate = audioBuffer.sampleRate;
  const encoder = new window.lamejs.Mp3Encoder(channels, sampleRate, bitrate);

  const left = floatTo16BitPCM(audioBuffer.getChannelData(0));
  const right = channels === 2 ? floatTo16BitPCM(audioBuffer.getChannelData(1)) : null;

  const blockSize = 1152; // lamejs canonical block size
  const mp3Chunks = [];

  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    const rightChunk = right ? right.subarray(i, i + blockSize) : null;
    const encoded = right
      ? encoder.encodeBuffer(leftChunk, rightChunk)
      : encoder.encodeBuffer(leftChunk);
    if (encoded.length > 0) mp3Chunks.push(encoded);
  }
  const flush = encoder.flush();
  if (flush.length > 0) mp3Chunks.push(flush);

  return new Blob(mp3Chunks, { type: 'audio/mpeg' });
}
