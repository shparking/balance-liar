// Firebase Realtime Database 방 로직 (밸런스 & 라이어)
// blRooms/{CODE} = {
//   hostId, hostName, pw?, createdAt, lastActive,
//   players/{pid}: { name, color, drinks, online, joinedAt },
//   order: [pid...]            // 들어온 순서 (라이어 설명 순서의 기준)
//   round: null | { id, kind: 'balance' | 'liar', stage, ... }   // 진행 중인 판. 없으면 게임 메뉴
//   roundNo, usedTopics, liarTurn, event: { id, text }, log/{id}: { t, text }, kicked/{pid}
// }
// 진행(게임 고르기·결과 공개·다음 판)은 방장이 하고, 투표·키워드 확인은 각자 자기 폰에서 해요.
import { dbGet, dbSet, dbUpdate, dbRemove, dbOn, dbOnConnected, dbPresence, now, DEMO, demoSeed, dbPurgeOldRooms, dbWatchServerOffset, serverNow, dbOnRooms, shouldPurge, ROOMS } from './db'
import './firebase'
import { BALANCE_TOPICS } from './game/balance'
import { pickLiarWords, liarCategory } from './game/liar'

export const COLORS = ['#ea002c', '#2f6df6', '#1fa97a', '#f59e0b', '#8b5cf6', '#ec4899', '#0ea5e9', '#84cc16', '#14b8a6', '#f97316', '#6366f1', '#d946ef']

// ---------- 내 아이디 (기기별 고정) ----------
export function myId() {
  // 테스트용: ?pid=abc 로 열면 그 탭은 별도 참가자로 취급 (같은 브라우저에서 2인 테스트)
  const q = new URLSearchParams(window.location.search).get('pid')
  if (q) return 'p_' + q.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20)
  try {
    let id = localStorage.getItem('pid')
    if (!id) {
      id = 'p_' + Math.random().toString(36).slice(2, 10)
      localStorage.setItem('pid', id)
    }
    return id
  } catch {
    return 'p_' + Math.random().toString(36).slice(2, 10)
  }
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function randomCode() {
  let s = ''
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return s
}
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
const roomPath = (code) => `${ROOMS}/${code}`
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// 방 상태 갱신 + event 가 있으면 게임 로그(log/{id})에도 같이 기록
export const LOG_MAX = 80
function roomUpdate(code, updates) {
  updates.lastActive = Date.now()
  const ev = updates.event
  if (ev && ev.id && ev.text) updates[`log/${ev.id}`] = { t: Date.now(), text: String(ev.text).replace(/\n/g, ' ') }
  return dbUpdate(roomPath(code), updates)
}
export function roomLog(room) {
  return Object.entries(room?.log || {})
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => b.t - a.t)
}
export async function trimLog(code, room) {
  if (room.hostId !== myId()) return
  const all = roomLog(room)
  if (all.length <= LOG_MAX) return
  const upd = {}
  all.slice(LOG_MAX).forEach((e) => (upd[`log/${e.id}`] = null))
  await dbUpdate(roomPath(code), upd)
}

// 진행 권한: 방장 (데모에서는 한 기기로 전부)
export function canControl(room) {
  return DEMO || room?.hostId === myId()
}
// 참가자 (들어온 순서)
export function playerIds(room) {
  const ids = Object.keys(room?.players || {}).filter((id) => room.players[id]?.name)
  const set = (room?.order || []).filter((id) => ids.includes(id))
  return [...set, ...ids.filter((id) => !set.includes(id))]
}
function addDrinks(room, upd, ids, n = 1) {
  ;(ids || []).forEach((pid) => {
    if (!room.players?.[pid]) return
    upd[`players/${pid}/drinks`] = (room.players[pid].drinks || 0) + n
  })
  return upd
}
const names = (room, ids) => ids.map((x) => room.players?.[x]?.name).filter(Boolean).join(', ')

// ---------- 방 만들기 / 입장 ----------
export function purgeRooms() {
  return dbPurgeOldRooms().catch(() => 0)
}

export async function createRoom(name, password = '') {
  const id = myId()
  purgeRooms()
  let code = randomCode()
  for (let tries = 0; tries < 5; tries++) {
    if ((await dbGet(roomPath(code))) == null) break
    code = randomCode()
  }
  const pw = String(password || '').trim()
  await dbSet(roomPath(code), {
    hostId: id,
    hostName: name,
    createdAt: now(),
    lastActive: Date.now(),
    ...(pw ? { pw } : {}),
    players: { [id]: { name, color: COLORS[0], drinks: 0, joinedAt: now() } },
    order: [id],
  })
  if (DEMO) {
    demoSeed(code, ['관희', '윤정', '민수'], COLORS)
    await dbUpdate(roomPath(code), { order: [id, 'demo0', 'demo1', 'demo2'] })
  }
  return code
}

export async function joinRoom(code, name, password = '') {
  code = code.trim().toUpperCase()
  const room = await dbGet(roomPath(code))
  if (room == null) throw new Error('그런 방이 없어요. 다시 확인해주세요.')
  const id = myId()
  const players = room.players || {}
  if (room.kicked?.[id]) throw new Error('방장이 이 방에서 내보낸 참가자예요.')
  if (!players[id]?.name) {
    if (room.pw && room.pw !== String(password || '').trim()) {
      const err = new Error(password ? '비밀번호가 틀렸어요.' : '비밀번호가 필요한 방이에요.')
      err.needPassword = true
      throw err
    }
    if (Object.keys(players).length >= 16) throw new Error('방이 가득 찼어요 (최대 16명).')
    const used = new Set(Object.values(players).map((p) => p.color))
    const color = COLORS.find((c) => !used.has(c)) || COLORS[Object.keys(players).length % COLORS.length]
    await roomUpdate(code, {
      [`players/${id}`]: { name, color, drinks: 0, joinedAt: now() },
      order: [...playerIds(room), id],
      event: { id: newId(), text: `👋 ${name} 님이 들어왔어요${room.round ? ' (이번 판이 끝나면 같이 해요)' : ''}` },
    })
  } else if (players[id].name !== name) {
    await dbUpdate(`${roomPath(code)}/players/${id}`, { name })
  }
  return code
}

export async function leaveRoom(code) {
  const id = myId()
  const room = await dbGet(roomPath(code))
  if (room == null) return
  const rest = playerIds(room).filter((p) => p !== id)
  if (rest.length === 0) {
    await dbRemove(roomPath(code))
    return
  }
  const upd = { [`players/${id}`]: null, order: rest, event: { id: newId(), text: `👋 ${room.players[id]?.name} 님이 나갔어요` } }
  if (room.hostId === id) {
    // 방장 자동 위임: 접속 중인 사람 우선
    const next = rest.find((p) => room.players[p]?.online !== false) || rest[0]
    upd.hostId = next
    upd.event = { id: newId(), text: `👑 ${room.players[id]?.name}이(가) 나가서 ${room.players[next]?.name}이(가) 방장이 됐어요` }
  }
  await roomUpdate(code, upd)
}

export async function transferHost(code, room, toId) {
  if (room.hostId !== myId() || !room.players?.[toId]?.name || toId === room.hostId) return
  await roomUpdate(code, { hostId: toId, event: { id: newId(), text: `👑 ${room.players[toId].name}이(가) 새 방장이 됐어요` } })
}

// 방장: 참가자 내보내기 (다시 못 들어옴)
export async function kickPlayer(code, room, playerId) {
  if (room.hostId !== myId() || playerId === myId() || !room.players?.[playerId]) return
  await roomUpdate(code, {
    [`players/${playerId}`]: null,
    [`kicked/${playerId}`]: true,
    order: playerIds(room).filter((p) => p !== playerId),
    event: { id: newId(), text: `${room.players[playerId].name} 님이 방에서 나갔어요 (방장 강퇴)` },
  })
}

export function removeRoom(code) {
  return dbRemove(roomPath(code)).catch(() => {})
}
export function subscribeRoom(code, cb) {
  return dbOn(roomPath(code), cb)
}
export function watchServerOffset() {
  return dbWatchServerOffset()
}
export { serverNow }
export function subscribeConnection(cb) {
  return dbOnConnected(cb)
}
export function setupPresence(code) {
  dbPresence(`${roomPath(code)}/players/${myId()}/online`)
}

// 방장: 진행 중인 판 그만두고 게임 메뉴로
export async function backToMenu(code, room) {
  if (!canControl(room) || !room.round) return
  await roomUpdate(code, { round: null, event: { id: newId(), text: '🏠 게임 메뉴로 돌아왔어요' } })
}

// 방장: 잔 수 초기화
export async function resetDrinks(code, room) {
  if (!canControl(room)) return
  const upd = { event: { id: newId(), text: '🍺 잔 수를 모두 0으로 초기화했어요' } }
  playerIds(room).forEach((pid) => (upd[`players/${pid}/drinks`] = 0))
  await roomUpdate(code, upd)
}

// ======================================================================
// 밸런스 게임: 주제 A vs B → 각자 투표 → 결과 공개
//   소수 의견이 마심 / 동점이면 다른 주제로 재투표 / 만장일치면 룰렛(50%: 다 같이 마셔, 아무도 안 마셔)
// ======================================================================
export function pickTopic(room) {
  const used = room.usedTopics || []
  let pool = BALANCE_TOPICS.map((_, i) => i).filter((i) => !used.includes(i))
  if (!pool.length) pool = BALANCE_TOPICS.map((_, i) => i)
  return pool[Math.floor(Math.random() * pool.length)]
}
function withTopic(room, topic, upd) {
  const used = room.usedTopics || []
  upd.usedTopics = used.length >= BALANCE_TOPICS.length - 1 ? [topic] : [...used, topic]
  return upd
}
function newBalanceRound(room, extra = {}) {
  return { id: newId(), kind: 'balance', topic: pickTopic(room), stage: 'vote', round: 1, startedAt: Date.now(), ...extra }
}

export async function startBalance(code, room) {
  if (!canControl(room)) return
  const round = newBalanceRound(room)
  await roomUpdate(code, withTopic(room, round.topic, { round, roundNo: (room.roundNo || 0) + 1, event: { id: newId(), text: '⚖️ 밸런스 게임 시작!' } }))
}

// 투표 (본인 표만, 데모에서는 아직 안 한 사람 차례로)
export async function balanceVote(code, room, choice) {
  const p = room.round
  if (!p || p.kind !== 'balance' || p.stage !== 'vote' || !['A', 'B'].includes(choice)) return
  const ids = playerIds(room)
  const id = DEMO ? ids.find((pid) => !p.votes?.[pid]) || ids[0] : myId()
  if (!id || !ids.includes(id)) return
  await roomUpdate(code, { [`round/votes/${id}`]: choice })
}

export function balanceResult(p) {
  const votes = p?.votes || {}
  const A = Object.keys(votes).filter((k) => votes[k] === 'A')
  const B = Object.keys(votes).filter((k) => votes[k] === 'B')
  const total = A.length + B.length
  const tie = total > 0 && A.length === B.length
  const unanimous = total > 0 && (A.length === 0 || B.length === 0)
  const losers = tie || unanimous ? [] : A.length < B.length ? A : B
  return { a: A.length, b: B.length, A, B, total, tie, unanimous, losers }
}

// 방장: 결과 공개 (동점 / 만장일치 룰렛 / 소수 마셔)
export async function balanceReveal(code, room) {
  const p = room.round
  if (!canControl(room) || !p || p.kind !== 'balance' || p.stage !== 'vote') return
  const r = balanceResult(p)
  if (r.total === 0) return
  if (r.tie) await roomUpdate(code, { 'round/stage': 'tie', 'round/revealedAt': Date.now() })
  else if (r.unanimous) await roomUpdate(code, { 'round/stage': 'roulette', 'round/revealedAt': Date.now(), 'round/roulette': Math.random() < 0.5 ? 'drink' : 'safe' })
  else await roomUpdate(code, { 'round/stage': 'result', 'round/revealedAt': Date.now() })
}

// 방장: 다른 주제로 (투표 중 바꾸기 / 동점 재투표)
export async function balanceReroll(code, room) {
  const p = room.round
  if (!canControl(room) || !p || p.kind !== 'balance' || !['vote', 'tie'].includes(p.stage)) return
  const topic = pickTopic(room)
  const round = { ...p, topic, stage: 'vote', votes: null, round: (p.round || 1) + 1, revealedAt: null, roulette: null }
  await roomUpdate(code, withTopic(room, topic, { round }))
}

// 방장: 결과 확정 → 잔 수 기록 → 한 판 더(again) 또는 메뉴로(menu)
export async function balanceFinish(code, room, next = 'menu') {
  const p = room.round
  if (!canControl(room) || !p || p.kind !== 'balance' || !['result', 'roulette'].includes(p.stage)) return
  const [ta, tb] = (BALANCE_TOPICS[p.topic] || ' vs ').split(' vs ')
  const r = balanceResult(p)
  const upd = {}
  if (p.stage === 'roulette') {
    upd.event = { id: newId(), text: `⚖️ ${ta} ${r.a} : ${r.b} ${tb} 만장일치 → 룰렛 ${p.roulette === 'drink' ? '다 같이 마셔! 🍻' : '아무도 안 마셔 😇'}` }
    if (p.roulette === 'drink') addDrinks(room, upd, playerIds(room))
  } else {
    upd.event = { id: newId(), text: `⚖️ ${ta} ${r.a} : ${r.b} ${tb} → 소수 ${names(room, r.losers)} 마셔! 🍶` }
    addDrinks(room, upd, r.losers)
  }
  if (next === 'again') {
    const round = newBalanceRound(room)
    upd.round = round
    upd.roundNo = (room.roundNo || 0) + 1
    withTopic(room, round.topic, upd)
  } else upd.round = null
  await roomUpdate(code, upd)
}

// ======================================================================
// 라이어 게임 (워드 울프): 카테고리 → 한 명만 비슷한 다른 키워드 → 각자 확인 → 돌아가며 설명
//   → 투표 → 3·2·1 → 결과 (라이어를 맞힌 사람은 안 마시고, 못 맞힌 사람은 마심)
// ======================================================================
export async function startLiar(code, room) {
  if (!canControl(room)) return
  await roomUpdate(code, {
    round: { id: newId(), kind: 'liar', stage: 'category', startedAt: Date.now() },
    roundNo: (room.roundNo || 0) + 1,
    event: { id: newId(), text: '🤥 라이어 게임 시작! 방장이 카테고리를 골라요' },
  })
}

// 방장: 카테고리 고르기 → 지금 방에 있는 사람들에게 키워드 배정 (설명 순서는 판마다 한 칸씩 돌아감)
function liarDealUpdates(room, key) {
  const ids = playerIds(room)
  const liar = ids[Math.floor(Math.random() * ids.length)]
  const [majority, minority] = pickLiarWords(key)
  const words = {}
  ids.forEach((pid) => (words[pid] = pid === liar ? minority : majority))
  const turn = (room.liarTurn || 0) % Math.max(1, ids.length)
  const speakers = [...ids.slice(turn), ...ids.slice(0, turn)]
  return {
    round: { id: newId(), kind: 'liar', stage: 'reveal', category: key, liar, words, majority, minority, speakers, startedAt: Date.now() },
    liarTurn: (room.liarTurn || 0) + 1,
  }
}
export async function liarChooseCategory(code, room, key) {
  const p = room.round
  if (!canControl(room) || !p || p.kind !== 'liar' || p.stage !== 'category' || !key) return
  await roomUpdate(code, { ...liarDealUpdates(room, key), event: { id: newId(), text: `🤥 ${liarCategory(key).emoji} ${liarCategory(key).name} — 각자 키워드를 확인하세요` } })
}

// 내 키워드를 확인했다고 표시 (데모에서는 모두)
export async function liarReveal(code, room) {
  const p = room.round
  if (!p || p.kind !== 'liar' || p.stage !== 'reveal') return
  if (DEMO) {
    const upd = {}
    Object.keys(p.words || {}).forEach((pid) => (upd[`round/revealed/${pid}`] = true))
    return roomUpdate(code, upd)
  }
  const id = myId()
  if (!p.words?.[id]) return
  await roomUpdate(code, { [`round/revealed/${id}`]: true })
}

// 방장: 설명 끝 → 투표 시작
export async function liarStartVote(code, room) {
  const p = room.round
  if (!canControl(room) || !p || p.kind !== 'liar' || p.stage !== 'reveal') return
  await roomUpdate(code, { 'round/stage': 'vote', event: { id: newId(), text: '🗳️ 투표 시간! 라이어 같은 사람을 고르세요' } })
}

// 투표 (이번 판 참가자만, 본인 표만)
export async function liarVote(code, room, target) {
  const p = room.round
  if (!p || p.kind !== 'liar' || p.stage !== 'vote' || !target) return
  const id = DEMO ? Object.keys(p.words || {}).find((pid) => !p.votes?.[pid]) : myId()
  if (!id || !p.words?.[id] || !p.words?.[target]) return
  await roomUpdate(code, { [`round/votes/${id}`]: target })
}

// 방장: 결과 공개
export async function liarShowResult(code, room) {
  const p = room.round
  if (!canControl(room) || !p || p.kind !== 'liar' || p.stage !== 'vote') return
  await roomUpdate(code, { 'round/stage': 'result', 'round/revealedAt': Date.now() })
}

export function liarResult(room, p) {
  const tally = {}
  Object.values(p.votes || {}).forEach((t) => (tally[t] = (tally[t] || 0) + 1))
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  const unique = top && (!sorted[1] || sorted[1][1] < top[1])
  const caught = !!(unique && top[0] === p.liar)
  // 라이어를 찍은 사람은 안 마시고, 못 찍은 사람(라이어 본인·기권 포함)은 마심
  const voters = Object.keys(p.words || {}).filter((pid) => room.players?.[pid]?.name)
  const right = voters.filter((pid) => p.votes?.[pid] === p.liar)
  const wrong = voters.filter((pid) => p.votes?.[pid] !== p.liar)
  return { tally, top: top?.[0] || null, tie: !!(top && !unique), caught, right, wrong }
}

// 방장: 결과 확정 → 잔 수 기록 → same(같은 카테고리로 한 판 더) / again(카테고리 다시 고르기) / menu
export async function liarFinish(code, room, next = 'menu') {
  const p = room.round
  if (!canControl(room) || !p || p.kind !== 'liar' || p.stage !== 'result') return
  const r = liarResult(room, p)
  const cat = liarCategory(p.category)
  const upd = {
    event: {
      id: newId(),
      text: `🤥 ${cat.emoji}${cat.name} — 다른 키워드는 ${room.players[p.liar]?.name || '?'} · 맞힘 ${names(room, r.right) || '없음'} · ${r.wrong.length ? `틀린 ${names(room, r.wrong)} 마셔 🍶` : '모두 맞혔어요 😇'}`,
    },
  }
  addDrinks(room, upd, r.wrong)
  if (next === 'same') Object.assign(upd, liarDealUpdates(room, p.category), { roundNo: (room.roundNo || 0) + 1 })
  else if (next === 'again') Object.assign(upd, { round: { id: newId(), kind: 'liar', stage: 'category', startedAt: Date.now() }, roundNo: (room.roundNo || 0) + 1 })
  else upd.round = null
  await roomUpdate(code, upd)
}

// ---------- 홈 화면 방 목록 ----------
export function subscribeRoomList(cb) {
  return dbOnRooms((all) => {
    const nowMs = Date.now()
    const list = Object.entries(all || {})
      .filter(([, r]) => r && typeof r === 'object' && !shouldPurge(r, nowMs))
      .map(([code, r]) => {
        const players = Object.values(r.players || {}).filter((p) => p && p.name)
        return {
          code,
          hostName: r.hostName || r.players?.[r.hostId]?.name || '',
          count: players.length,
          online: players.filter((p) => p.online !== false).length,
          locked: !!r.pw,
          game: r.round?.kind || null,
          createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
          members: Object.keys(r.players || {}),
        }
      })
      .sort((a, b) => b.createdAt - a.createdAt)
    cb(list)
  })
}
