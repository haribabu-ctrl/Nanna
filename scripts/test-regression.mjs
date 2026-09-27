// ============================================================
// Comprehensive Regression Test Suite for Face Authentication,
// Calibrated Liveness Detection, Temporal Tracking, and Camera Recovery
// ============================================================

import {
  detectFaceBounds,
  resetFaceTracker,
  verifyFaceLiveness,
  compareFaceDescriptors,
  FACE_MATCH_THRESHOLD,
} from '../lib/biometrics/face.ts'

console.log('======================================================================')
console.log('STARTING FACE AUTHENTICATION & LIVENESS CALIBRATION REGRESSION SUITE')
console.log('======================================================================\n')

let passedCount = 0
let failedCount = 0

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`)
    passedCount++
  } else {
    console.error(`  ✕ FAIL: ${testName}`)
    failedCount++
  }
}

// Generate synthetic unit vectors with controlled noise
function generateVector(seed = 1.0, noiseLevel = 0.0) {
  const vec = []
  let sumSq = 0
  for (let i = 0; i < 128; i++) {
    const base = Math.sin(i * 0.2 + seed) * Math.cos(i * 0.15)
    const noise = noiseLevel * ((Math.sin(i * 99 + seed * 33) + 1) / 2 - 0.5)
    const val = base + noise
    vec.push(val)
    sumSq += val * val
  }
  const norm = Math.sqrt(sumSq) || 1
  return vec.map(v => Number((v / norm).toFixed(6)))
}

console.log('--- TEST GROUP 1: Normal Seated Human Micro-Motion (Fix for False Excessive Movement) ---')
// Real webcam feeds produce realistic sensor noise + natural micro-motion (variance ~0.5 - 1.4)
const normalHumanSequence = [
  generateVector(1.234, 0.00),
  generateVector(1.234, 0.08),
  generateVector(1.234, 0.14),
  generateVector(1.234, 0.10),
]
const normalMetadata = [
  { timestamp: 100, box: { x: 100, y: 100, width: 200, height: 200, confidence: 0.9 }, normalizedBox: { cx: 0.50, cy: 0.50, width: 0.35, height: 0.45 } },
  { timestamp: 220, box: { x: 102, y: 101, width: 200, height: 200, confidence: 0.9 }, normalizedBox: { cx: 0.505, cy: 0.502, width: 0.35, height: 0.45 } },
  { timestamp: 340, box: { x: 101, y: 102, width: 201, height: 200, confidence: 0.9 }, normalizedBox: { cx: 0.502, cy: 0.505, width: 0.351, height: 0.45 } },
  { timestamp: 460, box: { x: 100, y: 100, width: 200, height: 200, confidence: 0.9 }, normalizedBox: { cx: 0.50, cy: 0.50, width: 0.35, height: 0.45 } },
]

const normalResult = verifyFaceLiveness(normalHumanSequence, normalMetadata)
console.log(`    L1 Variance: ${normalResult.variance} (Allowed: 0.003 - 2.20)`)
console.log(`    MAE per dimension: ${normalResult.maePerDimension}`)
console.log(`    Cosine distance: ${normalResult.cosineDistance}`)
console.log(`    Max frame displacement: ${normalResult.movementScore}`)
assert(normalResult.passed === true, 'Natural seated human micro-motion MUST PASS liveness check')
assert(normalResult.isExcessiveMovement === false, 'Natural seated human must NOT be flagged as excessive movement')
assert(normalResult.isStatic === false, 'Natural seated human must NOT be flagged as static photo')

console.log('\n--- TEST GROUP 2: Genuine Excessive Movement Detection ---')
// Severe head jerking / shaking / looking away
const excessiveMovementSequence = [
  generateVector(1.0, 0.0),
  generateVector(1.0, 0.6),
  generateVector(1.0, 1.2),
]
const excessiveMetadata = [
  { timestamp: 100, box: { x: 50, y: 50, width: 200, height: 200, confidence: 0.9 }, normalizedBox: { cx: 0.25, cy: 0.25, width: 0.35, height: 0.45 } },
  { timestamp: 220, box: { x: 180, y: 180, width: 200, height: 200, confidence: 0.8 }, normalizedBox: { cx: 0.48, cy: 0.48, width: 0.35, height: 0.45 } }, // shifted > 20%
  { timestamp: 340, box: { x: 300, y: 200, width: 200, height: 200, confidence: 0.7 }, normalizedBox: { cx: 0.72, cy: 0.52, width: 0.35, height: 0.45 } },
]

const excessiveResult = verifyFaceLiveness(excessiveMovementSequence, excessiveMetadata)
console.log(`    L1 Variance: ${excessiveResult.variance}`)
console.log(`    Max displacement: ${excessiveResult.movementScore}`)
console.log(`    Reason: ${excessiveResult.reason}`)
assert(excessiveResult.passed === false, 'Genuine excessive movement MUST FAIL liveness check')
assert(excessiveResult.isExcessiveMovement === true, 'Must correctly identify isExcessiveMovement = true')
assert(excessiveResult.reason.includes('Excessive movement detected'), 'Displays clear instruction to hold steady')

console.log('\n--- TEST GROUP 3: Static Photo Presentation Attack Rejection ---')
// Completely static image (zero micro-motion)
const staticSequence = [
  generateVector(2.5, 0.0),
  generateVector(2.5, 0.0),
  generateVector(2.5, 0.0),
]
const staticMetadata = [
  { timestamp: 100, box: { x: 100, y: 100, width: 200, height: 200, confidence: 0.9 }, normalizedBox: { cx: 0.50, cy: 0.50, width: 0.35, height: 0.45 } },
  { timestamp: 220, box: { x: 100, y: 100, width: 200, height: 200, confidence: 0.9 }, normalizedBox: { cx: 0.50, cy: 0.50, width: 0.35, height: 0.45 } },
  { timestamp: 340, box: { x: 100, y: 100, width: 200, height: 200, confidence: 0.9 }, normalizedBox: { cx: 0.50, cy: 0.50, width: 0.35, height: 0.45 } },
]

const staticResult = verifyFaceLiveness(staticSequence, staticMetadata)
console.log(`    Variance: ${staticResult.variance}`)
console.log(`    Reason: ${staticResult.reason}`)
assert(staticResult.passed === false, 'Static photograph presentation attack MUST FAIL liveness check')
assert(staticResult.isStatic === true, 'Must correctly identify isStatic = true')
assert(staticResult.reason.includes('Static photo detected'), 'Displays clear instruction that live face is required')

console.log('\n--- TEST GROUP 4: Tracker Reset & Clean State Recovery ---')
resetFaceTracker()
assert(true, 'resetFaceTracker() executed cleanly without exceptions')

console.log('\n--- TEST GROUP 5: Biometric Cosine Similarity Matching Threshold ---')
const enrolledOwner = generateVector(1.234, 0.0)
const liveOwner = generateVector(1.234, 0.08) // same person with minor natural variance
const impostor = generateVector(5.678, 0.1) // different identity

const matchDecision = compareFaceDescriptors(enrolledOwner, liveOwner)
console.log(`    Owner Match Score: ${(matchDecision.similarity * 100).toFixed(2)}% | Threshold: ${(FACE_MATCH_THRESHOLD * 100).toFixed(1)}%`)
assert(matchDecision.match === true, 'Enrolled owner template MUST match live capture')
assert(matchDecision.similarity >= FACE_MATCH_THRESHOLD, 'Owner score must exceed 0.72 threshold')

const impostorDecision = compareFaceDescriptors(enrolledOwner, impostor)
console.log(`    Impostor Match Score: ${(impostorDecision.similarity * 100).toFixed(2)}% | Threshold: ${(FACE_MATCH_THRESHOLD * 100).toFixed(1)}%`)
assert(impostorDecision.match === false, 'Impostor face MUST be rejected')
assert(impostorDecision.similarity < FACE_MATCH_THRESHOLD, 'Impostor score must be strictly below 0.72 threshold')

console.log('\n======================================================================')
console.log(`REGRESSION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
console.log('======================================================================')

if (failedCount > 0) {
  process.exit(1)
} else {
  process.exit(0)
}
