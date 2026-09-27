'use client'

/**
 * Shared Camera + Face-processing component used by:
 *   - Lock01Face (auth login, lock 1)
 *   - Lock06FaceFinal (auth login, lock 6)
 *   - Setup page (initial enrollment)
 *   - Re-enrollment page
 *
 * Core Features:
 *  1. Zero black screen: video stream is attached and starts playing immediately with no blocking timeouts.
 *  2. Real-time background face presence detection: Reticle turns green & displays "Face detected — hold still."
 *  3. Explicit, cleanly separated lifecycle states:
 *     CAMERA_INITIALIZING | CAMERA_READY | FACE_DETECTED | SCANNING |
 *     VERIFYING_WITH_BACKEND | AUTHENTICATED | VERIFICATION_FAILED | RETRY_AVAILABLE
 *  4. USB Phone Camera selection: detects external/phone webcams (Android 14+ USB Webcam, DroidCam, Iriun, Camo),
 *     dynamic enumeration on device change, manual refresh button, and interactive setup guide.
 *  5. Calibrated multi-modal liveness verification (MAE, displacement, cosine distance).
 *  6. Countdown timer support for rate-limit retry delays.
 *  7. Development diagnostics HUD.
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react'
import {
  extractFaceFrameData,
  detectFaceBounds,
  verifyFaceLiveness,
  resetFaceTracker,
  FrameSampleMetadata,
  FaceDetectionBox,
} from '@/lib/biometrics/face'
import { HackerSpinner } from '@/components/ui/hacker-ui'

export interface CameraFaceScannerRef {
  stopCamera: () => void
  openCamera: (deviceId?: string) => Promise<void>
  retry: () => void
  setVerifying: (msg?: string) => void
  setAuthenticated: (msg?: string) => void
  setFailed: (errorMsg: string, retryAfter?: number) => void
  resetToReady: () => void
}

export type ScannerStatus =
  | 'idle'
  | 'requesting'
  | 'CAMERA_INITIALIZING'
  | 'CAMERA_READY'
  | 'FACE_DETECTED'
  | 'SCANNING'
  | 'VERIFYING_WITH_BACKEND'
  | 'AUTHENTICATED'
  | 'VERIFICATION_FAILED'
  | 'RETRY_AVAILABLE'
  // legacy aliases for compatibility
  | 'ready'
  | 'scanning'
  | 'analyzing'
  | 'done'
  | 'error'

export interface ScanResult {
  descriptor: number[]      // averaged 128-D L2-normalized vector
  liveness: { passed: boolean; variance: number }
  frames: number[][]
}

interface Props {
  /** Called when a complete scan finishes successfully */
  onScanComplete: (result: ScanResult) => void
  /** Called when camera or scan fails (empty string clears error) */
  onError: (msg: string) => void
  /** Show a scan-line laser animation */
  showScanLaser?: boolean
  /** Cyberpunk red theme color; defaults to #cc0000 */
  accentColor?: string
  /** Minimum number of valid frames required (default 3) */
  minFrames?: number
  /** Label on the scan button */
  scanButtonLabel?: string
  /** Disable the scan button (e.g., during API call) */
  disabled?: boolean
  /** Automatically request camera and start preview on mount (default true) */
  autoStart?: boolean
}

const CameraFaceScanner = forwardRef<CameraFaceScannerRef, Props>(function CameraFaceScanner(
  {
    onScanComplete,
    onError,
    showScanLaser = true,
    accentColor = '#cc0000',
    minFrames = 3,
    scanButtonLabel = '[ START 128-PT FACE SCAN ]',
    disabled = false,
    autoStart = true,
  },
  ref
) {
  const [status, setStatus] = useState<ScannerStatus>('idle')
  const [statusMsg, setStatusMsg] = useState('Camera standby — ready to initialize.')
  const [hasActiveStream, setHasActiveStream] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null)
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [showPhoneHelp, setShowPhoneHelp] = useState(false)

  // Diagnostics HUD data
  const [diagnostics, setDiagnostics] = useState({
    cameraReady: false,
    resolution: '0x0',
    activeTrack: false,
    faceDetected: false,
    detectionConfidence: 0,
    trackingStatus: 'Standby',
    normalizedMovement: 0,
    movementThreshold: 0.12,
    livenessVariance: 0,
    livenessStatus: 'idle' as 'idle' | 'tracking' | 'passed' | 'failed',
    embeddingGenerated: false,
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const framesRef = useRef<number[][]>([])
  const metadataRef = useRef<FrameSampleMetadata[]>([])
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const previewDetectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scanningGuardRef = useRef(false)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Countdown timer handler for rate-limits
  useEffect(() => {
    if (retryCountdown === null || retryCountdown <= 0) return

    countdownIntervalRef.current = setInterval(() => {
      setRetryCountdown(prev => {
        if (prev === null || prev <= 1) {
          if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
          return null
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
  }, [retryCountdown])

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    stopCamera,
    openCamera: (deviceId?: string) => openCamera(deviceId),
    retry,
    setVerifying: (msg?: string) => {
      setStatus('VERIFYING_WITH_BACKEND')
      setStatusMsg(msg || 'Verifying biometric identity with secure backend...')
      setErrorMsg('')
    },
    setAuthenticated: (msg?: string) => {
      setStatus('AUTHENTICATED')
      setStatusMsg(msg || 'IDENTITY CONFIRMED — ACCESS GRANTED')
      setErrorMsg('')
    },
    setFailed: (failMsg: string, retryAfter?: number) => {
      setStatus('VERIFICATION_FAILED')
      setErrorMsg(failMsg)
      if (retryAfter && retryAfter > 0) {
        setRetryCountdown(retryAfter)
        setStatusMsg(`Rate limited: Please wait ${retryAfter}s before retrying.`)
      } else {
        setStatusMsg(failMsg)
      }
    },
    resetToReady: () => {
      resetScanState()
      if (streamRef.current && streamRef.current.active) {
        setStatus('CAMERA_READY')
        setStatusMsg('Camera ready — position your face inside the frame.')
      } else {
        openCamera()
      }
    },
  }))

  function stopCamera() {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
    if (previewDetectIntervalRef.current) {
      clearInterval(previewDetectIntervalRef.current)
      previewDetectIntervalRef.current = null
    }
    scanningGuardRef.current = false
    resetFaceTracker()

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setHasActiveStream(false)
    setFaceDetected(false)
    setDiagnostics(prev => ({
      ...prev,
      cameraReady: false,
      activeTrack: false,
      trackingStatus: 'Offline',
    }))
  }

  function handleCameraError(err: unknown) {
    const e = err instanceof Error ? err : new Error('Unknown camera error')
    let msg = e.message

    if (
      e.name === 'NotAllowedError' ||
      e.name === 'PermissionDeniedError'
    ) {
      msg = 'Camera permission denied. Allow camera access in your browser address bar and retry.'
    } else if (
      e.name === 'NotFoundError' ||
      e.name === 'DevicesNotFoundError'
    ) {
      msg = 'No camera device found. Connect a webcam or Android phone via USB and click [ REFRESH CAMERAS ].'
    } else if (
      e.name === 'NotReadableError' ||
      e.name === 'TrackStartError'
    ) {
      msg = 'Camera is in use by another application. Close other camera apps and retry.'
    } else if (e.name === 'SecurityError') {
      msg = 'Camera access requires a secure context (HTTPS or localhost).'
    } else if (e.name === 'OverconstrainedError') {
      msg = 'Camera resolution constraints unsupported. Retrying with default settings...'
    }

    setHasActiveStream(false)
    setErrorMsg(msg)
    setStatus('VERIFICATION_FAILED')
    setStatusMsg(msg)
    onError(msg)
    setDiagnostics(prev => ({
      ...prev,
      cameraReady: false,
      activeTrack: false,
      trackingStatus: 'Error: ' + e.name,
    }))
  }

  // Enumerate video devices (webcam + phone-as-webcam)
  const enumerateCameras = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return
      const allDevices = await navigator.mediaDevices.enumerateDevices()
      const cameras = allDevices.filter(d => d.kind === 'videoinput')
      setVideoDevices(cameras)

      // Auto-select preferred camera if current is unset or invalid
      if (cameras.length > 0) {
        setSelectedDeviceId(prev => {
          const exists = cameras.some(c => c.deviceId === prev)
          if (!exists) {
            const phoneCam = cameras.find(c => {
              const label = (c.label || '').toLowerCase()
              return label.includes('droidcam') || label.includes('iriun') || label.includes('camo') || label.includes('android') || label.includes('usb')
            })
            return phoneCam ? phoneCam.deviceId : cameras[0].deviceId
          }
          return prev
        })
      }
    } catch {
      // Non-critical
    }
  }, [])

  // Listen for USB device connections/disconnections
  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', enumerateCameras)
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', enumerateCameras)
      }
    }
  }, [enumerateCameras])

  // Continuous background face presence detection while camera is idle/ready
  useEffect(() => {
    if (!hasActiveStream || status === 'SCANNING' || status === 'VERIFYING_WITH_BACKEND' || status === 'AUTHENTICATED') {
      if (previewDetectIntervalRef.current) {
        clearInterval(previewDetectIntervalRef.current)
        previewDetectIntervalRef.current = null
      }
      return
    }

    previewDetectIntervalRef.current = setInterval(() => {
      const video = videoRef.current
      const canvas = previewCanvasRef.current

      if (
        video &&
        canvas &&
        !video.paused &&
        !video.ended &&
        video.readyState >= HTMLMediaElement.HAVE_METADATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        canvas.width = 160
        canvas.height = Math.round((video.videoHeight / video.videoWidth) * 160)
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const box: FaceDetectionBox | null = detectFaceBounds(canvas, false)

          if (box) {
            setFaceDetected(true)
            setStatus(prev => (prev === 'CAMERA_READY' ? 'FACE_DETECTED' : prev))
            setStatusMsg('Face detected — hold still.')
            setDiagnostics(prev => ({
              ...prev,
              faceDetected: true,
              detectionConfidence: box.confidence,
              trackingStatus: 'Face Detected & Tracking',
            }))
          } else {
            setFaceDetected(false)
            setStatus(prev => (prev === 'FACE_DETECTED' ? 'CAMERA_READY' : prev))
            setStatusMsg('Camera ready — position your face inside the frame.')
            setDiagnostics(prev => ({
              ...prev,
              faceDetected: false,
              trackingStatus: 'Searching for face...',
            }))
          }
        }
      }
    }, 250)

    return () => {
      if (previewDetectIntervalRef.current) {
        clearInterval(previewDetectIntervalRef.current)
        previewDetectIntervalRef.current = null
      }
    }
  }, [hasActiveStream, status])

  const openCamera = useCallback(async (deviceId?: string) => {
    stopCamera()
    setErrorMsg('')
    onError('')
    setStatus('requesting')
    setStatusMsg('Requesting camera permission...')

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException(
          'Camera API (getUserMedia) is unavailable. Ensure you are accessing via localhost or HTTPS.',
          'SecurityError'
        )
      }

      const targetDeviceId = deviceId || selectedDeviceId
      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: 640 },
        height: { ideal: 480 },
      }

      if (targetDeviceId) {
        videoConstraints.deviceId = { exact: targetDeviceId }
      } else {
        videoConstraints.facingMode = { ideal: 'user' }
      }

      let stream: MediaStream

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        })
      } catch (constraintErr) {
        // Fallback to basic unconstrained video
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }

      if (!isMountedRef.current) {
        stream.getTracks().forEach(t => t.stop())
        return
      }

      streamRef.current = stream
      await enumerateCameras()

      const video = videoRef.current
      if (!video) {
        stream.getTracks().forEach(t => t.stop())
        throw new Error('Video preview element not ready.')
      }

      // Assign stream immediately
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      video.setAttribute('playsinline', 'true')
      video.setAttribute('muted', 'true')
      video.setAttribute('autoplay', 'true')

      // Call play() immediately
      try {
        await video.play()
      } catch (playErr) {
        console.warn('Initial play failed, retrying muted:', playErr)
        video.muted = true
        await video.play().catch(e => console.error('play retry error:', e))
      }

      // Instant visibility — NO 8-second blocking promise!
      setHasActiveStream(true)
      setStatus('CAMERA_READY')
      setStatusMsg('Camera ready — position your face inside the frame.')

      const res = `${video.videoWidth || 640}x${video.videoHeight || 480}`
      setDiagnostics(prev => ({
        ...prev,
        cameraReady: true,
        resolution: res,
        activeTrack: true,
        trackingStatus: 'Feed Active (Ready)',
      }))

      console.log(`[BIOMETRIC_DIAGNOSTICS] Camera stream active: ${res}`)
    } catch (err) {
      stopCamera()
      handleCameraError(err)
    }
  }, [selectedDeviceId, onError, enumerateCameras])

  // Auto-start camera on mount
  useEffect(() => {
    if (autoStart) {
      openCamera()
    }
    return () => {
      stopCamera()
    }
  }, [autoStart])

  function resetScanState() {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
    scanningGuardRef.current = false
    framesRef.current = []
    metadataRef.current = []
    resetFaceTracker()
    setScanProgress(0)
    setErrorMsg('')
    onError('')
    setDiagnostics(prev => ({
      ...prev,
      livenessStatus: 'idle',
      embeddingGenerated: false,
    }))
  }

  function startScan() {
    if (scanningGuardRef.current || status === 'VERIFYING_WITH_BACKEND' || status === 'AUTHENTICATED') return
    if (!streamRef.current || !videoRef.current) {
      setErrorMsg('Camera not active. Open the camera first.')
      return
    }

    resetScanState()
    scanningGuardRef.current = true
    setStatus('SCANNING')
    setStatusMsg('Scanning face — stay still and blink naturally.')

    setDiagnostics(prev => ({
      ...prev,
      livenessStatus: 'tracking',
      embeddingGenerated: false,
    }))

    let progress = 0
    let framesSampled = 0

    scanIntervalRef.current = setInterval(() => {
      progress += 5
      setScanProgress(Math.min(progress, 100))

      const video = videoRef.current
      const canvas = canvasRef.current

      if (
        video &&
        canvas &&
        !video.paused &&
        !video.ended &&
        video.readyState >= HTMLMediaElement.HAVE_METADATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

          const frameData = extractFaceFrameData(canvas)
          if (frameData && frameData.descriptor.length === 128) {
            framesRef.current.push(frameData.descriptor)
            metadataRef.current.push({
              timestamp: performance.now(),
              box: frameData.box,
              normalizedBox: frameData.normalizedBox,
              landmarks: frameData.landmarks,
            })
            framesSampled++

            setFaceDetected(true)
            setDiagnostics(prev => ({
              ...prev,
              faceDetected: true,
              detectionConfidence: frameData.box.confidence,
              trackingStatus: `Tracking (Box: ${frameData.box.width}x${frameData.box.height})`,
            }))

            if (framesSampled === 1) {
              setStatusMsg('Face detected & tracking — hold still.')
            }
          } else if (framesSampled === 0 && progress > 25) {
            setStatusMsg('Position your face clearly inside the reticle...')
            setDiagnostics(prev => ({
              ...prev,
              faceDetected: false,
              trackingStatus: 'Searching for face...',
            }))
          }
        }
      }

      if (progress >= 100) {
        if (scanIntervalRef.current) {
          clearInterval(scanIntervalRef.current)
          scanIntervalRef.current = null
        }
        finalizeScan()
      }
    }, 100)
  }

  const finalizeScan = useCallback(() => {
    scanningGuardRef.current = false
    setStatus('analyzing')
    setStatusMsg('Analyzing facial landmarks and anti-spoofing variance...')

    const frames = framesRef.current
    const metadata = metadataRef.current

    if (frames.length < minFrames) {
      const msg =
        frames.length === 0
          ? 'No face detected in camera feed. Position your face clearly in the frame and retry.'
          : `Too few face frames captured (${frames.length}/${minFrames}). Stay still and retry.`
      setErrorMsg(msg)
      setStatus('VERIFICATION_FAILED')
      setStatusMsg(msg)
      onError(msg)
      setDiagnostics(prev => ({
        ...prev,
        livenessStatus: 'failed',
      }))
      return
    }

    const liveness = verifyFaceLiveness(frames, metadata)

    setDiagnostics(prev => ({
      ...prev,
      livenessVariance: liveness.variance,
      livenessStatus: liveness.passed ? 'passed' : 'failed',
      normalizedMovement: liveness.movementScore || 0,
      movementThreshold: 0.12,
      embeddingGenerated: liveness.passed,
    }))

    console.log('[BIOMETRIC_DIAGNOSTICS] Scan Finalized:')
    console.log(`  ├── Frames sampled: ${frames.length}`)
    console.log(`  ├── L1 Variance: ${liveness.variance}`)
    console.log(`  ├── Normalized MAE: ${liveness.maePerDimension}`)
    console.log(`  ├── Max frame displacement: ${liveness.movementScore} (threshold: 0.12)`)
    console.log(`  ├── Cosine distance: ${liveness.cosineDistance} (threshold: 0.065)`)
    console.log(`  └── Decision: ${liveness.passed ? 'PASSED' : 'FAILED - ' + liveness.reason}`)

    if (!liveness.passed) {
      const msg = liveness.reason || 'Liveness verification failed. Please hold steady and retry.'
      setErrorMsg(msg)
      setStatus('VERIFICATION_FAILED')
      setStatusMsg(msg)
      onError(msg)
      return
    }

    // Average the 128-D descriptor across all collected frames
    const length = frames[0].length
    const avg: number[] = new Array(length).fill(0)
    for (const f of frames) {
      for (let i = 0; i < length; i++) avg[i] += f[i]
    }
    for (let i = 0; i < length; i++) {
      avg[i] = Number((avg[i] / frames.length).toFixed(6))
    }

    // Unit vector L2 normalization
    let sumSq = 0
    for (let i = 0; i < length; i++) sumSq += avg[i] * avg[i]
    const norm = Math.sqrt(sumSq) || 1
    const normalizedAvg = avg.map(v => Number((v / norm).toFixed(6)))

    // Transition to VERIFYING_WITH_BACKEND
    setStatus('VERIFYING_WITH_BACKEND')
    setStatusMsg('Face scan complete. Authenticating with secure vault...')

    onScanComplete({
      descriptor: normalizedAvg,
      liveness: { passed: true, variance: liveness.variance },
      frames,
    })
  }, [minFrames, onScanComplete, onError])

  /**
   * Resets scan state cleanly and recovers the camera feed immediately.
   */
  const retry = useCallback(() => {
    resetScanState()

    if (
      streamRef.current &&
      streamRef.current.active &&
      videoRef.current &&
      videoRef.current.srcObject
    ) {
      setStatus('CAMERA_READY')
      setStatusMsg('Camera ready — position your face inside the frame.')
      setHasActiveStream(true)
      videoRef.current.play().catch(() => {})
    } else {
      openCamera()
    }
  }, [openCamera])

  const accent = accentColor

  // Helper to format camera device labels
  function formatDeviceLabel(device: MediaDeviceInfo, index: number) {
    const raw = (device.label || `Camera ${index + 1}`).trim()
    const lower = raw.toLowerCase()
    if (lower.includes('droidcam') || lower.includes('iriun') || lower.includes('camo') || lower.includes('android')) {
      return `📱 [PHONE] ${raw}`
    }
    if (lower.includes('usb') || lower.includes('external')) {
      return `🔌 [USB] ${raw}`
    }
    return `📹 ${raw}`
  }

  const isScanning = status === 'SCANNING' || status === 'scanning'
  const isVerifying = status === 'VERIFYING_WITH_BACKEND' || status === 'analyzing'
  const isAuthenticated = status === 'AUTHENTICATED'
  const isFailed = status === 'VERIFICATION_FAILED' || status === 'error'
  const isReady = status === 'CAMERA_READY' || status === 'FACE_DETECTED' || status === 'ready' || status === 'RETRY_AVAILABLE'

  return (
    <div className="space-y-3 w-full">
      {/* Camera Device Switcher & Phone-Camera Help Controls */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-gray-400">
          <div className="flex items-center gap-1.5 overflow-hidden">
            <span className="text-gray-500 whitespace-nowrap">CAMERA:</span>
            {videoDevices.length > 0 ? (
              <select
                value={selectedDeviceId}
                disabled={isScanning || isVerifying}
                onChange={e => {
                  setSelectedDeviceId(e.target.value)
                  openCamera(e.target.value)
                }}
                className="bg-black/90 border border-gray-800 text-gray-200 text-xs px-2 py-0.5 rounded outline-none focus:border-red-500 truncate max-w-[200px]"
              >
                {videoDevices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {formatDeviceLabel(d, i)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-gray-600 text-xs italic">Detecting...</span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                enumerateCameras()
                openCamera(selectedDeviceId)
              }}
              title="Refresh Camera Devices"
              className="text-[10px] text-gray-400 hover:text-red-400 px-1.5 py-0.5 border border-gray-800 rounded bg-black/60 hover:border-red-900 transition-colors"
            >
              ⟳ REFRESH
            </button>
            <button
              type="button"
              onClick={() => setShowPhoneHelp(!showPhoneHelp)}
              title="Phone as USB Webcam Setup Instructions"
              className="text-[10px] text-red-500 hover:text-red-300 px-1.5 py-0.5 border border-red-900/60 rounded bg-red-950/20 hover:bg-red-900/40 transition-colors font-bold"
            >
              📱 USB PHONE CAM ?
            </button>
          </div>
        </div>

        {/* USB Phone Camera Setup Guide Panel */}
        {showPhoneHelp && (
          <div className="border border-red-900/80 bg-[#080303] p-3 rounded text-[11px] font-mono text-gray-300 space-y-2.5 text-left animate-fadeIn">
            <div className="flex justify-between items-center border-b border-red-950 pb-1">
              <span className="text-red-400 font-bold tracking-wider">CONNECT ANDROID PHONE CAMERA OVER USB</span>
              <button
                type="button"
                onClick={() => setShowPhoneHelp(false)}
                className="text-gray-500 hover:text-gray-300 text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-[10.5px] leading-relaxed">
              <div className="bg-black/60 p-2 rounded border border-gray-900">
                <span className="text-green-400 font-bold">METHOD 1: Android 14+ Native Webcam (Zero Apps)</span>
                <ol className="list-decimal list-inside text-gray-400 mt-1 space-y-0.5">
                  <li>Plug your Android phone into this laptop via USB cable.</li>
                  <li>Swipe down notifications &rarr; tap <strong className="text-gray-200">"Charging via USB"</strong>.</li>
                  <li>Select <strong className="text-green-400">"Webcam"</strong> mode.</li>
                  <li>Click <strong className="text-red-400">[ ⟳ REFRESH ]</strong> above &rarr; select <strong className="text-gray-200">"Android Webcam"</strong>.</li>
                </ol>
              </div>

              <div className="bg-black/60 p-2 rounded border border-gray-900">
                <span className="text-red-400 font-bold">METHOD 2: DroidCam USB (All Android Versions)</span>
                <ol className="list-decimal list-inside text-gray-400 mt-1 space-y-0.5">
                  <li>Install free <strong className="text-gray-200">DroidCam</strong> on your phone (Play Store) and Windows client.</li>
                  <li>Enable <strong className="text-gray-200">USB Debugging</strong> in phone Developer Options.</li>
                  <li>Connect USB cable, open DroidCam client on Windows, select USB &rarr; click <strong className="text-green-400">Start</strong>.</li>
                  <li>Click <strong className="text-red-400">[ ⟳ REFRESH ]</strong> above &rarr; select <strong className="text-gray-200">"DroidCam Source"</strong>.</li>
                </ol>
              </div>

              <div className="bg-black/60 p-2 rounded border border-gray-900">
                <span className="text-blue-400 font-bold">METHOD 3: Iriun 4K Webcam</span>
                <p className="text-gray-400 mt-0.5">
                  Install <strong className="text-gray-200">Iriun Webcam</strong> app on phone & Windows PC. Connect USB and both pair automatically. Refresh cameras and select <strong className="text-gray-200">"Iriun Webcam"</strong>.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Camera Preview Area */}
      <div
        className="relative w-full aspect-video min-h-[220px] rounded overflow-hidden border bg-black flex items-center justify-center"
        style={{ borderColor: isAuthenticated ? '#00ff41' : isFailed ? '#ff3333' : faceDetected ? '#00ff41' : accent + '99' }}
      >
        {/* Video element — Always mounted; live stream playback */}
        <video
          ref={videoRef}
          className="w-full h-full object-cover transition-opacity duration-200"
          autoPlay
          muted
          playsInline
          onLoadedMetadata={() => {
            setHasActiveStream(true)
            if (videoRef.current) {
              videoRef.current.play().catch(() => {})
              const res = `${videoRef.current.videoWidth || 640}x${videoRef.current.videoHeight || 480}`
              setDiagnostics(prev => ({ ...prev, cameraReady: true, resolution: res, activeTrack: true }))
            }
          }}
          onCanPlay={() => {
            setHasActiveStream(true)
            if (videoRef.current) {
              videoRef.current.play().catch(() => {})
            }
          }}
          onPlaying={() => {
            setHasActiveStream(true)
          }}
          style={{
            opacity: hasActiveStream ? 1 : 0,
            transform: 'scaleX(-1)', // mirror reflection
            filter: 'contrast(1.06) brightness(0.98)',
          }}
        />

        {/* Standby / Permission placeholder overlay — ONLY shown when stream is truly not active */}
        {!hasActiveStream && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10"
            style={{ background: '#070707' }}
          >
            <div
              className="w-16 h-16 rounded-full border-2 flex items-center justify-center"
              style={{ borderColor: accent + '50' }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={accent + '90'} strokeWidth="1.5">
                <path d="M15 10l4.553-2.069A1 1 0 0121 8.87V15.13a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            </div>
            {status === 'requesting' && (
              <div className="text-xs font-mono animate-pulse" style={{ color: accent }}>
                Requesting camera permission...
              </div>
            )}
            {status === 'CAMERA_INITIALIZING' && (
              <div className="text-xs font-mono animate-pulse" style={{ color: accent }}>
                Initializing camera feed...
              </div>
            )}
            {status === 'idle' && (
              <div className="text-[11px] font-mono text-gray-500">
                Click [ OPEN CAMERA ] to start
              </div>
            )}
            {isFailed && (
              <div className="text-[11px] font-mono text-red-500 text-center px-4">
                Camera offline. Click [ RETRY ] to restart camera.
              </div>
            )}
          </div>
        )}

        {/* Verifying With Backend Overlay */}
        {isVerifying && (
          <div className="absolute inset-0 bg-black/75 backdrop-blur-xs flex flex-col items-center justify-center gap-3 z-20">
            <HackerSpinner color="red" />
            <div className="text-xs font-mono text-red-500 font-bold tracking-wider animate-pulse text-center px-4">
              VERIFYING WITH SECURE VAULT BACKEND...
            </div>
            <div className="text-[10px] font-mono text-gray-400">
              Matching 128-D Biometric Template &amp; Nonce
            </div>
          </div>
        )}

        {/* Authenticated Success Overlay */}
        {isAuthenticated && (
          <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-2 z-20 animate-fadeIn">
            <div className="w-12 h-12 rounded-full border-2 border-green-500 flex items-center justify-center text-green-400 text-2xl font-bold">
              ✓
            </div>
            <div className="text-xs font-mono text-green-400 font-bold tracking-widest uppercase">
              BIOMETRIC IDENTITY VERIFIED
            </div>
            <div className="text-[10px] font-mono text-green-600">
              Access Approved &bull; Template Registered
            </div>
          </div>
        )}

        {/* Scanning laser line */}
        {showScanLaser && isScanning && (
          <div
            className="absolute w-full pointer-events-none z-10"
            style={{
              top: `${scanProgress}%`,
              height: '2px',
              background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
              boxShadow: `0 0 12px ${accent}`,
              transition: 'top 0.10s linear',
            }}
          />
        )}

        {/* Face alignment reticle — turns green when face is detected */}
        {hasActiveStream && (
          <div
            className="absolute rounded-full pointer-events-none transition-all duration-300"
            style={{
              inset: '10%',
              border: `2px solid ${isAuthenticated ? '#00ff41' : isFailed ? '#ff3333' : faceDetected ? '#00ff41aa' : accent + '50'}`,
              boxShadow: faceDetected ? '0 0 15px rgba(0,255,65,0.25)' : 'none',
            }}
          />
        )}

        {/* Corner markers */}
        {hasActiveStream && (
          <>
            <div className="absolute top-2 left-2 w-5 h-5 border-t-2 border-l-2 pointer-events-none transition-colors" style={{ borderColor: faceDetected ? '#00ff41' : accent }} />
            <div className="absolute top-2 right-2 w-5 h-5 border-t-2 border-r-2 pointer-events-none transition-colors" style={{ borderColor: faceDetected ? '#00ff41' : accent }} />
            <div className="absolute bottom-2 left-2 w-5 h-5 border-b-2 border-l-2 pointer-events-none transition-colors" style={{ borderColor: faceDetected ? '#00ff41' : accent }} />
            <div className="absolute bottom-2 right-2 w-5 h-5 border-b-2 border-r-2 pointer-events-none transition-colors" style={{ borderColor: faceDetected ? '#00ff41' : accent }} />
          </>
        )}
      </div>

      {/* Hidden canvases for frame capture & preview detection */}
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={previewCanvasRef} className="hidden" />

      {/* Progress bar */}
      {isScanning && (
        <div className="w-full">
          <div className="flex justify-between text-xs font-mono mb-1" style={{ color: accent + 'cc' }}>
            <span>CAPTURING 128-PT BIOMETRIC FRAMES</span>
            <span>{Math.round(scanProgress)}%</span>
          </div>
          <div className="h-1.5 rounded overflow-hidden" style={{ background: accent + '22' }}>
            <div
              className="h-full rounded transition-all duration-100"
              style={{
                width: `${scanProgress}%`,
                background: `linear-gradient(90deg, ${accent}88, ${accent})`,
                boxShadow: `0 0 6px ${accent}`,
              }}
            />
          </div>
        </div>
      )}

      {/* Live status message */}
      <div className="text-xs font-mono flex items-center justify-center gap-2" style={{ color: isFailed ? '#ff4444' : isAuthenticated ? '#00ff41' : faceDetected ? '#00ff41' : accent + 'cc' }}>
        {faceDetected && !isScanning && !isVerifying && !isAuthenticated && (
          <span className="w-2 h-2 rounded-full bg-green-500 animate-ping inline-block" />
        )}
        <span>{statusMsg}</span>
      </div>

      {/* Error banner */}
      {errorMsg && (
        <div
          className="text-xs font-mono border px-3 py-2 rounded text-left space-y-1"
          style={{ color: '#ff6666', borderColor: '#660000', background: '#1a000088' }}
        >
          <div>⚠ {errorMsg}</div>
          {retryCountdown !== null && retryCountdown > 0 && (
            <div className="text-[11px] text-yellow-400 font-bold animate-pulse">
              Cooldown active: Retry enabled in {retryCountdown} seconds...
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        {status === 'idle' && (
          <button
            type="button"
            onClick={() => openCamera()}
            disabled={disabled}
            className="w-full py-2.5 font-mono text-xs rounded font-bold cursor-pointer disabled:opacity-40 transition-colors"
            style={{ border: `1px solid ${accent}`, color: accent, background: accent + '11' }}
          >
            [ OPEN CAMERA ]
          </button>
        )}

        {isReady && !isScanning && !isVerifying && !isAuthenticated && (
          <button
            type="button"
            onClick={startScan}
            disabled={disabled || !hasActiveStream}
            className="w-full py-2.5 font-mono text-xs rounded font-bold cursor-pointer disabled:opacity-40 transition-colors hover:brightness-125"
            style={{
              border: `2px solid ${faceDetected ? '#00ff41' : accent}`,
              color: faceDetected ? '#00ff41' : accent,
              background: (faceDetected ? '#00ff41' : accent) + '22',
            }}
          >
            {faceDetected ? '[ START FACE SCAN (FACE DETECTED ✓) ]' : scanButtonLabel}
          </button>
        )}

        {isScanning && (
          <div
            className="w-full py-2.5 font-mono text-xs text-center opacity-80 animate-pulse"
            style={{ color: accent }}
          >
            ● SCANNING IN PROGRESS — HOLD STILL
          </div>
        )}

        {isVerifying && (
          <div
            className="w-full py-2.5 font-mono text-xs text-center text-red-500 font-bold animate-pulse"
          >
            ⟳ VERIFYING WITH VAULT BACKEND...
          </div>
        )}

        {(isFailed || status === 'done') && (
          <button
            type="button"
            onClick={retry}
            disabled={retryCountdown !== null && retryCountdown > 0}
            className="w-full py-2.5 font-mono text-xs rounded font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-125"
            style={{ border: `2px solid ${accent}`, color: accent, background: accent + '22' }}
          >
            {retryCountdown !== null && retryCountdown > 0
              ? `[ RETRY AVAILABLE IN ${retryCountdown}S ]`
              : '[ RETRY SCAN ]'}
          </button>
        )}
      </div>

      {/* Diagnostics HUD Toggle */}
      <div className="flex justify-between items-center text-[10px] font-mono text-gray-500 pt-1">
        <span>BIOMETRIC STATE: {status.toUpperCase()}</span>
        <button
          type="button"
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          className="text-gray-400 hover:text-red-400 underline cursor-pointer"
        >
          {showDiagnostics ? '[ HIDE DIAGNOSTICS ▲ ]' : '[ SHOW DIAGNOSTICS ▼ ]'}
        </button>
      </div>

      {/* Diagnostics Details Panel */}
      {showDiagnostics && (
        <div className="border border-gray-800 bg-black/90 p-2.5 rounded text-[11px] font-mono text-gray-400 space-y-1">
          <div className="text-red-500 font-bold border-b border-gray-900 pb-1">
            CV &amp; BIOMETRIC DIAGNOSTICS (DEV)
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pt-1">
            <div>Camera Stream: <span className={hasActiveStream ? 'text-green-400' : 'text-red-400'}>{hasActiveStream ? 'ACTIVE' : 'OFFLINE'}</span></div>
            <div>Resolution: <span className="text-gray-300">{diagnostics.resolution}</span></div>
            <div>Face Tracking: <span className={faceDetected ? 'text-green-400' : 'text-yellow-400'}>{diagnostics.trackingStatus}</span></div>
            <div>Confidence: <span className="text-gray-300">{diagnostics.detectionConfidence > 0 ? `${(diagnostics.detectionConfidence * 100).toFixed(0)}%` : 'N/A'}</span></div>
            <div>Movement Score: <span className="text-gray-300">{diagnostics.normalizedMovement.toFixed(4)} (max {diagnostics.movementThreshold})</span></div>
            <div>Liveness Status: <span className={diagnostics.livenessStatus === 'passed' ? 'text-green-400' : diagnostics.livenessStatus === 'failed' ? 'text-red-400' : 'text-gray-400'}>{diagnostics.livenessStatus.toUpperCase()}</span></div>
            <div>Variance Metric: <span className="text-gray-300">{diagnostics.livenessVariance > 0 ? diagnostics.livenessVariance.toFixed(4) : 'N/A'}</span></div>
            <div>128-D Vector Norm: <span className="text-green-400">1.000000</span></div>
          </div>
        </div>
      )}
    </div>
  )
})

export default CameraFaceScanner
