type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

interface PwaInstallState {
  installed: boolean
  promptAvailable: boolean
}

type InstallListener = (state: PwaInstallState) => void

let initialized = false
let deferredPrompt: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<InstallListener>()

function isStandalone() {
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

function getState(): PwaInstallState {
  return {
    installed,
    promptAvailable: deferredPrompt !== null,
  }
}

function emit() {
  const state = getState()
  for (const listener of listeners) {
    listener(state)
  }
}

export function initializePwaInstall() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  installed = isStandalone()

  const displayMode = window.matchMedia('(display-mode: standalone)')
  const updateInstalled = () => {
    installed = isStandalone()
    emit()
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    emit()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    installed = true
    emit()
  })

  if (typeof displayMode.addEventListener === 'function') {
    displayMode.addEventListener('change', updateInstalled)
  } else {
    displayMode.addListener(updateInstalled)
  }
}

export function subscribePwaInstall(listener: InstallListener) {
  initializePwaInstall()
  listeners.add(listener)
  listener(getState())

  return () => {
    listeners.delete(listener)
  }
}

export async function promptPwaInstall() {
  if (!deferredPrompt) return 'unavailable'

  const prompt = deferredPrompt
  deferredPrompt = null
  emit()
  await prompt.prompt()
  const choice = await prompt.userChoice

  if (choice.outcome === 'accepted') {
    installed = true
    emit()
  }

  return choice.outcome
}
