// ============================================================
// Comprehensive Biometric Test Suite
// Verifies face detection, embedding generation, comparison,
// dimension validation, liveness anti-spoofing, and edge cases.
// ============================================================

import {
  compareFaceDescriptors,
  verifyFaceLiveness,
  FACE_MATCH_THRESHOLD,
} from '../lib/biometrics/face.ts'
import {
  compareVoiceDescriptors,
} from '../lib/biometrics/voice.ts'

console.log('====================================================')
console.log('RUNNING PRIVATE LOVE VAULT BIOMETRIC TEST SUITE')
console.log('====================================================\n')

let passedTests = 0
let failedTests = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`)
    passedTests++
  } else {
    console.error(`  ✕ FAIL: ${message}`)
    failedTests++
  }
}

// Generate normalized mock synthetic 128-D face embeddings
function generateSyntheticFaceDescriptor(seed = 1.0, noiseFactor = 0.0) {
  const vec = []
  let sumSq = 0
  for (let i = 0; i < 128; i++) {
    // Generate deterministic baseline feature with subtle noise
    const base = Math.sin(i * 0.2 + seed) * Math.cos(i * 0.15)
    const noise = noiseFactor * ((Math.sin(i * 99 + seed * 33) + 1) / 2 - 0.5)
    const val = base + noise
    vec.push(val)
    sumSq += val * val
  }
  const norm = Math.sqrt(sumSq) || 1
  return vec.map(v => Number((v / norm).toFixed(6)))
}

console.log('--- TEST GROUP 1: Enrolled Face Verified under Comparable Capture Conditions ---')
const enrolledHari = generateSyntheticFaceDescriptor(1.234, 0.0)
const liveHariComparable = generateSyntheticFaceDescriptor(1.234, 0.08) // 8% realistic micro-shift

const matchResult = compareFaceDescriptors(enrolledHari, liveHariComparable)
console.log(`    Score: ${(matchResult.similarity * 100).toFixed(2)}% | Threshold: ${(FACE_MATCH_THRESHOLD * 100).toFixed(1)}%`)
assert(matchResult.match === true, 'Same owner under comparable capture conditions must be ACCEPTED')
assert(matchResult.similarity >= FACE_MATCH_THRESHOLD, `Similarity (${matchResult.similarity}) must meet threshold (${FACE_MATCH_THRESHOLD})`)
assert(matchResult.enrolledDims === 128 && matchResult.liveDims === 128, 'Dimensions must be exactly 128')

console.log('\n--- TEST GROUP 2: Non-Matching Faces (Impostor Detection) ---')
const impostorFace = generateSyntheticFaceDescriptor(5.678, 0.1)
const impostorResult = compareFaceDescriptors(enrolledHari, impostorFace)
console.log(`    Impostor Score: ${(impostorResult.similarity * 100).toFixed(2)}% | Threshold: ${(FACE_MATCH_THRESHOLD * 100).toFixed(1)}%`)
assert(impostorResult.match === false, 'Impostor face must be REJECTED')
assert(impostorResult.similarity < FACE_MATCH_THRESHOLD, `Impostor score (${impostorResult.similarity}) must fall below threshold`)

console.log('\n--- TEST GROUP 3: Incompatible Embedding Dimensions ---')
const badDimensionFace = enrolledHari.slice(0, 64) // only 64 dims instead of 128
const badDimResult = compareFaceDescriptors(enrolledHari, badDimensionFace)
assert(badDimResult.match === false, 'Incompatible embedding dimensions must be REJECTED')
assert(badDimResult.reason.includes('Incompatible embedding dimensions'), 'Clear reason for dimension mismatch must be reported')

console.log('\n--- TEST GROUP 4: Missing or Corrupted Enrollment Data ---')
const nullEnrolledResult = compareFaceDescriptors(null, liveHariComparable)
assert(nullEnrolledResult.match === false, 'Null enrolled template must be REJECTED')
assert(nullEnrolledResult.reason.includes('Missing biometric descriptor'), 'Reports missing descriptor error')

const nullLiveResult = compareFaceDescriptors(enrolledHari, null)
assert(nullLiveResult.match === false, 'Null live capture must be REJECTED')

console.log('\n--- TEST GROUP 5: Liveness & Anti-Spoofing Verification ---')
// Test 5A: Static Photograph Presentation Attack (Zero/low variance across frames)
const staticPhotoFrame = generateSyntheticFaceDescriptor(1.234, 0.0)
const staticPhotoSequence = [
  staticPhotoFrame,
  staticPhotoFrame,
  staticPhotoFrame,
  staticPhotoFrame,
]
const staticCheck = verifyFaceLiveness(staticPhotoSequence)
console.log(`    Static Photo Variance: ${staticCheck.variance} (Live requirement: >= 0.003)`)
assert(staticCheck.passed === false, 'Static photo presentation attack must FAIL liveness check')

// Test 5B: Live Human Micro-motion Sequence
const liveHumanSequence = [
  generateSyntheticFaceDescriptor(1.234, 0.00),
  generateSyntheticFaceDescriptor(1.234, 0.03),
  generateSyntheticFaceDescriptor(1.234, 0.05),
  generateSyntheticFaceDescriptor(1.234, 0.04),
]
const liveCheck = verifyFaceLiveness(liveHumanSequence)
console.log(`    Live Human Variance: ${liveCheck.variance} (Live requirement: >= 0.003 and <= 0.48)`)
assert(liveCheck.passed === true, 'Live human natural micro-motion must PASS liveness check')

// Test 5C: Chaotic Camera Shaking / Obstructed Feed
const chaoticSequence = [
  generateSyntheticFaceDescriptor(1.0, 0.0),
  generateSyntheticFaceDescriptor(9.0, 0.0),
  generateSyntheticFaceDescriptor(20.0, 0.0),
]
const chaoticCheck = verifyFaceLiveness(chaoticSequence)
assert(chaoticCheck.passed === false, 'Chaotic movement / noise must FAIL liveness check')

console.log('\n--- TEST GROUP 6: Voice Acoustic Verification ---')
function generateAcousticSpectrum(formantPeak = 12, bandwidth = 4) {
  const spectrum = []
  let sumSq = 0
  for (let i = 0; i < 64; i++) {
    // Formant energy peak
    const dist = Math.abs(i - formantPeak)
    const energy = Math.exp(-(dist * dist) / (2 * bandwidth * bandwidth)) * 100
    spectrum.push(energy)
    sumSq += energy * energy
  }
  const norm = Math.sqrt(sumSq) || 1
  return spectrum.map(v => Number((v / norm).toFixed(6)))
}

const enrolledVoice = generateAcousticSpectrum(12, 4) // Formant peak at 12
const liveVoiceMatch = generateAcousticSpectrum(12, 4.5) // Slight pitch/breath variation
const voiceMatchResult = compareVoiceDescriptors(enrolledVoice, liveVoiceMatch)
console.log(`    Matching Voice Score: ${(voiceMatchResult.similarity * 100).toFixed(2)}%`)
assert(voiceMatchResult.match === true, 'Matching voice acoustic spectrum must be ACCEPTED')

const impostorVoice = generateAcousticSpectrum(40, 5) // Completely different formant structure
const voiceMismatchResult = compareVoiceDescriptors(enrolledVoice, impostorVoice)
console.log(`    Impostor Voice Score: ${(voiceMismatchResult.similarity * 100).toFixed(2)}%`)
assert(voiceMismatchResult.match === false, 'Impostor voice spectrum must be REJECTED')

console.log('\n====================================================')
console.log(`TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`)
console.log('====================================================')

if (failedTests > 0) {
  process.exit(1)
} else {
  process.exit(0)
}
