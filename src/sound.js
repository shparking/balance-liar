// 효과음 (Web Audio, 파일 없이 합성). 마음에 안 들면 SOUND_ENABLED 를 false 로 바꾸면 전부 꺼짐.
export const SOUND_ENABLED = false

let ctx = null
function getCtx() {
  if (!SOUND_ENABLED || typeof window === 'undefined') return null
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  if (!ctx) ctx = new AC()
  return ctx
}

// 모바일은 사용자 터치 뒤에만 소리가 나므로, 첫 터치에서 오디오를 깨워둔다
export function unlockAudio() {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') c.resume().catch(() => {})
  // 무음 버퍼를 한 번 재생해 iOS 잠금 해제
  try {
    const buf = c.createBuffer(1, 1, 22050)
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(c.destination)
    src.start(0)
  } catch {}
}
if (typeof window !== 'undefined') {
  const once = () => {
    unlockAudio()
    window.removeEventListener('pointerdown', once)
    window.removeEventListener('touchstart', once)
    window.removeEventListener('keydown', once)
  }
  window.addEventListener('pointerdown', once)
  window.addEventListener('touchstart', once)
  window.addEventListener('keydown', once)
}

function tone(freq, dur, { type = 'sine', gain = 0.25, at = 0, slideTo } = {}) {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') c.resume().catch(() => {})
  const t0 = c.currentTime + at
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g)
  g.connect(c.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.02)
}

// 카운트다운 "삐" (3, 2, 1) — 마지막(1)은 조금 높게
export function beep(step) {
  tone(step === 1 ? 1320 : 880, 0.12, { type: 'square', gain: 0.18 })
}
// 공개/시작 "띵~"
export function ding() {
  tone(880, 0.35, { gain: 0.22 })
  tone(1320, 0.5, { gain: 0.18, at: 0.08 })
}
// 폭탄 폭발: 낮은 굉음 + 노이즈
export function boom() {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') c.resume().catch(() => {})
  const t0 = c.currentTime
  // 낮은 톤이 뚝 떨어지는 소리
  tone(180, 0.8, { type: 'sawtooth', gain: 0.5, slideTo: 40 })
  tone(90, 1.0, { type: 'triangle', gain: 0.5, slideTo: 30, at: 0.02 })
  // 노이즈 버스트
  try {
    const len = Math.floor(c.sampleRate * 0.9)
    const buf = c.createBuffer(1, len, c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
    const src = c.createBufferSource()
    src.buffer = buf
    const g = c.createGain()
    g.gain.setValueAtTime(0.6, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9)
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(1200, t0)
    lp.frequency.exponentialRampToValueAtTime(120, t0 + 0.8)
    src.connect(lp)
    lp.connect(g)
    g.connect(c.destination)
    src.start(t0)
  } catch {}
}
// 폭탄 째깍 (틱)
export function tick() {
  tone(2000, 0.03, { type: 'square', gain: 0.06 })
}
