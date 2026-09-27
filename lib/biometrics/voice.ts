// ============================================================
// Biometric Voiceprint Processing Engine
// - Local acoustic spectral profile extraction (64-band frequency vector)
// - Harmonic energy distribution & speech formant analysis
// - Server-side acoustic template matching
// ============================================================

export interface VoiceBiometricData {
  spectrum: number[] // 64-dimensional normalized frequency energy vector
  energyLevel: number
  capturedAt: string
  phraseUsed?: string
  provider?: string
}

export const ENROLLMENT_PHRASES = [
  'I am Hari, author of this private love vault. Verify my identity.',
  'My voice is my private password. Grant access to our memories.',
  'Initializing voiceprint authentication for Hari and our love vault.',
]

export const VERIFICATION_PHRASES = [
  'Access granted to the private world of Hari.',
  'Every moment together safely preserved in our vault.',
  'Open the private love vault for authorized user Hari.',
  'Biometric voice authorization confirmed for Hari.',
  'Identity verified, unlock our private memories.',
]

/**
 * Extracts a 64-band normalized acoustic spectrum from an AnalyserNode frequency snapshot.
 * Focuses on fundamental speech range (80Hz - 4000Hz).
 */
export function extractAcousticSpectrum(freqData: Uint8Array): { spectrum: number[]; energy: number } {
  // Typical FFT size 1024 gives 512 frequency bins up to 24kHz (approx 46.875 Hz per bin at 48kHz sample rate)
  // Human vocal range formants are primarily concentrated in bins 2 through 90 (approx 90Hz to 4200Hz)
  const targetBins = 64
  const startBin = 2
  const binsPerBand = 2

  const spectrum: number[] = []
  let totalEnergy = 0

  for (let i = 0; i < targetBins; i++) {
    let sum = 0
    for (let b = 0; b < binsPerBand; b++) {
      const binIdx = startBin + i * binsPerBand + b
      if (binIdx < freqData.length) {
        sum += freqData[binIdx]
      }
    }
    const bandAvg = sum / binsPerBand
    spectrum.push(bandAvg)
    totalEnergy += bandAvg * bandAvg
  }

  // Calculate energy level (to ensure non-silence)
  const meanEnergy = spectrum.reduce((a, b) => a + b, 0) / spectrum.length

  // Normalize spectral vector (L2 norm)
  const norm = Math.sqrt(totalEnergy) || 1
  const normalizedSpectrum = spectrum.map((v) => Number((v / norm).toFixed(6)))

  return { spectrum: normalizedSpectrum, energy: meanEnergy }
}

/**
 * Server-side cosine similarity comparison between live acoustic voiceprint and enrolled template.
 */
export function compareVoiceDescriptors(enrolled: number[], live: number[]): { match: boolean; similarity: number } {
  if (!enrolled || !live || enrolled.length !== live.length || enrolled.length === 0) {
    return { match: false, similarity: 0 }
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < enrolled.length; i++) {
    dotProduct += enrolled[i] * live[i]
    normA += enrolled[i] * enrolled[i]
    normB += live[i] * live[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  const similarity = denominator > 0 ? dotProduct / denominator : 0

  // Voice spectral threshold: >= 0.76 indicates matching vocal acoustic profile
  const MATCH_THRESHOLD = 0.76
  return {
    match: similarity >= MATCH_THRESHOLD,
    similarity: Number(similarity.toFixed(4)),
  }
}
