import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import '../../src/index.css'
import { useRoom, newRoomNumber, newPassword } from '../../src/hooks/useRoom'
import { SERVER } from '../../src/config'
import { useDirect } from '../../src/hooks/useDirect'
import { prefersDark } from '../../src/lib/color'
import { bytes } from '../../src/lib/format'
import { initLang, setLang, t, useLang } from '../../src/lib/i18n'
import { useClipboardKeys } from '../../src/lib/clipboard'
import { useRecorder } from '../../src/hooks/useRecorder'

/** Кнопка панели: подсвечивается, когда включена, краснеет, когда выключена. */
function Ctl({ children, onClick, title, on, danger }: {
  children: React.ReactNode; onClick: () => void; title: string; on?: boolean; danger?: boolean
}) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
            className="grid h-9 w-9 place-items-center rounded-[11px] text-[15px]"
            style={{
              background: danger ? 'rgb(255 69 58 / 0.22)' : on ? 'rgb(var(--accent) / 0.26)' : 'rgb(var(--glass))',
              color: 'rgb(var(--ink))',
            }}>
      {children}
    </button>
  )
}

/** Плитка участника. Своё видео зеркалим, чужое показываем как есть. */
function Tile({ stream, name, me, volume = 1, talking, big, onBig }: {
  stream?: MediaStream | null; name: string; me?: boolean
  volume?: number; talking?: boolean; big?: boolean; onBig?: () => void
}) {
  const v = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (v.current && stream) v.current.srcObject = stream }, [stream])
  useEffect(() => { if (v.current && !me) v.current.volume = volume }, [volume, me, stream])
  return (
    <div onDoubleClick={onBig}
         className={`relative overflow-hidden rounded-[16px] ${big ? 'col-span-full row-span-2 aspect-video' : 'aspect-[4/3]'}`}
         style={{
           background: 'rgb(var(--fill))',
           boxShadow: talking
             ? '0 0 0 2.5px rgb(48 209 88), 0 0 18px rgb(48 209 88 / 0.35)'
             : '0 0 0 1px rgb(var(--glass-edge))',
           transition: 'box-shadow .2s',
         }}>
      {stream
        ? <video ref={v} autoPlay playsInline muted={me}
                 className={`h-full w-full object-cover ${me ? 'scale-x-[-1]' : ''}`} />
        : <div className="grid h-full w-full place-items-center text-[22px] font-semibold"
               style={{ color: 'rgb(var(--ink-3))' }}>{(name || '?').slice(0, 2).toUpperCase()}</div>}
      <span className="absolute bottom-2 left-2 rounded-[8px] px-2 py-0.5 text-[11px] font-medium text-white"
            style={{ background: 'rgb(0 0 0 / 0.45)' }}>
        {me ? t('you') : name}
      </span>
    </div>
  )
}

function Chat() {
  useLang()
  useClipboardKeys()

  const r = useRoom()
  const d = useDirect()                         // запасной путь: в одной сети без сервера
  const rec = useRecorder()
  const [recMenu, setRecMenu] = useState(false)
  const [mode, setMode] = useState<'server' | 'lan'>('server')

  const [srv, setSrv] = useState(SERVER)
  const [num, setNum] = useState('')             // номер комнаты
  const [pass, setPass] = useState('')           // пароль комнаты
  const [nick, setNick] = useState('')
  const [ready, setReady] = useState(false)
  const [madeRoom, setMadeRoom] = useState(false)
  const [copied, setCopied] = useState(false)
  const [big, setBig] = useState<string | null>(null)
  const [devOpen, setDevOpen] = useState(false)
  const [text, setText] = useState('')
  const [over, setOver] = useState(false)
  const [cfgOpen, setCfgOpen] = useState(false)

  const [lan, setLan] = useState<any[]>([])
  const [incoming, setIncoming] = useState<any>(null)
  const [calling, setCalling] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(0)
  const session = useRef<{ id: string; pw: string } | null>(null)
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pw, setPw] = useState('')

  const feed = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)

  const live = mode === 'server' ? r.state === 'live' : d.phase === 'live'

  useEffect(() => { document.documentElement.classList.toggle('theme-dark', prefersDark()) }, [])
  useEffect(() => {
    window.snap?.getLang().then((l) => (l ? setLang(l) : initLang()))
    return window.snap?.onLang(setLang)
  }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') window.snap?.closeChat() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  useEffect(() => { feed.current?.scrollTo({ top: 1e6, behavior: 'smooth' }) }, [r.chat.length, d.chat.length])

  /* Сохранённые адрес сервера и имя */
  useEffect(() => {
    window.snap?.cfgGet().then((c: any) => {
      setSrv(SERVER || c?.roomUrl || '')
      setNick(c?.nick || c?.deviceName || '')
      setNum(c?.lastRoom || '')
      setPass(c?.lastPass || '')
      setReady(true)
      if (!SERVER && !c?.roomUrl) setMode('lan')  // адреса нет — работаем в одной сети
    }).catch(() => setReady(true))
  }, [])

  /** Создать комнату: номер и пароль виджет придумывает сам. */
  const makeRoom = () => {
    setNum(newRoomNumber())
    setPass(newPassword())
    setMadeRoom(true)
  }

  const invite = () => `Комната ${num}, пароль ${pass}`

  const copyInvite = async () => {
    await window.snap?.copyText(invite())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  /* ---------------- режим одной сети ---------------- */
  useEffect(() => {
    if (mode !== 'lan') return
    window.snap?.lanStart()
    const id = setInterval(async () => setLan((await window.snap?.lanPeers()) ?? []), 1500)
    return () => clearInterval(id)
  }, [mode])

  useEffect(() => window.snap?.onLanOffer(async (inc: any) => {
    const s = session.current
    if (s && s.id === inc.fromId) {              // восстановление прежнего разговора
      setRestoring((n) => n + 1)
      d.setPhase('connecting')
      const answer = await d.makeAnswerBlob(s.pw, inc.offer)
      if (answer) await window.snap?.lanAnswer(inc.token, answer)
      return
    }
    setIncoming(inc)
  }), [])

  useEffect(() => {
    if (d.phase !== 'failed' || !session.current || mode !== 'lan' || retry.current) return
    retry.current = setTimeout(async () => {
      retry.current = null
      const s = session.current
      if (!s) return
      setRestoring((n) => n + 1)
      d.setError(null); d.setPhase('connecting')
      try {
        const offer = await d.makeOfferBlob(s.pw)
        const answer = await window.snap?.lanInvite(s.id, offer)
        if (answer) await d.applyAnswerBlob(answer)
        else { d.setPhase('failed'); d.setError(t('lostPath')) }
      } catch { d.setPhase('failed'); d.setError(t('lostPath')) }
    }, 1200 + Math.min(restoring, 5) * 1200)
    return () => { if (retry.current) { clearTimeout(retry.current); retry.current = null } }
  }, [d.phase, mode, restoring])

  const callPeer = async (id: string) => {
    if (calling) return
    d.setError(null); setCalling(id)
    try {
      const offer = await d.makeOfferBlob(pw || 'lan')
      const answer = await window.snap?.lanInvite(id, offer)
      if (!answer) { d.setError(t('directFailed')); d.setPhase('failed'); return }
      d.setPhase('connecting')
      await d.applyAnswerBlob(answer)
      session.current = { id, pw: pw || 'lan' }
    } catch (e: any) { d.setPhase('failed'); d.setError(String(e?.message ?? e)) }
    finally { setCalling(null) }
  }

  const acceptCall = async () => {
    if (!incoming) return
    const inc = incoming
    setIncoming(null)
    d.setPhase('connecting')
    const answer = await d.makeAnswerBlob(pw || 'lan', inc.offer)
    if (!answer) { d.setPhase('failed'); d.setError(t('badCode')); return }
    await window.snap?.lanAnswer(inc.token, answer)
    session.current = { id: inc.fromId, pw: pw || 'lan' }
  }

  /* ---------------- общее ---------------- */
  const enter = async () => {
    if (!srv.trim() || !num.trim() || !pass.trim()) return
    await window.snap?.cfgSetRoomUrl(srv)
    await window.snap?.cfgSetProfile(nick, num, pass)
    if (r.state === 'live') r.leave()
    await r.join(srv, num, nick, pass)
  }

  const hangUp = () => {
    session.current = null; setRestoring(0)
    mode === 'server' ? r.leave() : d.hangUp()
  }

  const drop = (files: FileList | null) => {
    if (!files) return
    for (const f of Array.from(files)) mode === 'server' ? r.sendFile(f) : d.sendFile(f)
  }

  const items = mode === 'server' ? r.chat : d.chat
  const tiles = mode === 'server'
    ? [{ id: 'me', name: nick, stream: r.mine, me: true }, ...r.members.map((m) => ({ id: m.id, name: m.name, stream: m.stream, me: false }))]
    : [{ id: 'me', name: t('you'), stream: d.mine, me: true }, { id: 'peer', name: '—', stream: d.remote, me: false }]

  return (
    <div className="surface flex h-screen w-screen flex-col overflow-hidden rounded-[18px]"
         style={{ color: 'rgb(var(--ink))' }}
         onDragOver={(e) => { e.preventDefault(); if (live) setOver(true) }}
         onDragLeave={() => setOver(false)}
         onDrop={(e) => { e.preventDefault(); setOver(false); drop(e.dataTransfer.files) }}>

      {/* шапка */}
      <div className="flex shrink-0 items-center gap-3 px-4 py-3"
           style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <span className="text-[13px] font-semibold">{t('roomTitle')}</span>

        {!live && (
          <span className="no-drag flex gap-0.5 rounded-[10px] p-0.5"
                style={{ background: 'rgb(var(--fill))', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {(['server', 'lan'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                      className="rounded-[8px] px-2.5 py-1 text-[11px] font-medium"
                      style={{ background: mode === m ? 'rgb(var(--accent) / 0.28)' : 'transparent' }}>
                {m === 'server' ? t('modeServer') : t('modeLan')}
              </button>
            ))}
          </span>
        )}

        {live && (
          <span className="flex items-center gap-2 text-[11.5px]" style={{ color: 'rgb(var(--ink-2))' }}>
            <span className="h-2 w-2 rounded-full" style={{ background: 'rgb(48 209 88)' }} />
            {mode === 'server' ? `${r.room} · ${r.members.length + 1}` : t('directLive')}
          </span>
        )}

        <div className="flex-1" />

        {live && (
          <>
            {mode === 'lan' && (
              <button onClick={hangUp}
                      className="no-drag rounded-[9px] px-2.5 py-1 text-[11px] font-medium"
                      style={{ background: 'rgb(255 69 58 / 0.18)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                {t('endCall')}
              </button>
            )}
          </>
        )}
        <button onClick={() => setCfgOpen((v) => !v)} title={t('changeServer')}
                className="no-drag grid h-6 w-6 place-items-center rounded-full text-[12px]"
                style={{ background: 'rgb(var(--fill))', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>⚙</button>
        <button onClick={() => window.snap?.closeChat()} aria-label={t('close')}
                className="no-drag grid h-6 w-6 place-items-center rounded-full text-[15px]"
                style={{ background: 'rgb(var(--fill))', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>✕</button>
      </div>

      {/* адрес — только если он не вшит в программу */}
      {!live && mode === 'server' && ready && !srv.trim() && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="max-w-[440px] text-[12.5px] leading-relaxed" style={{ color: 'rgb(var(--ink-2))' }}>
            {t('firstRun')}
          </p>
          <input value={srv} onChange={(e) => setSrv(e.target.value)}
                 placeholder="https://ваш-сайт.ру/chat/"
                 className="selectable h-11 w-[360px] rounded-[12px] px-3 text-center text-[13px] outline-none"
                 style={{ background: 'rgb(var(--fill))', color: 'rgb(var(--ink))' }} />
          <button onClick={() => window.snap?.cfgSetRoomUrl(srv)} disabled={!srv.trim()}
                  className="h-11 w-[360px] rounded-[12px] text-[13px] font-semibold disabled:opacity-40"
                  style={{ background: 'rgb(var(--accent) / 0.25)' }}>
            {t('saveCfg')}
          </button>
          <p className="max-w-[420px] text-[11px] leading-snug" style={{ color: 'rgb(var(--ink-3))' }}>
            {t('firstRunHint')}
          </p>
        </div>
      )}

      {/* создать комнату или войти по номеру */}
      {!live && mode === 'server' && ready && !!srv.trim() && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-8 py-4 text-center">
          {!madeRoom ? (
            <>
              <button onClick={makeRoom}
                      className="h-11 w-[320px] rounded-[12px] text-[13.5px] font-semibold"
                      style={{ background: 'rgb(var(--accent) / 0.25)' }}>
                {t('makeRoom')}
              </button>

              <div className="my-1 flex w-[320px] items-center gap-3">
                <span className="h-px flex-1" style={{ background: 'rgb(var(--ink-3) / 0.5)' }} />
                <span className="text-[11px]" style={{ color: 'rgb(var(--ink-3))' }}>{t('orJoin')}</span>
                <span className="h-px flex-1" style={{ background: 'rgb(var(--ink-3) / 0.5)' }} />
              </div>

              <input value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, '').slice(0, 8))}
                     placeholder={t('roomNumber')} inputMode="numeric"
                     className="selectable h-11 w-[320px] rounded-[12px] px-3 text-center text-[15px] tracking-[0.15em] outline-none"
                     style={{ background: 'rgb(var(--fill))', color: 'rgb(var(--ink))' }} />
              <input value={pass} onChange={(e) => setPass(e.target.value.trim())}
                     placeholder={t('password')}
                     onKeyDown={(e) => e.key === 'Enter' && enter()}
                     className="selectable h-11 w-[320px] rounded-[12px] px-3 text-center text-[14px] outline-none"
                     style={{ background: 'rgb(var(--fill))', color: 'rgb(var(--ink))' }} />
              <button onClick={enter} disabled={!num.trim() || !pass.trim() || r.state === 'connecting'}
                      className="h-11 w-[320px] rounded-[12px] text-[13px] font-semibold disabled:opacity-40"
                      style={{ background: 'rgb(var(--fill))' }}>
                {r.state === 'connecting' ? t('connecting') : t('joinRoom')}
              </button>
            </>
          ) : (
            <>
              <p className="text-[12.5px]" style={{ color: 'rgb(var(--ink-2))' }}>{t('roomReady')}</p>
              <div className="flex w-[340px] flex-col gap-2 rounded-[16px] p-4"
                   style={{ background: 'rgb(var(--accent) / 0.14)' }}>
                <span className="text-[11px]" style={{ color: 'rgb(var(--ink-2))' }}>{t('roomNumber')}</span>
                <span className="selectable text-[30px] font-semibold tracking-[0.12em]">{num}</span>
                <span className="mt-1 text-[11px]" style={{ color: 'rgb(var(--ink-2))' }}>{t('password')}</span>
                <span className="selectable text-[20px] font-semibold tracking-[0.06em]">{pass}</span>
              </div>
              <button onClick={copyInvite}
                      className="h-11 w-[340px] rounded-[12px] text-[13px] font-semibold"
                      style={{ background: copied ? 'rgb(48 209 88 / 0.3)' : 'rgb(var(--fill))' }}>
                {copied ? `${t('done')} ✓` : t('copyInvite')}
              </button>
              <button onClick={enter} disabled={r.state === 'connecting'}
                      className="h-11 w-[340px] rounded-[12px] text-[13.5px] font-semibold disabled:opacity-40"
                      style={{ background: 'rgb(var(--accent) / 0.25)' }}>
                {r.state === 'connecting' ? t('connecting') : t('enterRoom')}
              </button>
              <button onClick={() => setMadeRoom(false)}
                      className="text-[11.5px] underline" style={{ color: 'rgb(var(--ink-3))' }}>
                {t('back')}
              </button>
            </>
          )}

          {r.error && <p className="selectable text-[12px]" style={{ color: '#ff453a' }}>{r.error}</p>}
          <p className="max-w-[420px] text-[11px] leading-snug" style={{ color: 'rgb(var(--ink-3))' }}>
            {t('passNote')}
          </p>
        </div>
      )}

      {/* вход: одна сеть */}
      {!live && mode === 'lan' && (
        <div className="flex flex-1 flex-col items-center gap-3 overflow-y-auto px-8 py-6 text-center">
          <p className="max-w-[460px] text-[12.5px] leading-relaxed" style={{ color: 'rgb(var(--ink-2))' }}>
            {t('lanIntro')}
          </p>

          {incoming && (
            <div className="flex w-[380px] flex-col gap-2 rounded-[14px] p-3"
                 style={{ background: 'rgb(48 209 88 / 0.16)' }}>
              <span className="text-[13px] font-semibold">{incoming.from} {t('lanIncoming')}</span>
              <div className="flex gap-2">
                <button onClick={acceptCall} className="h-9 flex-[2] rounded-[11px] text-[12.5px] font-semibold"
                        style={{ background: 'rgb(48 209 88 / 0.35)' }}>{t('lanAccept')}</button>
                <button onClick={() => setIncoming(null)} className="h-9 flex-1 rounded-[11px] text-[12.5px]"
                        style={{ background: 'rgb(var(--fill))' }}>{t('lanDecline')}</button>
              </div>
            </div>
          )}

          <div className="flex w-[380px] flex-col gap-2">
            {lan.length === 0 ? (
              <div className="flex items-center justify-center gap-2.5 py-6 text-[12px]" style={{ color: 'rgb(var(--ink-2))' }}>
                <span className="h-3 w-3 rounded-full border-2 border-current border-r-transparent"
                      style={{ animation: 'spin 0.9s linear infinite' }} />
                {t('lanSearching')}
              </div>
            ) : lan.map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 rounded-[13px] px-3 py-2.5"
                   style={{ background: 'rgb(var(--fill))' }}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-[12px] font-semibold"
                      style={{ background: 'rgb(var(--accent) / 0.25)' }}>{String(p.name).slice(0, 2).toUpperCase()}</span>
                <span className="flex-1 truncate text-left text-[12.5px] font-medium">{p.name}</span>
                <button onClick={() => callPeer(p.id)} disabled={!!calling}
                        className="h-8 shrink-0 rounded-[10px] px-4 text-[12px] font-semibold disabled:opacity-40"
                        style={{ background: 'rgb(var(--accent) / 0.28)' }}>
                  {calling === p.id ? '…' : t('lanCall')}
                </button>
              </div>
            ))}
            {lan.length === 0 && <p className="text-[11.5px]" style={{ color: 'rgb(var(--ink-3))' }}>{t('lanNobody')}</p>}
          </div>

          {(d.phase === 'connecting' || restoring > 0) && d.phase !== 'live' && (
            <div className="flex items-center gap-2.5 text-[12.5px]">
              <span className="h-3 w-3 rounded-full border-2 border-current border-r-transparent"
                    style={{ animation: 'spin 0.9s linear infinite' }} />
              {restoring > 0 ? `${t('restoring')} (${restoring})` : t('connecting')}
            </div>
          )}
          {d.error && <p className="selectable max-w-[440px] text-[12px]" style={{ color: '#ff453a' }}>{d.error}</p>}
        </div>
      )}

      {/* разговор */}
      {live && (
        <div className="flex min-h-0 flex-1 gap-3 px-4 pb-4">
          <div className="min-w-0 flex-[3] overflow-y-auto">
            {(mode === 'server' ? r.noCam : d.noCam) && (
              <button onClick={() => window.snap?.openCameraSettings()}
                      className="mb-2 w-full rounded-[12px] px-3 py-2 text-left text-[11.5px]"
                      style={{ background: 'rgb(255 159 10 / 0.18)' }}>
                {t('noCamera')}
              </button>
            )}
            <div className="grid gap-2"
                 style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${tiles.length > 3 ? 150 : 210}px, 1fr))` }}>
              {tiles.map((x) => (
                <Tile key={x.id} stream={x.stream} name={x.name} me={x.me}
                      volume={r.volume} talking={mode === 'server' && r.speaking.has(x.id)}
                      big={big === x.id} onBig={() => setBig(big === x.id ? null : x.id)} />
              ))}
            </div>

            {/* Панель как в обычном видеочате */}
            {mode === 'server' && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 rounded-[16px] px-3 py-2"
                   style={{ background: 'rgb(var(--fill))' }}>
                <Ctl on={r.micOn} danger={!r.micOn} onClick={() => r.toggle('audio')} title={t('mic')}>
                  {r.micOn ? '🎙' : '🔇'}
                </Ctl>
                <Ctl on={r.camOn} danger={!r.camOn} onClick={() => r.toggle('video')} title={t('camera')}>
                  {r.camOn ? '📹' : '🚫'}
                </Ctl>
                <Ctl on={r.sharing} onClick={() => r.share()} title={t('share')}>🖥</Ctl>

                <span className="mx-1 h-6 w-px" style={{ background: 'rgb(var(--ink-3) / 0.5)' }} />

                <span className="flex items-center gap-2">
                  <span className="text-[13px]">🔊</span>
                  <input type="range" min={0} max={100} value={Math.round(r.volume * 100)}
                         onChange={(e) => r.setVolume(Number(e.target.value) / 100)}
                         className="h-1 w-[92px] cursor-pointer accent-current"
                         style={{ accentColor: 'rgb(var(--accent))' }} />
                </span>

                <span className="mx-1 h-6 w-px" style={{ background: 'rgb(var(--ink-3) / 0.5)' }} />

                <span className="relative">
                  <Ctl on={rec.on} danger={rec.on}
                       onClick={() => (rec.on ? rec.stop() : setRecMenu((v) => !v))}
                       title={rec.on ? t('recStop') : t('rec')}>
                    {rec.on ? '⏹' : '⏺'}
                  </Ctl>
                  {rec.on && (
                    <span className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded-[7px] px-1.5 text-[10px] font-medium"
                          style={{ background: 'rgb(255 69 58 / 0.9)', color: '#fff' }}>
                      {rec.clock}
                    </span>
                  )}
                  {recMenu && !rec.on && (
                    <span className="absolute bottom-[calc(100%+8px)] left-1/2 z-50 flex w-[190px] -translate-x-1/2 flex-col gap-0.5 rounded-[12px] p-1"
                          style={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--glass-edge))',
                                   boxShadow: '0 12px 40px rgb(0 0 0 / 0.25)' }}>
                      {([['none', t('recNone')], ['system', t('recSystem')], ['both', t('recBoth')]] as const).map(([k, label]) => (
                        <button key={k} onClick={() => { setRecMenu(false); rec.start(k) }}
                                className="rounded-[9px] px-2.5 py-1.5 text-left text-[11.5px]">
                          {label}
                        </button>
                      ))}
                    </span>
                  )}
                </span>

                <Ctl onClick={async () => { await r.listDevices(); setDevOpen((v) => !v) }} title={t('devices')}>⚙</Ctl>
                <button onClick={hangUp}
                        className="h-9 rounded-[11px] px-4 text-[12.5px] font-semibold"
                        style={{ background: 'rgb(255 69 58 / 0.22)' }}>
                  {t('endCall')}
                </button>
              </div>
            )}

            {devOpen && (
              <div className="mt-2 flex flex-col gap-2 rounded-[14px] p-3" style={{ background: 'rgb(var(--fill))' }}>
                {(['videoinput', 'audioinput'] as const).map((kind) => (
                  <label key={kind} className="flex items-center gap-2 text-[11.5px]">
                    <span className="w-[80px] shrink-0" style={{ color: 'rgb(var(--ink-2))' }}>
                      {kind === 'videoinput' ? t('camera') : t('mic')}
                    </span>
                    <select onChange={(e) => r.useDevice(kind, e.target.value)}
                            className="h-8 min-w-0 flex-1 rounded-[9px] px-2 text-[11.5px] outline-none"
                            style={{ background: 'rgb(var(--glass))', color: 'rgb(var(--ink))' }}>
                      {r.devices.filter((d) => d.kind === kind).map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 12)}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <p className="text-[10.5px]" style={{ color: 'rgb(var(--ink-3))' }}>{t('devicesHint')}</p>
              </div>
            )}
          </div>

          <div className="flex min-w-[230px] flex-1 flex-col gap-2">
            <div ref={feed} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
              {items.length === 0 && (
                <div className="py-4 text-center text-[11.5px]" style={{ color: 'rgb(var(--ink-2))' }}>{t('emptyChat')}</div>
              )}
              {items.map((c: any) => c.kind === 'sys' ? (
                <div key={c.id} className="self-center text-[11px]" style={{ color: 'rgb(var(--ink-3))' }}>{c.text}</div>
              ) : (
                <div key={c.id}
                     className={`selectable max-w-[88%] rounded-[12px] px-2.5 py-1.5 text-[12px] ${c.mine ? 'self-end' : 'self-start'}`}
                     style={{ background: c.mine ? 'rgb(var(--accent) / 0.22)' : 'rgb(var(--fill))' }}>
                  {!c.mine && c.from && (
                    <span className="mb-0.5 block text-[10px]" style={{ color: 'rgb(var(--ink-2))' }}>{c.from}</span>
                  )}
                  {c.kind === 'text' ? c.text : (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="shrink-0 text-[10px]" style={{ color: 'rgb(var(--ink-2))' }}>{bytes(c.size)}</span>
                      </div>
                      {c.progress < 1
                        ? <div className="h-1 w-full overflow-hidden rounded-pill" style={{ background: 'rgb(var(--fill))' }}>
                            <div className="h-full rounded-pill" style={{ width: `${c.progress * 100}%`, background: 'rgb(var(--accent))' }} />
                          </div>
                        : c.url && <a href={c.url} download={c.name} className="text-[11px] underline">{t('saveFile')}</a>}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex shrink-0 gap-2">
              <button onClick={() => file.current?.click()} title={t('sendFile')}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] text-[15px]"
                      style={{ background: 'rgb(var(--fill))' }}>📎</button>
              <input ref={file} type="file" multiple hidden onChange={(e) => { drop(e.target.files); e.target.value = '' }} />
              <input value={text} onChange={(e) => setText(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { mode === 'server' ? r.send(text) : d.send(text); setText('') } }}
                     placeholder={t('message')}
                     className="selectable h-9 min-w-0 flex-1 rounded-[11px] px-3 text-[12.5px] outline-none"
                     style={{ background: 'rgb(var(--fill))', color: 'rgb(var(--ink))' }} />
            </div>
          </div>
        </div>
      )}

      {(rec.saved || rec.error) && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-[11px] px-3 py-1.5 text-[11.5px]"
             style={{ background: rec.error ? 'rgb(255 69 58 / 0.9)' : 'rgb(48 209 88 / 0.9)', color: '#fff' }}>
          {rec.error ? t('recFailed') : t('recSaved')}
        </div>
      )}

      {over && (
        <div className="pointer-events-none absolute inset-4 grid place-items-center rounded-[18px] text-[13px] font-medium"
             style={{ background: 'rgb(var(--accent) / 0.16)', border: '2px dashed rgb(var(--accent) / 0.7)' }}>
          {t('dropHere')}
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Chat />)
