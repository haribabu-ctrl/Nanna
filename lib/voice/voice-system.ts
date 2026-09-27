// Voice announcements using Web Speech API (browser speech synthesis)
// All audio is generated locally — no private data is sent to external services.

export type VoiceMessage =
  | 'welcome'
  | 'init_auth'
  | 'lock_1_start'
  | 'lock_2_start'
  | 'lock_3_start'
  | 'lock_4_start'
  | 'lock_5_start'
  | 'lock_6_start'
  | 'lock_passed'
  | 'access_denied_1'
  | 'access_denied_2'
  | 'access_denied_3'
  | 'access_denied_4'
  | 'vault_unlocked'
  | 'uploading'
  | 'upload_complete'
  | 'deleting'
  | 'downloading'
  | 'logout'
  | 'warning_too_many'

const VOICE_SCRIPTS: Record<VoiceMessage, string> = {
  welcome: 'Welcome to our private world, Hari. Initializing six-layer authentication.',
  init_auth: 'Six-layer authentication initiated. Please proceed.',
  lock_1_start: 'Lock one. Identity verification required. Please look at the camera.',
  lock_2_start: 'Lock two. Enter your six-digit secret pin.',
  lock_3_start: 'Lock three. Enter your secret identity phrase.',
  lock_4_start: 'Lock four. Enter your four-digit secret code.',
  lock_5_start: 'Lock five. Voice print authentication. Please speak clearly.',
  lock_6_start: 'Lock six. Final biometric authorization required.',
  lock_passed: 'Verification successful. Proceeding to next layer.',
  access_denied_1: 'Are you Hari, really?',
  access_denied_2: 'Unauthorized identity detected.',
  access_denied_3: 'Verification failed. Access denied.',
  access_denied_4: 'Warning. Invalid credentials.',
  vault_unlocked: 'Identity confirmed. Vault access granted. Welcome, Hari.',
  uploading: 'Uploading your memories to the private vault.',
  upload_complete: 'Your memory has been securely stored.',
  deleting: 'Confirm permanent deletion.',
  downloading: 'Preparing your private download.',
  logout: 'Vault session terminated. Goodbye.',
  warning_too_many: 'Maximum attempts exceeded. Authentication sequence terminated. Please restart.',
}

class VoiceSystem {
  private enabled: boolean = true
  private synth: SpeechSynthesis | null = null
  private currentUtterance: SpeechSynthesisUtterance | null = null

  constructor() {
    if (typeof window !== 'undefined') {
      this.synth = window.speechSynthesis
      // Load preference from localStorage
      const saved = localStorage.getItem('vault_sound_enabled')
      this.enabled = saved !== 'false'
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (typeof window !== 'undefined') {
      localStorage.setItem('vault_sound_enabled', String(enabled))
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  speak(message: VoiceMessage, options?: { rate?: number; pitch?: number; volume?: number }): Promise<void> {
    return new Promise((resolve) => {
      if (!this.enabled || !this.synth) {
        resolve()
        return
      }

      // Cancel any ongoing speech
      this.synth.cancel()

      const text = VOICE_SCRIPTS[message]
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = options?.rate ?? 0.85
      utterance.pitch = options?.pitch ?? 0.5
      utterance.volume = options?.volume ?? 0.9

      // Try to use a deep/robotic voice if available
      const voices = this.synth.getVoices()
      const preferred = voices.find(v =>
        v.name.toLowerCase().includes('male') ||
        v.name.toLowerCase().includes('david') ||
        v.name.toLowerCase().includes('daniel') ||
        v.name.toLowerCase().includes('uk english male')
      )
      if (preferred) utterance.voice = preferred

      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()

      this.currentUtterance = utterance
      this.synth.speak(utterance)
    })
  }

  stop(): void {
    this.synth?.cancel()
  }

  replay(message: VoiceMessage): void {
    this.speak(message)
  }
}

// Singleton instance
let voiceSystemInstance: VoiceSystem | null = null

export function getVoiceSystem(): VoiceSystem {
  if (!voiceSystemInstance) {
    voiceSystemInstance = new VoiceSystem()
  }
  return voiceSystemInstance
}
