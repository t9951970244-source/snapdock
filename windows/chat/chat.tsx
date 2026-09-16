import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import '../../src/index.css'
import { usePeer, MAX_PEERS } from '../../src/hooks/usePeer'
import { prefersDark } from '../../src/lib/color'
import { bytes } from '../../src/lib/format'
import { initLang, setLang, t, useLang } from '../../src/lib/i18n'

/** Плитка участника. Сетка сама подбирает число колонок под размер окна. */
function Tile({ stream, name, me }: { stream?: MediaStream; name: string; me?: boolean }) {
  const v = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (v.current && stream) v.current.srcObject = stream }, [stream])
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-[16px]"
         style={{ background: 'rgb(var(--fill))', boxShadow: '0 0 0 1px rgb(var(--glass-edge))' }}>
      {stream
        ? <video ref={v} autoPlay playsInline muted={me} className="h-full w-full scale-x-[-1] object-cover" />
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
  const [copied, setCopied] = useState<'' | 'code' | 'pass'>('')
  const flash = (what: 'code' | 'pass', value: string) => {
    window.snap?.copyText(value)
    setCopied(what)
    setTimeout(() => setCopied(''), 1600)
  }
  const [over, setOver] = useState(false)
  const feed = useRef<HTMLDivElement>(null)

  useLang()
  useEffect(() => { document.documentElement.classList.toggle('theme-dark', prefersDark()) }, [])
  useEffect(() => {
    window.snap?.getLang().then((l) => (l ? setLang(l) : initLang()))
    return window.snap?.onLang(setLang)
  }, [])
  useEffect(() => { feed.current?.scrollTo({ top: 1e6, behavior: 'smooth' }) }, [p.chat.length])
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

      {!p.room ? (
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
