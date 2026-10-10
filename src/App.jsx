import { useEffect, useRef, useState } from 'react'
import { DEMO, IDLE_TTL_MS } from './db'
import {
  myId,
  createRoom,
  joinRoom,
  leaveRoom,
  subscribeRoom,
  subscribeConnection,
  setupPresence,
  watchServerOffset,
  purgeRooms,
  removeRoom,
  subscribeRoomList,
  roomLog,
  trimLog,
  canControl,
  playerIds,
  transferHost,
  kickPlayer,
  backToMenu,
  resetDrinks,
  startBalance,
  balanceVote,
  balanceResult,
  balanceReveal,
  balanceReroll,
  balanceFinish,
  startLiar,
  liarChooseCategory,
  liarReveal,
  liarStartVote,
  liarVote,
  liarShowResult,
  liarResult,
  liarFinish,
} from './room'
import { BALANCE_TOPICS } from './game/balance'
import { LIAR_CATEGORIES, liarCategory } from './game/liar'
import { beep, ding } from './sound'

const APP_NAME = '밸런스 & 라이어'

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch {}
    // 기본은 밤 파티 테마(어두운 화면). 밝은 화면은 상단 버튼으로
    return 'dark'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('theme', theme)
    } catch {}
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

function Icon({ name }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...common}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )
    case 'log':
      return (
        <svg {...common}>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      )
    case 'exit':
      return (
        <svg {...common}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      )
    default:
      return null
  }
}

// 투표 완료 판정: 접속이 끊긴 사람은 빼고 모두 투표했는지
function allVoted(room, ids, votes) {
  const active = ids.filter((pid) => room.players[pid]?.online !== false)
  return active.length > 0 && active.every((pid) => votes[pid] != null)
}

// 3, 2, 1 카운트다운 (key 가 바뀌면 다시 시작)
function useCountdown(key) {
  const [step, setStep] = useState(3)
  useEffect(() => {
    setStep(3)
    const t1 = setTimeout(() => setStep(2), 1000)
    const t2 = setTimeout(() => setStep(1), 2000)
    const t3 = setTimeout(() => setStep(0), 3000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [key])
  useEffect(() => {
    if (step > 0) beep(step)
    if (step === 0) {
      ding()
      try {
        navigator.vibrate?.([80, 40, 80, 40, 200])
      } catch {}
    }
  }, [step])
  return step
}

function CountOverlay({ step, emoji, sub }) {
  return (
    <div className="ai-overlay">
      <div className="ai-count" key={step}>
        <div className="ai-robot">{emoji}</div>
        <div className="ai-num">{step}</div>
        <div className="ai-sub">{sub}</div>
      </div>
    </div>
  )
}

function Confetti({ n = 28 }) {
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <i key={i} style={{ '--i': i, left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 0.12}s`, background: ['#ea002c', '#f47725', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff'][i % 6] }} />
      ))}
    </div>
  )
}

// 방장만 버튼, 나머지는 기다림 문구
function HostActions({ ctl, waiting, children, overlay, wrap }) {
  return <div className={`${overlay ? 'ai-actions' : 'actions'} ${wrap && ctl ? 'wrap' : ''}`}>{ctl ? children : <div className="waiting">{waiting}</div>}</div>
}

// 마시는 사람 공개 화면 (컨페티)
function DrinkOverlay({ room, targets, note, title = '🎉 Congratulations! 🎉', ctl, waiting, children }) {
  const names = targets.map((t) => room.players[t]?.name).filter(Boolean)
  return (
    <div className="ai-overlay">
      <div className="ai-reveal">
        <Confetti />
        <div className="ai-congrats">{title}</div>
        <div className="ai-avatars">
          {targets.map((t) => (
            <div key={t} className="ai-avatar" style={{ background: room.players[t]?.color }}>
              {room.players[t]?.name?.slice(0, 1)}
            </div>
          ))}
        </div>
        {note && <div className="ai-note">{note}</div>}
        <div className="ai-name">
          <b>{names.length ? names.join(', ') : '—'}</b> 마셔! 🍶
        </div>
        <HostActions ctl={ctl} waiting={waiting} overlay>
          {children}
        </HostActions>
      </div>
    </div>
  )
}

// 만장일치 룰렛: 50/50
function RouletteOverlay({ revealKey, title, note, options, pick, resultText, ctl, waiting, children }) {
  const [spun, setSpun] = useState(false)
  const [done, setDone] = useState(false)
  useEffect(() => {
    setSpun(false)
    setDone(false)
    const t1 = setTimeout(() => setSpun(true), 100)
    const t2 = setTimeout(() => setDone(true), 3400)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [revealKey])
  useEffect(() => {
    if (done) {
      ding()
      try {
        navigator.vibrate?.([80, 40, 80, 40, 200])
      } catch {}
    }
  }, [done])
  // 바늘은 위(0deg). options[0] 은 오른쪽 반, options[1] 은 왼쪽 반
  const finalDeg = 360 * 5 + (pick === 0 ? 270 : 90)
  return (
    <div className="ai-overlay">
      <div className="ai-reveal">
        {done && <Confetti />}
        <div className="ai-congrats">{title}</div>
        {note && <div className="ai-note">{note}</div>}
        <div className="roulette">
          <div className="needle" />
          <div className="wheel" style={{ transform: spun ? `rotate(${finalDeg}deg)` : 'rotate(0deg)', background: `conic-gradient(${options[0].color} 0deg 180deg, ${options[1].color} 180deg 360deg)` }}>
            <span className="half drink">{options[0].emoji}</span>
            <span className="half safe">{options[1].emoji}</span>
          </div>
        </div>
        <div className="roulette-legend">
          {options.map((o, i) => (
            <span key={i}>
              <i className="sw" style={{ background: o.color }} /> {o.label}
            </span>
          ))}
        </div>
        <div className="ai-name">{done ? <b>{resultText}</b> : <span className="muted-light">돌아가는 중…</span>}</div>
        {done && (
          <HostActions ctl={ctl} waiting={waiting} overlay>
            {children}
          </HostActions>
        )}
      </div>
    </div>
  )
}

// ======================================================================
// 밸런스 게임
// ======================================================================
function BalanceRound({ room, me, code, ctl, act }) {
  const p = room.round
  const ids = playerIds(room)
  const [ta, tb] = (BALANCE_TOPICS[p.topic] || ' vs ').split(' vs ')
  const votes = p.votes || {}
  const votedCount = ids.filter((pid) => votes[pid]).length
  const myVote = DEMO ? null : votes[me]
  const r = balanceResult(p)
  const step = useCountdown(p.stage === 'vote' ? 'vote' : `${p.stage}-${p.revealedAt}`)
  const host = room.players[room.hostId]?.name || '방장'
  const next = (
    <>
      <button className="btn btn-ghost" onClick={() => act(() => balanceFinish(code, room, 'menu'))}>
        🏠 메뉴로
      </button>
      <button className="btn btn-primary" onClick={() => act(() => balanceFinish(code, room, 'again'))}>
        ⚖️ 한 판 더
      </button>
    </>
  )
  const waitNext = `${host}이(가) 다음 판을 골라요`

  if (p.stage === 'roulette')
    return (
      <RouletteOverlay
        revealKey={p.revealedAt}
        title="🎯 만장일치! 룰렛"
        note={`${ta} ${r.a} : ${r.b} ${tb}`}
        options={[
          { emoji: '🍻', label: '다 같이 마셔', color: '#f47725' },
          { emoji: '😇', label: '아무도 안 마셔', color: '#4cc9f0' },
        ]}
        pick={p.roulette === 'drink' ? 0 : 1}
        resultText={p.roulette === 'drink' ? '다 같이 마셔! 🍻' : '아무도 안 마셔! 😇'}
        ctl={ctl}
        waiting={waitNext}
      >
        {next}
      </RouletteOverlay>
    )
  if (p.stage === 'result') {
    if (step > 0) return <CountOverlay step={step} emoji="⚖️" sub="투표 결과를 집계하고 있어요…" />
    return (
      <DrinkOverlay room={room} targets={r.losers} note={`${ta} ${r.a} : ${r.b} ${tb} · 소수 의견`} ctl={ctl} waiting={waitNext}>
        {next}
      </DrinkOverlay>
    )
  }
  if (p.stage === 'tie' && step > 0) return <CountOverlay step={step} emoji="⚖️" sub="투표 결과를 집계하고 있어요…" />
  return (
    <div className="card card-pad stack round-card">
      <div className="round-head">
        <span className="kicker">⚖️ 밸런스 게임 · {p.round || 1}라운드</span>
        {ctl && (
          <button className="btn btn-ghost btn-sm" onClick={() => confirm('이번 판을 그만두고 메뉴로 갈까요?') && act(() => backToMenu(code, room))}>
            🏠 메뉴로
          </button>
        )}
      </div>
      {p.stage === 'tie' ? (
        <>
          <h2 className="round-title">🤝 동점!</h2>
          <div className="bal-topic result">
            <div className="opt">
              {ta}
              <span className="cnt">{r.a}표</span>
            </div>
            <div className="vs">
              {r.a}:{r.b}
            </div>
            <div className="opt">
              {tb}
              <span className="cnt">{r.b}표</span>
            </div>
          </div>
          <div className="muted">다수결이 나올 때까지 다른 주제로 다시 투표해요.</div>
          <HostActions ctl={ctl} waiting={`${host}이(가) 다음 주제를 열어요`}>
            <button className="btn btn-primary" onClick={() => act(() => balanceReroll(code, room))}>
              🔄 다른 주제로 다시 투표
            </button>
          </HostActions>
        </>
      ) : (
        <>
          <h2 className="round-title">둘 중 하나만!</h2>
          <div className="muted">
            각자 고르세요. 소수 의견이 마셔요. 동점이면 다른 주제로, 만장일치면 룰렛! ({votedCount}/{ids.length} 투표)
          </div>
          <div className="bal-topic pick">
            <button className={`opt ${myVote === 'A' ? 'on' : ''}`} onClick={() => balanceVote(code, room, 'A')}>
              {ta}
              {myVote === 'A' && <span className="me-tag">내 선택</span>}
            </button>
            <div className="vs">VS</div>
            <button className={`opt ${myVote === 'B' ? 'on' : ''}`} onClick={() => balanceVote(code, room, 'B')}>
              {tb}
              {myVote === 'B' && <span className="me-tag">내 선택</span>}
            </button>
          </div>
          <VoteDots room={room} ids={ids} votes={votes} />
          <HostActions ctl={ctl} waiting={`모두 고르면 ${host}이(가) 결과를 공개해요`}>
            <button className="btn btn-ghost" onClick={() => act(() => balanceReroll(code, room))}>
              🔄 다른 주제
            </button>
            <button className="btn btn-primary" onClick={() => act(() => balanceReveal(code, room))} disabled={!allVoted(room, ids, votes)}>
              결과 공개 {votedCount < ids.length ? `(${votedCount}/${ids.length})` : ''}
            </button>
          </HostActions>
        </>
      )}
    </div>
  )
}

// 누가 투표했는지만 (무엇을 골랐는지는 숨김)
function VoteDots({ room, ids, votes }) {
  return (
    <div className="vote-dots">
      {ids.map((pid) => (
        <span key={pid} className={`vdot ${votes[pid] != null ? 'done' : ''} ${room.players[pid]?.online === false ? 'off' : ''}`} title={room.players[pid]?.name}>
          <span className="avatar xs" style={{ background: room.players[pid]?.color }}>
            {room.players[pid]?.name?.slice(0, 1)}
          </span>
          {room.players[pid]?.name}
          {votes[pid] != null ? ' ✓' : ''}
        </span>
      ))}
    </div>
  )
}

// ======================================================================
// 라이어 게임
// ======================================================================
function LiarRound({ room, me, code, ctl, act }) {
  const p = room.round
  const [openTally, setOpenTally] = useState(null)
  const [show, setShow] = useState(false)
  useEffect(() => setShow(false), [p.stage, p.id])
  const ids = Object.keys(p.words || {}).filter((pid) => room.players[pid]?.name)
  const myWord = DEMO ? p.majority : p.words?.[me]
  const revealedCount = ids.filter((pid) => p.revealed?.[pid]).length
  const votes = p.votes || {}
  const votedCount = ids.filter((pid) => votes[pid]).length
  const myVote = DEMO ? null : votes[me]
  const cat = p.category ? liarCategory(p.category) : null
  const speak = (p.speakers || ids).filter((pid) => ids.includes(pid))
  const res = p.stage === 'result' ? liarResult(room, p) : null
  const step = useCountdown(p.stage === 'result' ? `r-${p.revealedAt}` : 'x')
  const host = room.players[room.hostId]?.name || '방장'
  const spectator = !DEMO && !p.words?.[me]

  if (p.stage === 'result' && step > 0) return <CountOverlay step={step} emoji="🤥" sub="누가 다른 키워드였을까요…" />

  return (
    <div className="card card-pad stack round-card liar">
      <div className="round-head">
        <span className="kicker">
          🤥 라이어 게임{cat ? ` · ${cat.emoji} ${cat.name}` : ''}
        </span>
        {ctl && p.stage !== 'result' && (
          <button className="btn btn-ghost btn-sm" onClick={() => confirm('이번 판을 그만두고 메뉴로 갈까요?') && act(() => backToMenu(code, room))}>
            🏠 메뉴로
          </button>
        )}
      </div>

      {p.stage === 'category' && (
        <>
          <h2 className="round-title">카테고리를 골라요</h2>
          <div className="muted">고르면 모두에게 키워드가 배정돼요. 한 명만 비슷하지만 다른 키워드를 받고, 누가 라이어인지는 본인도 몰라요.</div>
          <div className="cat-grid">
            {LIAR_CATEGORIES.map((c) => (
              <button key={c.key} className="cat-btn" disabled={!ctl} onClick={() => act(() => liarChooseCategory(code, room, c.key))}>
                <span className="cat-emo">{c.emoji}</span>
                <span>{c.name}</span>
              </button>
            ))}
          </div>
          {!ctl && <div className="waiting">{host}이(가) 카테고리를 고르고 있어요</div>}
        </>
      )}

      {p.stage === 'reveal' && (
        <>
          <h2 className="round-title">각자 키워드를 확인하세요!</h2>
          <div className="muted">한 명만 비슷하지만 다른 키워드를 받았어요. 키워드를 직접 말하지 말고, 순서대로 관련된 설명을 한 마디씩 하세요.</div>
          {spectator ? (
            <div className="spectator">👀 이번 판은 구경 중이에요 (판이 시작된 뒤에 들어왔어요). 다음 판부터 같이 해요!</div>
          ) : (
            <button
              className={`word-card ${show ? 'on' : ''}`}
              onClick={() => {
                setShow((v) => !v)
                if (!show) liarReveal(code, room)
              }}
            >
              {show ? (
                <>
                  <span className="word-label">내 키워드</span>
                  <span className="word">{myWord}</span>
                  <span className="word-hint">다시 탭하면 숨겨요</span>
                </>
              ) : (
                <>
                  <span className="word-label">탭해서 확인</span>
                  <span className="word">🔒</span>
                  <span className="word-hint">다른 사람이 보지 않게 조심!</span>
                </>
              )}
            </button>
          )}
          <div className="section-title">
            설명 순서 · 확인 {revealedCount}/{ids.length}
          </div>
          <div className="speak-list">
            {speak.map((pid, i) => (
              <span key={pid} className={`speak ${p.revealed?.[pid] ? 'ok' : ''}`}>
                <b>{i + 1}</b> {room.players[pid].name}
                {p.revealed?.[pid] ? ' ✓' : ''}
              </span>
            ))}
          </div>
          <HostActions ctl={ctl} waiting={`설명이 끝나면 ${host}이(가) 투표를 시작해요`}>
            <button className="btn btn-primary" onClick={() => act(() => liarStartVote(code, room))}>
              설명 끝 → 투표 시작 {revealedCount < ids.length ? `(확인 ${revealedCount}/${ids.length})` : ''}
            </button>
          </HostActions>
        </>
      )}

      {p.stage === 'vote' && (
        <>
          <h2 className="round-title">라이어는 누구?</h2>
          <div className="muted">
            다른 키워드를 받은 것 같은 사람을 한 명 고르세요. ({votedCount}/{ids.length} 투표)
          </div>
          {spectator && <div className="spectator">👀 이번 판은 구경 중이라 투표할 수 없어요.</div>}
          <div className="steal-list">
            {ids.map((pid) => {
              const pl = room.players[pid]
              return (
                <button key={pid} className={`steal-btn ${myVote === pid ? 'picked' : ''}`} disabled={spectator} onClick={() => liarVote(code, room, pid)}>
                  <span className="avatar sm" style={{ background: pl.color }}>
                    {pl.name.slice(0, 1)}
                  </span>
                  <span className="pname">{pl.name}</span>
                  {votes[pid] != null && <span className="muted vote-mark">투표 완료</span>}
                  {myVote === pid && <span className="me-tag">내 표</span>}
                </button>
              )
            })}
          </div>
          <HostActions ctl={ctl} waiting={`모두 투표하면 ${host}이(가) 결과를 공개해요`}>
            <button className="btn btn-primary" onClick={() => act(() => liarShowResult(code, room))} disabled={!allVoted(room, ids, votes)}>
              결과 공개 {votedCount < ids.length ? `(${votedCount}/${ids.length})` : ''}
            </button>
          </HostActions>
        </>
      )}

      {p.stage === 'result' && res && (
        <>
          <h2 className="round-title">결과 공개</h2>
          <div className="liar-reveal">
            <div className="liar-row">
              <span className="avatar" style={{ background: room.players[p.liar]?.color }}>
                {room.players[p.liar]?.name?.slice(0, 1)}
              </span>
              <div>
                <div className="muted">다른 키워드를 받은 사람</div>
                <b>{room.players[p.liar]?.name || '(나간 사람)'}</b>
              </div>
            </div>
            <div className="muted">득표 칸을 누르면 누가 찍었는지 보여요 · 라이어를 맞힌 사람은 안 마셔요</div>
            <div className="tally">
              {ids
                .map((pid) => ({ pid, n: res.tally[pid] || 0 }))
                .sort((a, b) => b.n - a.n)
                .map(({ pid, n }) => {
                  const voters = ids.filter((v) => votes[v] === pid)
                  const open = openTally === pid
                  return (
                    <div key={pid} className={`tally-item ${open ? 'open' : ''}`}>
                      <button type="button" className={`tally-row ${pid === p.liar ? 'liar' : ''}`} onClick={() => setOpenTally(open ? null : pid)}>
                        <span className="avatar sm" style={{ background: room.players[pid]?.color }}>
                          {room.players[pid]?.name?.slice(0, 1)}
                        </span>
                        <span className="pname">{room.players[pid]?.name}</span>
                        <span className="tally-bar">
                          <i style={{ width: `${ids.length ? (n / ids.length) * 100 : 0}%` }} />
                        </span>
                        <b>{n}표</b>
                        <span className="tally-chev">{open ? '▴' : '▾'}</span>
                      </button>
                      {open && (
                        <div className="tally-voters">
                          {voters.length === 0 && <span className="muted">아무도 안 찍었어요</span>}
                          {voters.map((v) => (
                            <span key={v} className={`voter-chip ${pid === p.liar ? 'right' : 'wrong'}`}>
                              <span className="avatar xs" style={{ background: room.players[v]?.color }}>
                                {room.players[v]?.name?.slice(0, 1)}
                              </span>
                              {room.players[v]?.name}
                              <em>{pid === p.liar ? '✅ 맞힘' : '🍶 마셔'}</em>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
            <div className="liar-drink">{res.wrong.length ? `🍶 ${res.wrong.map((x) => room.players[x]?.name).join(', ')} 마셔!` : '😇 모두 맞혔어요! 아무도 안 마셔요'}</div>
          </div>
          <HostActions ctl={ctl} waiting={`${host}이(가) 다음 판을 골라요`} wrap>
            <button className="btn btn-ghost" onClick={() => act(() => liarFinish(code, room, 'menu'))}>
              🏠 메뉴로
            </button>
            <button className="btn btn-ghost" onClick={() => act(() => liarFinish(code, room, 'again'))}>
              카테고리 바꾸기
            </button>
            <button className="btn btn-primary" onClick={() => act(() => liarFinish(code, room, 'same'))}>
              🤥 한 판 더
            </button>
          </HostActions>
        </>
      )}
    </div>
  )
}

// ======================================================================
// 🍺 오늘의 술고래
// ======================================================================
function DrinksModal({ room, me, ctl, act, code, onClose }) {
  const rows = playerIds(room)
    .map((pid) => ({ pid, name: room.players[pid].name, color: room.players[pid].color, drinks: room.players[pid].drinks || 0 }))
    .sort((a, b) => b.drinks - a.drinks)
  const top = rows[0]?.drinks || 0
  const total = rows.reduce((a, r) => a + r.drinks, 0)
  const medal = (i, d) => (d === 0 ? '' : d === top ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : '')
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="kicker">🍺 오늘의 술고래</div>
        <h2>{top === 0 ? '아직 아무도 안 마셨어요 😇' : `${rows.filter((r) => r.drinks === top).map((r) => r.name).join(', ')} 🐳`}</h2>
        <div className="muted">벌칙으로 마실 때 자동으로 세요 · 총 {total}잔</div>
        <div className="player-list" style={{ marginTop: 10 }}>
          {rows.map((r, i) => (
            <div className="player-row" key={r.pid}>
              <span className="order">{i + 1}</span>
              <span className="avatar" style={{ background: r.color }}>
                {r.name.slice(0, 1)}
              </span>
              <span className="player-name">
                {r.name} {r.pid === me && <span className="me-tag">나</span>}
              </span>
              <span className="drink-badge">🍺 {r.drinks}잔</span>
              <span className="summary-medal">{medal(i, r.drinks)}</span>
            </div>
          ))}
        </div>
        <div className="actions">
          {ctl && total > 0 && (
            <button className="btn btn-ghost" onClick={() => confirm('모두의 잔 수를 0으로 초기화할까요?') && act(() => resetDrinks(code, room))}>
              초기화
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

// 진단 패널: 주소 뒤에 ?debug=1
const DEBUG = new URLSearchParams(window.location.search).has('debug')
function DebugPanel({ room, code, me, connected }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const info = { connected, code, me, room: room && { hostId: room.hostId, order: room.order, round: room.round, roundNo: room.roundNo, liarTurn: room.liarTurn, players: Object.fromEntries(Object.entries(room.players || {}).map(([k, v]) => [k, `${v.name} drinks=${v.drinks || 0} online=${v.online}`])) } }
  return (
    <div className="debug">
      <pre>{JSON.stringify(info, null, 1)}</pre>
    </div>
  )
}

export default function App() {
  const [theme, toggleTheme] = useTheme()
  const me = myId()

  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('name') || ''
    } catch {
      return ''
    }
  })
  const [code, setCode] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('room')
    if (q) return q.toUpperCase()
    try {
      return sessionStorage.getItem('room') || ''
    } catch {
      return ''
    }
  })
  const [room, setRoom] = useState(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [busyBtn, setBusyBtn] = useState(false)
  const [toast, setToast] = useState(null)
  const [showLog, setShowLog] = useState(false)
  const [showDrinks, setShowDrinks] = useState(false)
  const [pwInput, setPwInput] = useState('')
  const [roomList, setRoomList] = useState([])
  const [joinTarget, setJoinTarget] = useState(null)
  const [pwJoin, setPwJoin] = useState('')
  const [acting, setActing] = useState(false)
  const lastEventId = useRef(null)

  // 방장 버튼 두 번 눌림 방지
  const act = async (fn) => {
    if (acting) return
    setActing(true)
    try {
      await fn()
    } finally {
      setActing(false)
    }
  }
  const flash = (msg, ms = 1800) => {
    setToast(msg)
    setTimeout(() => setToast(null), ms)
  }

  useEffect(() => subscribeConnection(setConnected), [])
  useEffect(() => watchServerOffset(), [])
  useEffect(() => {
    if (connected) purgeRooms()
  }, [connected])
  useEffect(() => {
    if (code || !connected) return
    return subscribeRoomList(setRoomList)
  }, [code, connected])

  // 방 구독
  useEffect(() => {
    if (!code) {
      setRoom(null)
      return
    }
    try {
      sessionStorage.setItem('room', code)
    } catch {}
    let first = true
    const off = subscribeRoom(code, (r) => {
      if (first) {
        first = false
        lastEventId.current = r?.event?.id ?? 'none'
      }
      setRoom(r)
      if (r === null) {
        setCode('')
        setError('방이 사라졌어요.')
      }
    })
    return () => off()
  }, [code])

  const joined = !!room?.players?.[me]?.name
  useEffect(() => {
    if (code && joined) setupPresence(code)
  }, [code, joined])

  // 링크로 들어왔는데 아직 참가 전이면 자동 참가 (이름이 있을 때)
  const leavingRef = useRef(false)
  useEffect(() => {
    if (room && !room.players?.[me]?.name) {
      if (leavingRef.current) return
      if (room.kicked?.[me]) {
        setCode('')
        setError('방장이 방에서 내보냈어요.')
        return
      }
      if (room.pw) {
        setCode('')
        setJoinTarget({ code })
        setPwJoin('')
        return
      }
      if (name.trim()) {
        joinRoom(code, name.trim()).catch((e) => {
          setCode('')
          setError(e.message)
        })
      } else {
        setCode('')
        setError('이름을 입력하고 아래 목록에서 방을 눌러주세요.')
      }
    }
  }, [room, me, name, code])

  // 이벤트 토스트
  useEffect(() => {
    const ev = room?.event
    if (!ev || ev.id === lastEventId.current) return
    lastEventId.current = ev.id
    setToast(String(ev.text).replace(/\n/g, ' '))
    const t = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(t)
  }, [room?.event?.id])

  // 방장 기기: 로그 정리 / 1시간 동안 아무 일 없으면 방 닫기
  useEffect(() => {
    if (room && room.hostId === me) trimLog(code, room)
  }, [Object.keys(room?.log || {}).length])
  useEffect(() => {
    if (!room || room.hostId !== me || typeof room.lastActive !== 'number') return
    const check = () => {
      if (Date.now() - room.lastActive >= IDLE_TTL_MS) removeRoom(code)
    }
    const t = setInterval(check, 60000)
    return () => clearInterval(t)
  }, [room, me, code])

  const saveName = (n) => {
    setName(n)
    try {
      localStorage.setItem('name', n)
    } catch {}
  }
  const onCreate = async () => {
    if (!name.trim()) return setError('이름을 먼저 입력해주세요.')
    setBusyBtn(true)
    setError('')
    try {
      const c = await createRoom(name.trim(), pwInput)
      setPwInput('')
      setCode(c)
    } catch (e) {
      setError(e.message || '실패했어요. 다시 시도해주세요.')
    }
    setBusyBtn(false)
  }
  const tryJoin = async (c, pw) => {
    if (!name.trim()) return setError('이름을 먼저 입력해주세요.')
    setBusyBtn(true)
    setError('')
    try {
      const got = await joinRoom(c, name.trim(), pw)
      setJoinTarget(null)
      setPwJoin('')
      setCode(got)
    } catch (e) {
      if (e.needPassword) setJoinTarget({ code: c.trim().toUpperCase(), error: pw ? e.message : '' })
      else {
        setJoinTarget(null)
        setError(e.message || '실패했어요. 다시 시도해주세요.')
      }
    }
    setBusyBtn(false)
  }
  const onPickRoom = (r) => {
    if (r.locked && !r.members.includes(me)) {
      setPwJoin('')
      setJoinTarget({ code: r.code })
      return
    }
    return tryJoin(r.code, '')
  }
  const onLeave = async () => {
    if (room?.round && !confirm('게임이 진행 중이에요. 정말 나갈까요?')) return
    leavingRef.current = true
    if (room) await leaveRoom(code)
    setCode('')
    setRoom(null)
    setTimeout(() => (leavingRef.current = false), 1500)
    try {
      sessionStorage.removeItem('room')
    } catch {}
  }
  const shareLink = async () => {
    const url = `${location.origin}${location.pathname}?room=${code}`
    try {
      if (navigator.share) await navigator.share({ title: APP_NAME, text: '밸런스 게임 · 라이어 게임 하러 와!', url })
      else {
        await navigator.clipboard.writeText(url)
        flash('초대 링크를 복사했어요')
      }
    } catch {}
  }

  const ctl = room ? canControl(room) : false
  const isHost = room?.hostId === me
  const ids = room ? playerIds(room) : []
  const round = room?.round

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className={`brand-dot ${connected ? '' : 'off'}`} title={connected ? '연결됨' : '연결 중…'} /> {APP_NAME}
        </div>
        <div className="row">
          {room && (
            <button className="icon-btn" onClick={() => setShowDrinks(true)} aria-label="오늘의 술고래" title="오늘의 술고래">
              <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>
                🍺
              </span>
            </button>
          )}
          {room && (
            <button className="icon-btn" onClick={() => setShowLog(true)} aria-label="게임 로그" title="게임 로그">
              <Icon name="log" />
            </button>
          )}
          {room && (
            <button className="icon-btn" onClick={onLeave} aria-label="나가기" title="나가기">
              <Icon name="exit" />
            </button>
          )}
          <button className="icon-btn" onClick={toggleTheme} aria-label="테마 전환">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </header>

      {/* ---------- 홈 ---------- */}
      {!room && (
        <>
          <div className="hero">
            <div className="logo">
              <span className="logo-emo" aria-hidden>
                ⚖️
              </span>
              <span className="logo-text">
                밸런스<em>&</em>라이어
              </span>
              <span className="logo-emo" aria-hidden>
                🤥
              </span>
            </div>
            <p>둘 중 하나를 고르고, 거짓말쟁이를 찾아라! 친구들과 각자 폰으로 하는 술자리 게임이에요.</p>
          </div>

          <div className="card card-pad stack">
            <div>
              <div className="label">내 이름</div>
              <input className="field" placeholder="예) 상혁" value={name} maxLength={10} onChange={(e) => saveName(e.target.value)} />
            </div>
            <div>
              <div className="label">방 비밀번호 (선택)</div>
              <input className="field" placeholder="비워두면 누구나 입장" value={pwInput} maxLength={12} onChange={(e) => setPwInput(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block" onClick={onCreate} disabled={busyBtn || !name.trim()}>
              {pwInput.trim() ? '🔒 비밀번호 방 만들기' : '새 방 만들기'}
            </button>
            {error && <div className="error">{error}</div>}
            {!connected && <div className="muted">서버에 연결 중이에요… 계속 이 상태면 Firebase 규칙(blRooms)을 확인해주세요.</div>}
          </div>

          <div className="card card-pad stack">
            <div className="row">
              <div className="label" style={{ marginBottom: 0 }}>
                열린 방 {roomList.length}개
              </div>
              <div className="spacer" />
              <span className="muted">탭해서 입장</span>
            </div>
            {roomList.length === 0 ? (
              <div className="muted">아직 열린 방이 없어요. 위에서 새 방을 만들어보세요.</div>
            ) : (
              <div className="room-list">
                {roomList.map((r) => (
                  <button key={r.code} className={`room-row ${r.game ? 'playing' : ''}`} onClick={() => onPickRoom(r)} disabled={busyBtn || !name.trim()}>
                    <span className="room-lock">{r.locked ? '🔒' : '🔓'}</span>
                    <span className="room-main">
                      <b>{r.hostName ? `${r.hostName}의 방` : '방'}</b>
                      <span className="muted">
                        {r.count}명{r.online < r.count ? ` (접속 ${r.online})` : ''} · {new Date(r.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 생성
                      </span>
                    </span>
                    <span className={`tag ${r.game ? 'tag-gray' : ''}`}>{r.game === 'balance' ? '⚖️ 밸런스 중' : r.game === 'liar' ? '🤥 라이어 중' : '대기 중'}</span>
                  </button>
                ))}
              </div>
            )}
            {!name.trim() && roomList.length > 0 && <div className="muted">입장하려면 먼저 이름을 입력하세요.</div>}
          </div>
        </>
      )}

      {/* ---------- 비밀번호 입력 ---------- */}
      {joinTarget && !room && (
        <div className="modal-backdrop" onClick={() => setJoinTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="kicker">🔒 비밀번호 방</div>
            <h2>{roomList.find((r) => r.code === joinTarget.code)?.hostName ? `${roomList.find((r) => r.code === joinTarget.code).hostName}의 방` : '비밀번호 방'}</h2>
            <div className="muted">이 방은 비밀번호가 있어요. 방장에게 물어보세요.</div>
            {!name.trim() && <input className="field" style={{ marginTop: 12 }} placeholder="내 이름" value={name} maxLength={10} onChange={(e) => saveName(e.target.value)} />}
            <input
              className="field"
              style={{ marginTop: 12 }}
              type="password"
              placeholder="비밀번호"
              value={pwJoin}
              maxLength={12}
              autoFocus
              onChange={(e) => setPwJoin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && tryJoin(joinTarget.code, pwJoin)}
            />
            {joinTarget.error && (
              <div className="error" style={{ marginTop: 8 }}>
                {joinTarget.error}
              </div>
            )}
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setJoinTarget(null)}>
                취소
              </button>
              <button className="btn btn-primary" onClick={() => tryJoin(joinTarget.code, pwJoin)} disabled={busyBtn || !pwJoin || !name.trim()}>
                입장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- 방: 게임 메뉴 ---------- */}
      {room && !round && (
        <>
          <div className="card card-pad stack">
            <div className="row">
              <div>
                <div className="label">대기실</div>
                <div className="big-code" style={{ letterSpacing: '-0.02em', fontSize: 24 }}>
                  {room.pw ? '🔒 ' : ''}
                  {room.hostName || room.players?.[room.hostId]?.name}의 방
                </div>
              </div>
              <div className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={shareLink}>
                초대 링크
              </button>
            </div>
            <div className="muted">친구들이 홈 화면의 방 목록에서 이 방을 누르면 들어와요. 게임은 방장이 골라서 진행해요.</div>
          </div>

          <div className="card card-pad stack">
            <div className="label" style={{ marginBottom: 0 }}>
              게임 고르기
            </div>
            <div className="game-grid">
              <button className="game-btn balance" disabled={!ctl || acting || ids.length < 2} onClick={() => act(() => startBalance(code, room))}>
                <span className="game-emo">⚖️</span>
                <b>밸런스 게임</b>
                <span className="game-desc">둘 중 하나! 소수 의견이 마셔요</span>
              </button>
              <button className="game-btn liar" disabled={!ctl || acting || ids.length < 3} onClick={() => act(() => startLiar(code, room))}>
                <span className="game-emo">🤥</span>
                <b>라이어 게임</b>
                <span className="game-desc">한 명만 다른 키워드. 라이어를 찾아라</span>
              </button>
            </div>
            <div className="muted">{ctl ? (ids.length < 2 ? '2명 이상 모이면 시작할 수 있어요. (라이어는 3명부터)' : ids.length < 3 ? '라이어 게임은 3명부터 할 수 있어요.' : '게임을 누르면 바로 시작해요.') : `${room.players[room.hostId]?.name || '방장'}이(가) 게임을 골라요.`}</div>
          </div>

          <div className="card card-pad stack">
            <div className="label" style={{ marginBottom: 0 }}>
              참가자 {ids.length}명
            </div>
            <div className="player-list">
              {ids.map((pid, i) => {
                const p = room.players[pid]
                return (
                  <div className={`player-row ${p.online === false ? 'off' : ''}`} key={pid}>
                    <span className="order">{i + 1}</span>
                    <span className="avatar" style={{ background: p.color }}>
                      {p.name.slice(0, 1)}
                    </span>
                    <span className="player-name">
                      {p.name}
                      {p.online === false && <span className="muted"> (연결 끊김)</span>}
                    </span>
                    {pid === me && <span className="me-tag">나</span>}
                    {pid === room.hostId && <span className="tag">방장</span>}
                    <span className="drink-badge">🍺 {p.drinks || 0}</span>
                    {isHost && pid !== me && (
                      <span className="order-btns">
                        <button className="crown" aria-label="방장 위임" title="방장 위임" onClick={() => confirm(`${p.name} 님에게 방장을 넘길까요?`) && transferHost(code, room, pid)}>
                          👑
                        </button>
                        <button className="kick" aria-label="강퇴" title="강퇴" onClick={() => confirm(`${p.name} 님을 방에서 내보낼까요? (다시 들어올 수 없어요)`) && kickPlayer(code, room, pid)}>
                          ✕
                        </button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            {isHost && <div className="muted">👑 방장 위임 · ✕ 내보내기</div>}
          </div>
        </>
      )}

      {/* ---------- 방: 진행 중인 판 ---------- */}
      {room && round?.kind === 'balance' && <BalanceRound key={round.id} room={room} me={me} code={code} ctl={ctl} act={act} />}
      {room && round?.kind === 'liar' && <LiarRound key={round.id} room={room} me={me} code={code} ctl={ctl} act={act} />}
      {room && round && (
        <div className="card card-pad players-mini">
          {ids.map((pid) => {
            const p = room.players[pid]
            return (
              <span key={pid} className={`mchip ${pid === me ? 'me' : ''} ${p.online === false ? 'offline' : ''}`}>
                <span className="avatar xs" style={{ background: p.color }}>
                  {p.name.slice(0, 1)}
                </span>
                <span className="pname">{p.name}</span>
                {pid === room.hostId && <span className="host-mark">👑</span>}
                <span className="mini-drinks">🍺{p.drinks || 0}</span>
              </span>
            )
          })}
        </div>
      )}

      {showDrinks && room && <DrinksModal room={room} me={me} ctl={ctl} act={act} code={code} onClose={() => setShowDrinks(false)} />}

      {showLog && room && (
        <div className="modal-backdrop" onClick={() => setShowLog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="kicker">게임 로그</div>
            <h2>지금까지 일어난 일</h2>
            <div className="log">
              {roomLog(room).length === 0 && <div className="muted">아직 기록이 없어요.</div>}
              {roomLog(room).map((e) => (
                <div className="line" key={e.id}>
                  <span className="log-time">{new Date(e.t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span>{e.text}</span>
                </div>
              ))}
            </div>
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setShowLog(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
      {DEBUG && <DebugPanel room={room} code={code} me={me} connected={connected} />}
    </div>
  )
}
