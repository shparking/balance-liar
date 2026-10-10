// 데이터 저장소 추상화: 기본은 Firebase, `?demo` 로 열면 브라우저 메모리(한 기기 미리보기용)
import { ref, set, get, update, onValue, onDisconnect, remove, serverTimestamp } from 'firebase/database'

// 주루마블과 같은 Firebase 프로젝트를 쓰되 데이터 위치만 분리
export const ROOMS = 'blRooms'

export const DEMO = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')

// ---------- 메모리 백엔드 ----------
const mem = { data: {}, subs: new Set() }
const parts = (p) => p.split('/').filter(Boolean)
// 데모 테스트용(&fbarr=1): Firebase 처럼 숫자 키 객체는 배열로, 빈 값은 없애서 돌려줌
const FB_SHAPE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fbarr')
function fbShape(v) {
  if (v == null || typeof v !== 'object') return v
  const entries = Object.entries(v)
    .map(([k, x]) => [k, fbShape(x)])
    .filter(([, x]) => x != null)
  if (!entries.length) return null
  const keys = entries.map(([k]) => k)
  if (keys.every((k) => /^\d+$/.test(k))) {
    const max = Math.max(...keys.map(Number))
    if (max < keys.length * 2) {
      const a = Array.from({ length: max + 1 }, () => undefined)
      entries.forEach(([k, x]) => (a[+k] = x))
      return a
    }
  }
  return Object.fromEntries(entries)
}
function memGet(path) {
  let cur = mem.data
  for (const k of parts(path)) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[k]
  }
  // React가 변경을 감지하도록 항상 새 객체로 복사
  if (cur === undefined) return null
  const copy = JSON.parse(JSON.stringify(cur))
  return FB_SHAPE ? fbShape(copy) ?? null : copy
}
function memSet(path, val) {
  const ps = parts(path)
  if (!ps.length) {
    mem.data = val ?? {}
    return notify()
  }
  let cur = mem.data
  for (const k of ps.slice(0, -1)) {
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}
    cur = cur[k]
  }
  const last = ps[ps.length - 1]
  if (val === null || val === undefined) delete cur[last]
  else cur[last] = JSON.parse(JSON.stringify(val))
  notify()
}
function notify() {
  mem.subs.forEach((cb) => cb())
}

// ---------- 공개 API ----------
let fbDb = null
export function initDb(db) {
  fbDb = db
}

export const now = () => (DEMO ? Date.now() : serverTimestamp())

export async function dbGet(path) {
  if (DEMO) return memGet(path)
  const snap = await get(ref(fbDb, path))
  return snap.exists() ? snap.val() : null
}
export async function dbSet(path, val) {
  if (DEMO) return memSet(path, val)
  return set(ref(fbDb, path), val)
}
export async function dbUpdate(path, updates) {
  if (DEMO) {
    Object.entries(updates).forEach(([k, v]) => memSet(`${path}/${k}`, v))
    return
  }
  return update(ref(fbDb, path), updates)
}
export async function dbRemove(path) {
  if (DEMO) return memSet(path, null)
  return remove(ref(fbDb, path))
}
export function dbOn(path, cb) {
  if (DEMO) {
    const fn = () => cb(memGet(path))
    mem.subs.add(fn)
    fn()
    return () => mem.subs.delete(fn)
  }
  return onValue(ref(fbDb, path), (snap) => cb(snap.exists() ? snap.val() : null))
}
export function dbOnConnected(cb) {
  if (DEMO) {
    cb(true)
    return () => {}
  }
  return onValue(ref(fbDb, '.info/connected'), (snap) => cb(!!snap.val()))
}
// 서버 시간 보정: 폰마다 시계가 조금씩 달라서, 동시에 시작해야 하는 게임(반응속도 등)은 서버 시각 기준으로 맞춤
let serverOffset = 0
export function dbWatchServerOffset() {
  if (DEMO || !fbDb) return () => {}
  return onValue(ref(fbDb, '.info/serverTimeOffset'), (snap) => {
    serverOffset = Number(snap.val()) || 0
  })
}
export const serverNow = () => Date.now() + serverOffset

export function dbPresence(path) {
  if (DEMO) return memSet(path, true)
  const r = ref(fbDb, path)
  set(r, true)
  onDisconnect(r).set(false)
}

// 데모용: 가짜 참가자 추가
export function demoSeed(code, names, colors) {
  if (!DEMO) return
  names.forEach((n, i) => memSet(`${ROOMS}/${code}/players/demo${i}`, { name: n, color: colors[(i + 1) % colors.length], drinks: 0, joinedAt: Date.now() }))
}

// 방 정리 (방 만들 때 / 앱 열 때 호출) — 인덱스 없이 방 전체를 읽어 판단
//  - 참가자가 없거나, 모두 접속이 끊긴 채 10분 넘게 활동이 없는 방 삭제
//  - 1시간 동안 아무 활동이 없는 방 삭제
//  - 만든 지 24시간 지난 방 삭제
export const IDLE_TTL_MS = 60 * 60 * 1000
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000
export const EMPTY_TTL_MS = 10 * 60 * 1000
export function shouldPurge(r, nowMs) {
  if (!r || typeof r !== 'object') return true
  const created = typeof r.createdAt === 'number' ? r.createdAt : 0
  const players = Object.values(r.players || {}).filter((p) => p && p.name)
  const lastActive = typeof r.lastActive === 'number' ? r.lastActive : created
  if (players.length === 0) return true
  if (players.every((p) => p.online === false) && lastActive <= nowMs - EMPTY_TTL_MS) return true
  if (lastActive <= nowMs - IDLE_TTL_MS) return true
  if (created <= nowMs - ROOM_TTL_MS) return true
  return false
}
export async function dbPurgeOldRooms() {
  if (DEMO) return 0
  const snap = await get(ref(fbDb, ROOMS))
  if (!snap.exists()) return 0
  const nowMs = Date.now()
  const updates = {}
  snap.forEach((child) => {
    if (shouldPurge(child.val(), nowMs)) updates[child.key] = null
  })
  if (!Object.keys(updates).length) return 0
  await update(ref(fbDb, ROOMS), updates)
  return Object.keys(updates).length
}
// 홈 화면 방 목록 구독 (방 전체 → 요약)
export function dbOnRooms(cb) {
  if (DEMO) {
    const fn = () => cb(memGet(ROOMS) || {})
    mem.subs.add(fn)
    fn()
    return () => mem.subs.delete(fn)
  }
  return onValue(ref(fbDb, ROOMS), (snap) => cb(snap.exists() ? snap.val() : {}))
}
