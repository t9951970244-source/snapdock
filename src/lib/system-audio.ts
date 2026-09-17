/**
 * Один общий захват системного звука.
 *
 * Система отдаёт звук компьютера только одному желающему. Раньше его забирал
 * эквалайзер при запуске, и запись экрана оставалась без звука — молча, без
 * единой ошибки. Теперь захват один, а желающие получают собственные копии
 * дорожки: и полоски рисуются, и в записи есть звук.
 */

let shared: MediaStream | null = null
let pending: Promise<MediaStream | null> | null = null

async function acquire(): Promise<MediaStream | null> {
  if (shared?.getAudioTracks().some((t) => t.readyState === 'live')) return shared
  try {
    // Видео просим крошечное, но просим: без него Windows отдаёт тишину
    const st = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 4, height: 4, frameRate: 1 } as MediaTrackConstraints,
      audio: true,
    })
    st.getVideoTracks().forEach((t) => t.stop())   // картинка здесь не нужна ни кадра
    shared = st
    return st
  } catch {
    shared = null
    return null
  }
}

/** Копия дорожки системного звука. Null — если система его не отдала. */
export async function systemAudioTrack(): Promise<MediaStreamTrack | null> {
  if (!pending) pending = acquire().finally(() => { pending = null })
  const st = await pending
  const a = st?.getAudioTracks().find((t) => t.readyState === 'live')
  try { return a ? a.clone() : null } catch { return a ?? null }
}

/** Есть ли вообще системный звук на этой машине. */
export async function hasSystemAudio(): Promise<boolean> {
  return !!(await systemAudioTrack())
}

export function releaseSystemAudio() {
  shared?.getTracks().forEach((t) => t.stop())
  shared = null
}
