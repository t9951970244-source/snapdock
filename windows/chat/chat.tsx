import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import '../../src/index.css'
import { usePeer, MAX_PEERS } from '../../src/hooks/usePeer'
import { useDirect } from '../../src/hooks/useDirect'
import { prefersDark } from '../../src/lib/color'
import { bytes } from '../../src/lib/format'
import { initLang, setLang, t, useLang } from '../../src/lib/i18n'
import { useClipboardKeys } from '../../src/lib/clipboard'

/** Плитка участника. Сетка сама подбирает число колонок под размер окна. */
function Tile({ stream, name, me }: { stream?: MediaStream; name: string; me?: boolean }) {
  const v = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (v.current && stream) v.current.srcObject = stream }, [stream])
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-[16px]"
         style={{ background: 'rgb(var(--fill))', boxShadow: '0 0 0 1px rgb(var(--glass-edge))' }}>
      {stream
        ? <video ref={v} autoPlay playsInline muted={me}
                 className={`h-full w-full object-cover ${me ? 'scale-x-[-1]' : ''}`} />
        : <div className="grid h-full w-full place-items-center text-[22px] font-semibold"
               style={{ color: 'rgb(var(--ink-3))' }}>{name.slice(0, 2).toUpperCase()}</div>}
      <span className="absolute bottom-2 left-2 rounded-[8px] px-2 py-0.5 text-[11px] font-medium text-white"
            style={{ background: 'rgb(0 0 0 / 0.45)', backdropFilter: 'blur(8px)' }}>
        {name}
      </span>
    </div>
  )
}

function Chat() {
  const p = usePeer()
  const [text, setText] = useState('')
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const d = useDirect()
  const [mode, setMode] = useState<'lan' | 'room' | 'direct'>('lan')
  const [inBox, setInBox] = useState('')
  const [copied, setCopied] = useState<'' | 'code' | 'pass' | 'invite'>('')
  const inviteBox = useRef<HTMLTextAreaElement>(null)
  const [fromClip, setFromClip] = useState(false)
  const [lan, setLan] = useState<any[]>([])
  const [incoming, setIncoming] = useState<{ token: string; offer: string; from: string } | null>(null)
  const [calling, setCalling] = useState<string | null>(null)

  /* Соседи в домашней сети: ищем сами, коды не нужны. */
  useEffect(() => {
    if (mode !== 'lan') return
    window.snap?.lanStart()
    const id = setInterval(async () => setLan((await window.snap?.lanPeers()) ?? []), 1500)
    return () => clearInterval(id)
  }, [mode])

  useEffect(() => window.snap?.onLanOffer(setIncoming), [])

  /** Мы зовём соседа: сами делаем приглашение, сами принимаем ответ. */
  const callPeer = async (id: string) => {
    if (!pw.trim()) { window.alert(t('lanNeedPass')); return }
    setCalling(id)
    try {
      const offer = await d.makeOfferBlob(pw)
      const answer = await window.snap?.lanInvite(id, offer)
      if (!answer) { d.setError(t('directFailed')); d.setPhase('failed'); return }
      d.setPhase('connecting')
      await d.applyAnswerBlob(answer)
    } catch (e: any) {
      d.setPhase('failed'); d.setError(String(e?.message ?? e))
    } finally { setCalling(null) }
  }

  /** Нас позвали: готовим ответ и отдаём его обратно по сети. */
  const acceptCall = async () => {
    if (!incoming) return
    if (!pw.trim()) { window.alert(t('lanNeedPass')); return }
    const inc = incoming
    setIncoming(null)
    d.setPhase('connecting')
    const answer = await d.makeAnswerBlob(pw, inc.offer)
    if (!answer) { d.setPhase('failed'); d.setError(t('badCode')); return }
    await window.snap?.lanAnswer(inc.token, answer)
  }

  /** Одна кнопка на оба случая: приглашение это или ответ, решает сам виджет. */
  const smart = async () => {
    const txt = inBox.trim()
    if (!txt || !pw.trim()) return
    const kind = await d.inspect(txt)
    if (kind === 'offer') return d.acceptOffer(pw, txt)
    if (kind === 'answer') return d.acceptAnswer(txt)
    window.alert(t('badCode'))
  }

  /** Три пути подряд: системный буфер, браузерный, выделение в поле. */
  const copyAny = async (text: string, mark: 'code' | 'pass' | 'invite') => {
    let done = false
    try { done = !!(await window.snap?.copyText(text)) } catch { /* дальше */ }
    if (!done) { try { await navigator.clipboard.writeText(text); done = true } catch { /* дальше */ } }
    if (!done && inviteBox.current) {
      inviteBox.current.focus(); inviteBox.current.select()
      try { done = document.execCommand('copy') } catch { /* всё */ }
    }
    setCopied(done ? mark : '')
    setTimeout(() => setCopied(''), 1800)
  }
  const flash = (what: 'code' | 'pass', value: string) => copyAny(value, what)

  /** Вставка из буфера кнопкой — на случай, если клавиши всё-таки недоступны. */
  const pasteInto = async (set: (v: string) => void) => {
    const text = (await window.snap?.readText()) ?? ''
    if (text.trim()) set(text.trim())
  }
  const [over, setOver] = useState(false)
  const feed = useRef<HTMLDivElement>(null)

  useLang()
  useClipboardKeys()
  useEffect(() => { document.documentElement.classList.toggle('theme-dark', prefersDark()) }, [])
  useEffect(() => {
    window.snap?.getLang().then((l) => (l ? setLang(l) : initLang()))
    return window.snap?.onLang(setLang)
  }, [])
  useEffect(() => { feed.current?.scrollTo({ top: 1e6, behavior: 'smooth' }) }, [p.chat.length])

  /* Пока открыт прямой режим — сами замечаем код в буфере и подставляем его. */
  useEffect(() => {
    if (mode !== 'direct' || d.phase === 'live' || d.phase === 'connecting') return
    const id = setInterval(async () => {
      const raw = (await window.snap?.readText()) ?? ''
      const clean = raw.replace(/\s+/g, '')
      if (clean.length < 200) return
      if (clean === d.code.replace(/\s+/g, '')) return      // это наш собственный код
      if (clean === inBox.replace(/\s+/g, '')) return       // уже подставлен
      // Подставляем, только если это действительно код SnapDock.
      // Раньше сюда падал любой скопированный текст — и поле забивалось мусором.
      if (!(await d.inspect(clean))) return
      setInBox(clean)
      setFromClip(true)
      setTimeout(() => setFromClip(false), 4000)
    }, 1200)
    return () => clearInterval(id)
  }, [mode, d.phase, d.code, inBox])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') window.snap?.closeChat() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const count = p.members.length + 1

  return (
    <div className="surface flex h-screen w-screen flex-col overflow-hidden rounded-[18px]"
         style={{ color: 'rgb(var(--ink))' }}>
      {/* шапка: за неё можно таскать окно */}
      <div className="flex shrink-0 items-center gap-3 px-4 py-3"
           style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <span className="text-[13px] font-semibold">{t('roomTitle')}</span>
        {!p.room && d.phase === 'idle' && (
          <span className="no-drag flex gap-0.5 rounded-[10px] p-0.5"
                style={{ background: 'rgb(var(--fill))', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {(['lan', 'room', 'direct'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                      className="rounded-[8px] px-2.5 py-1 text-[11px] font-medium"
                      style={{
                        background: mode === m ? 'rgb(var(--accent) / 0.28)' : 'transparent',
                        color: 'rgb(var(--ink))',
                      }}>
                {m === 'lan' ? t('modeLan') : m === 'room' ? t('modeRoom') : t('modeDirect')}
              </button>
            ))}
          </span>
        )}
        {d.phase === 'live' && (
          <span className="text-[11.5px]" style={{ color: 'rgb(var(--ink-2))' }}>{t('directLive')}</span>
        )}
        {p.room && (
          <button onClick={() => flash('code', p.room!)}
                  className="no-drag rounded-[9px] px-2 py-1 text-[11.5px] font-medium"
                  style={{ background: 'rgb(var(--fill))', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title={t('copyCodeHint')}>
            {copied === 'code' ? `${t('done')} ✓` : `${p.room} ⧉`}
          </button>
        )}
        {p.room && (
          <button onClick={() => flash('pass', p.pass)}
                  className="no-drag flex items-center gap-1.5 rounded-[9px] px-2 py-1 text-[11.5px] font-medium"
                  style={{ background: 'rgb(var(--accent) / 0.16)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title={t('copyPass')}>
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor"
                 strokeWidth="1.8" strokeLinecap="round">
              <rect x="4" y="8.6" width="12" height="8" rx="2.2" />
              <path d="M7 8.6V6.4a3 3 0 0 1 6 0v2.2" />
            </svg>
            {copied === 'pass' ? `${t('done')} ✓` : t('encrypted')}
          </button>
        )}
        <div className="flex-1" />
        {p.room && (
          <span className="text-[11.5px]" style={{ color: 'rgb(var(--ink-2))' }}>
            {count} {t('roomOf')} {MAX_PEERS}{p.status === 'live' ? ` · ${t('stLive')}` : ''}
          </span>
        )}
        {p.room && (
          <button onClick={p.leave} className="no-drag text-[11.5px]"
                  style={{ color: 'rgb(var(--ink-2))', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {t('leaveRoom')}
          </button>
        )}
        <button onClick={() => window.snap?.closeChat()} aria-label={t('close')}
                className="no-drag grid h-6 w-6 place-items-center rounded-full text-[15px]"
                style={{ background: 'rgb(var(--fill))', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          ✕
        </button>
      </div>

      {mode === 'lan' && d.phase !== 'live' ? (
        <div className="flex flex-1 flex-col items-center gap-3 overflow-y-auto px-8 py-6 text-center">
          <p className="max-w-[460px] text-[12.5px] leading-relaxed" style={{ color: 'rgb(var(--ink-2))' }}>
            {t('lanIntro')}
          </p>

          <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('password')}
                 className="h-10 w-[320px] rounded-[12px] px-3 text-center text-[12.5px] outline-none"
                 style={{ background: 'rgb(var(--fill))', color: 'rgb(var(--ink))' }} />

          {incoming && (
            <div className="flex w-[380px] flex-col gap-2 rounded-[14px] p-3"
                 style={{ background: 'rgb(48 209 88 / 0.16)' }}>
              <span className="text-[13px] font-semibold" style={{ color: 'rgb(var(--ink))' }}>
                {incoming.from} {t('lanIncoming')}
              </span>
              <div className="flex gap-2">
                <button onClick={acceptCall}
                        className="h-9 flex-[2] rounded-[11px] text-[12.5px] font-semibold"
                        style={{ background: 'rgb(48 209 88 / 0.35)' }}>
                  {t('lanAccept')}
                </button>
                <button onClick={() => setIncoming(null)}
                        className="h-9 flex-1 rounded-[11px] text-[12.5px]"
                        style={{ background: 'rgb(var(--fill))' }}>
                  {t('lanDecline')}
                </button>
              </div>
            </div>
          )}

          <div className="flex w-[380px] flex-col gap-2">
            {lan.length === 0 ? (
              <div className="flex items-center justify-center gap-2.5 py-6 text-[12px]"
                   style={{ color: 'rgb(var(--ink-2))' }}>
                <span className="h-3 w-3 rounded-full border-2 border-current border-r-transparent"
                      style={{ animation: 'spin 0.9s linear infinite' }} />
                {t('lanSearching')}
              </div>
            ) : lan.map((p2: any) => (
              <div key={p2.id} className="flex items-center gap-3 rounded-[13px] px-3 py-2.5"
                   style={{ background: 'rgb(var(--fill))' }}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-[12px] font-semibold"
                      style={{ background: 'rgb(var(--accent) / 0.25)', color: 'rgb(var(--ink))' }}>
                  {String(p2.name).slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1 truncate text-left text-[12.5px] font-medium"
                      style={{ color: 'rgb(var(--ink))' }}>{p2.name}</span>
                <button onClick={() => callPeer(p2.id)} disabled={calling === p2.id}
                        className="h-8 shrink-0 rounded-[10px] px-4 text-[12px] font-semibold disabled:opacity-40"
                        style={{ background: 'rgb(var(--accent) / 0.28)', color: 'rgb(var(--ink))' }}>
                  {calling === p2.id ? '…' : t('lanCall')}
                </button>
              </div>
            ))}
            {lan.length === 0 && (
              <p className="text-[11.5px]" style={{ color: 'rgb(var(--ink-3))' }}>{t('lanNobody')}</p>
            )}
          </div>

          {d.phase === 'connecting' && (
            <div className="flex items-center gap-2.5 text-[12.5px]" style={{ color: 'rgb(var(--ink))' }}>
              <span className="h-3 w-3 rounded-full border-2 border-current border-r-transparent"
                    style={{ animation: 'spin 0.9s linear infinite' }} />
              {t('connecting')}
            </div>
          )}
          {d.error && <p className="selectable max-w-[440px] text-[12px]" style={{ color: '#ff453a' }}>{d.error}</p>}
        </div>
      ) : mode === 'direct' && d.phase !== 'live' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-8 py-4 text-center">
          <p className="max-w-[460px] text-[12.5px] leading-relaxed" style={{ color: 'rgb(var(--ink-2))' }}>
            {t('directIntro')}
          </p>

          <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('password')}
                 className="h-10 w-[320px] rounded-[12px] px-3 text-[12.5px] outline-none"
                 style={{ background: 'rgb(var(--fill))', color: 'rgb(var(--ink))' }} />

          {/* Одно поле на оба случая: виджет сам понимает, что ему дали */}
          {d.phase !== 'connecting' && (
            <div className="flex w-[380px] flex-col gap-2">
              {d.phase === 'idle' && (
                <button onClick={() => pw.trim() && d.createOffer(pw)} disabled={!pw.trim()}
                        className="h-10 rounded-[12px] text-[13px] font-semibold disabled:opacity-40"
                        style={{ background: 'rgb(var(--accent) / 0.22)' }}>
                  {t('makeInvite')}
                </button>
              )}

              {(d.phase === 'madeOffer' || d.phase === 'madeAnswer') && (
                <>
                  <p className="text-[12px] font-medium" style={{ color: 'rgb(48 209 88)' }}>
                    ✓ {t('autoCopied')}
                  </p>
                  <p className="text-[12px]" style={{ color: 'rgb(var(--ink))' }}>
                    {d.phase === 'madeOffer' ? t('inviteReady') : t('answerReady')}
                  </p>
                  <textarea ref={inviteBox} readOnly value={d.code} rows={3}
                            onFocus={(e) => e.currentTarget.select()}
                            onClick={(e) => e.currentTarget.select()}
                            className="selectable resize-none rounded-[12px] p-3 text-[10px] outline-none"
                            style={{ background: 'rgb(var(--fill))', color: 'rgb(var(--ink-2))' }} />
                  <button onClick={() => copyAny(d.code, 'invite')}
                          className="h-10 rounded-[12px] text-[12.5px] font-semibold"
                          style={{ background: copied === 'invite' ? 'rgb(48 209 88 / 0.3)' : 'rgb(var(--accent) / 0.22)' }}>
                    {copied === 'invite' ? `${t('done')} ✓` : `${t('copyCode')} · ${d.code.length}`}
                  </button>
                </>
              )}

              {d.phase !== 'madeAnswer' && (
                <>
                  <div className="mt-1 h-px" style={{ background: 'rgb(var(--ink-3) / 0.4)' }} />
                  <p className="text-[12px]" style={{ color: 'rgb(var(--ink))' }}>
                    {d.phase === 'idle' ? t('gotInvite') : t('gotAnswer')}
                  </p>
                  <textarea value={inBox} onChange={(e) => setInBox(e.target.value)}
                            placeholder={t('pasteHere')} rows={3}
                            className="selectable resize-none rounded-[12px] p-3 text-[11px] outline-none"
                            style={{
                              background: fromClip ? 'rgb(48 209 88 / 0.16)' : 'rgb(var(--fill))',
                              color: 'rgb(var(--ink))',
                            }} />
                  <div className="flex gap-2">
                    <button onClick={() => pasteInto(setInBox)}
                            className="h-10 flex-1 rounded-[12px] text-[12.5px] font-medium"
                            style={{ background: 'rgb(var(--fill))' }}>
                      {t('pasteBtn')}
                    </button>
                    <button onClick={smart} disabled={!pw.trim() || !inBox.trim()}
                            className="h-10 flex-[2] rounded-[12px] text-[12.5px] font-semibold disabled:opacity-40"
                            style={{ background: 'rgb(var(--accent) / 0.22)' }}>
                      {t('connectNow')}
                    </button>
                  </div>
                  {fromClip && (
                    <p className="text-[11px]" style={{ color: 'rgb(48 209 88)' }}>{t('clipFound')}</p>
                  )}
                </>
              )}
            </div>
          )}

          {d.phase === 'connecting' && (
            <div className="flex items-center gap-2.5 text-[12.5px]" style={{ color: 'rgb(var(--ink))' }}>
              <span className="h-3 w-3 rounded-full border-2 border-current border-r-transparent"
                    style={{ animation: 'spin 0.9s linear infinite' }} />
              {t('connecting')}
            </div>
          )}
          {d.error && (
            <p className="selectable max-w-[440px] text-[12px]" style={{ color: '#ff453a' }}>{d.error}</p>
          )}
        </div>
      ) : (mode === 'direct' || mode === 'lan') ? (
        <div className="flex min-h-0 flex-1 gap-3 px-4 pb-4"
             onDragOver={(e) => e.preventDefault()}
             onDrop={(e) => { e.preventDefault(); Array.from(e.dataTransfer.files).forEach(d.sendFile) }}>
          <div className="min-w-0 flex-[3] overflow-y-auto">
            {d.noCam && (
              <button onClick={() => window.snap?.openCameraSettings()}
                      className="mb-2 w-full rounded-[12px] px-3 py-2 text-left text-[11.5px]"
                      style={{ background: 'rgb(255 159 10 / 0.18)', color: 'rgb(var(--ink))' }}>
                {t('noCamera')}
              </button>
            )}
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
              <Tile stream={d.mine ?? undefined} name={t('you')} me />
              <Tile stream={d.remote ?? undefined} name="—" />
            </div>
          </div>
          <div className="flex min-w-[220px] flex-1 flex-col gap-2">
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
              {d.chat.length === 0 && (
                <div className="py-4 text-center text-[11.5px]" style={{ color: 'rgb(var(--ink-2))' }}>
                  {t('emptyChat')}
                </div>
              )}
              {d.chat.map((c) => (
                <div key={c.id}
                     className={`selectable max-w-[88%] rounded-[12px] px-2.5 py-1.5 text-[12px] ${c.mine ? 'self-end' : 'self-start'}`}
                     style={{ background: c.mine ? 'rgb(var(--accent) / 0.22)' : 'rgb(var(--fill))' }}>
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
            <input value={text} onChange={(e) => setText(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { d.send(text); setText('') } }}
                   placeholder={t('message')}
                   className="h-9 shrink-0 rounded-[11px] px-3 text-[12.5px] outline-none"
                   style={{ background: 'rgb(var(--fill))', color: 'rgb(var(--ink))' }} />
          </div>
        </div>
      ) : !p.room ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="max-w-[420px] text-[12.5px] leading-relaxed" style={{ color: 'rgb(var(--ink-2))' }}>
            {t('roomIntro')}
          </p>
          <div className="flex w-[280px] gap-2">
            <input value={pw} onChange={(e) => setPw(e.target.value)} type="text"
                   placeholder={t('password')}
                   className="h-10 min-w-0 flex-1 rounded-[12px] px-3 text-[12.5px] outline-none"
                   style={{ background: 'rgb(var(--fill))', color: 'rgb(var(--ink))' }} />
            <button onClick={() => setPw(p.suggestPassword())}
                    className="h-10 shrink-0 rounded-[12px] px-3 text-[12px] font-medium"
                    style={{ background: 'rgb(var(--fill))' }}>
              {t('newPass')}
            </button>
          </div>

          <button onClick={() => p.join(undefined, pw)} disabled={!pw.trim()}
                  className="h-10 w-[280px] rounded-[12px] text-[13px] font-semibold disabled:opacity-40"
                  style={{ background: 'rgb(var(--accent) / 0.22)' }}>
            {t('createRoom')}
          </button>
          <div className="flex w-[280px] gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.trim())}
                   onDoubleClick={() => pasteInto(setCode)}
                   placeholder="snapdock-xxxx"
                   onKeyDown={(e) => e.key === 'Enter' && code && pw.trim() && p.join(code, pw)}
                   className="h-10 min-w-0 flex-1 rounded-[12px] px-3 text-[12.5px] outline-none"
                   style={{ background: 'rgb(var(--fill))', color: 'rgb(var(--ink))' }} />
            <button onClick={() => code && pw.trim() && p.join(code, pw)} disabled={!code || !pw.trim()}
                    className="h-10 shrink-0 rounded-[12px] px-4 text-[12.5px] font-medium disabled:opacity-40"
                    style={{ background: 'rgb(var(--fill))' }}>
              {t('joinRoom')}
            </button>
          </div>

          <p className="max-w-[420px] text-[11.5px] leading-relaxed" style={{ color: 'rgb(var(--ink-2))' }}>
            {t('passHint')}
          </p>
          {p.error && <p className="text-[12px]" style={{ color: '#ff453a' }}>{p.error}</p>}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 px-4 pb-4"
             onDragOver={(e) => { e.preventDefault(); setOver(true) }}
             onDragLeave={() => setOver(false)}
             onDrop={(e) => { e.preventDefault(); setOver(false); Array.from(e.dataTransfer.files).forEach(p.sendFile) }}>

          {/* сетка участников */}
          <div className="min-w-0 flex-[3] overflow-y-auto">
            {/* Что сейчас происходит — иначе окно выглядит мёртвым */}
            {p.status !== 'live' && (
              <div className="mb-3 flex items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-[12px]"
                   style={{
                     background: p.status === 'failed' ? 'rgb(255 69 58 / 0.14)' : 'rgb(var(--accent) / 0.14)',
                     color: 'rgb(var(--ink))',
                   }}>
                {p.status !== 'failed' && (
                  <span className="h-3 w-3 shrink-0 rounded-full border-2 border-current border-r-transparent"
                        style={{ animation: 'spin 0.9s linear infinite' }} />
                )}
                <span className="flex-1">
                  {p.status === 'signaling' ? t('stSignaling')
                    : p.status === 'waiting' ? t('stWaiting')
                    : p.error || t('stFailed')}
                </span>
                {p.status === 'failed' && (
                  <button onClick={() => { const r = p.room!, w = p.pass; p.leave(); setTimeout(() => p.join(r, w), 400) }}
                          className="shrink-0 rounded-[9px] px-2.5 py-1 text-[11.5px] font-medium"
                          style={{ background: 'rgb(var(--fill))' }}>
                    {t('retry')}
                  </button>
                )}
              </div>
            )}
            <div className="grid gap-2"
                 style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${count > 4 ? 150 : 210}px, 1fr))` }}>
              <Tile stream={p.localStream.current ?? undefined} name={t('you')} me />
              {p.members.map((m) => <Tile key={m.id} stream={m.stream} name={m.id.slice(-4)} />)}
            </div>
            {p.error && p.status === 'live' && (
              <div className="mt-2 text-[11.5px]" style={{ color: 'rgb(var(--ink-2))' }}>{p.error}</div>
            )}
          </div>

          {/* переписка */}
          <div className="flex min-w-[220px] flex-1 flex-col gap-2">
            <div ref={feed} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
              {p.chat.length === 0 && (
                <div className="py-4 text-center text-[11.5px]" style={{ color: 'rgb(var(--ink-2))' }}>
                  {t('emptyChat')}
                </div>
              )}
              {p.chat.map((c) => (
                <div key={c.id}
                     className={`max-w-[88%] rounded-[12px] px-2.5 py-1.5 text-[12px] ${c.mine ? 'self-end' : 'self-start'}`}
                     style={{ background: c.mine ? 'rgb(var(--accent) / 0.22)' : 'rgb(var(--fill))' }}>
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
            <input value={text} onChange={(e) => setText(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { p.send(text); setText('') } }}
                   placeholder={t('message')}
                   className="h-9 shrink-0 rounded-[11px] px-3 text-[12.5px] outline-none"
                   style={{ background: 'rgb(var(--fill))', color: 'rgb(var(--ink))' }} />
          </div>

          {over && (
            <div className="pointer-events-none absolute inset-4 grid place-items-center rounded-[18px] text-[13px] font-medium"
                 style={{ background: 'rgb(var(--accent) / 0.16)', border: '2px dashed rgb(var(--accent) / 0.7)' }}>
              {t('dropHere')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Chat />)
