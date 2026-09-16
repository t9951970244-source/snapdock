import { useEffect, useReducer } from 'react'

export type Lang = 'ru' | 'en'

/**
 * Словарь интерфейса. Русский — источник правды: если ключа нет в английском,
 * подставится русская строка, и дырки в переводе не превратятся в пустой экран.
 */
const dict = {
  ru: {
    /* кнопки виджета */
    area: 'Область',
    screen: 'Экран',
    copy: 'Копия',
    save: 'Сейв',
    room: 'Чат',

    hideNote: 'Виджет исчезнет на 0,25 с и не попадёт в кадр',
    tipArea: 'Выделить прямоугольник с лупой ×2.',
    tipScreen: 'Весь экран одним кликом.',
    tipCopy: 'Положить последний снимок в буфер обмена',
    tipSave: 'Сохранить в Изображения / SnapDock',
    tipNoShot: 'Сначала сделайте снимок',
    tipRoom: 'Комната на 8 человек: видео, чат, файлы напрямую между компьютерами',
    tipMixer: 'Громкость каждого приложения отдельно',
    tipQuit: 'Закрыть SnapDock',
    dragHint: 'тащите\nв чат',

    /* плеер */
    nothing: 'Ничего не играет',
    sysAudio: 'Системный звук',
    prev: 'Предыдущий трек',
    next: 'Следующий трек',
    play: 'Играть',
    pause: 'Пауза',
    mixer: 'Микшер',

    /* микшер */
    masterVol: 'Общая громкость',
    muted: 'без звука',
    mute: 'Выключить звук',
    unmute: 'Включить звук',
    noApps: 'Пока ни одно приложение не выводит звук.\nВключите музыку или видео — строка появится сама.',

    /* сообщения */
    copied: 'Скопировано в буфер',
    saved: 'Сохранено в Изображения / SnapDock',
    needShot: 'Сначала сделайте снимок',
    needPerm: 'Нужно разрешение на запись экрана — открываю настройки',
    shotFailed: 'Снимок не вышел. Проверьте разрешение на запись экрана',
    noAudio: 'Звук недоступен — проверьте разрешение на запись экрана',
    micAudio: 'Эквалайзер идёт с микрофона: системный звук недоступен',
    codeCopied: 'Код комнаты скопирован',

    /* комната */
    roomTitle: 'Комната',
    createRoom: 'Создать комнату',
    joinRoom: 'Войти',
    leaveRoom: 'Выйти',
    roomOf: 'из',
    you: 'Вы',
    message: 'Сообщение',
    dropHere: 'Отпустите — отправим всем',
    emptyChat: 'Перетащите файл в окно или напишите сообщение.',
    roomIntro:
      'Компьютеры соединяются напрямую. Ни видео, ни файлы не проходят через сервер. ' +
      'Поэтому история не сохраняется, а сообщение уходит только тем, кто сейчас в комнате. ' +
      'Войти можно только с паролем: без него участника отсекают до того, как он получит видео.',
    copyCodeHint: 'Скопировать код и отправить собеседнику',
    password: 'Пароль комнаты',
    passHint: 'Пароль по сети не передаётся. Отправьте его отдельно от кода — другим способом.',
    needPass: 'Без пароля комнату не создать',
    wrongPass: 'Неверный пароль — участник не допущен',
    newPass: 'Придумать',
    copyPass: 'Скопировать пароль',
    passCopied: 'Пароль скопирован',
    encrypted: 'Сообщения и файлы зашифрованы',
    done: 'Скопировано',
    micSource: 'Звук с микрофона',
    noSource: 'Нет доступа к звуку',
    fixPerm: 'Открыть настройки',
    stSignaling: 'Соединяюсь…',
    stWaiting: 'Вы первый в комнате. Отправьте собеседнику код и пароль.',
    stLive: 'на связи',
    stFailed: 'Соединиться не вышло',
    noBroker: 'Сервер знакомства не ответил. Это бесплатный общий сервер, он бывает перегружен — попробуйте ещё раз через минуту.',
    noRoom: 'Комната не найдена. Проверьте код: возможно, опечатка, или все уже вышли.',
    retry: 'Ещё раз',
    modeRoom: 'По коду комнаты',
    modeDirect: 'Напрямую, без сервера',
    directIntro: 'Сервер не участвует вообще. Вы создаёте код приглашения, отправляете его собеседнику любым способом, он присылает ответный код. Только на двоих.',
    makeInvite: 'Создать код приглашения',
    inviteReady: 'Отправьте этот код собеседнику и вставьте ниже его ответ',
    answerReady: 'Отправьте этот код обратно — и связь установится',
    pasteInvite: 'Вставьте код приглашения',
    pasteAnswer: 'Вставьте ответный код',
    accept: 'Принять',
    connectNow: 'Соединить',
    copyCode: 'Скопировать код',
    badCode: 'Код не распознан. Скопируйте его целиком, без пробелов по краям.',
    directFailed: 'Прямая связь не установилась. Обычно мешает строгий роутер или корпоративная сеть.',
    directLive: 'Связь установлена напрямую',
    saveFile: 'Сохранить',
    lostLink: 'Связь потеряна. Комната та же, нажмите «Переподключить».',

    /* выбор области */
    overlayHint: 'Протяните рамку · Enter — снять · Esc или правая кнопка — отмена',

    /* редактор */
    crop: 'Обрезать',
    arrow: 'Стрелка',
    text: 'Текст',
    blur: 'Размыть',
    undo: 'Отменить',
    doCopy: 'Копировать',
    doSave: 'Сохранить',
    close: 'Закрыть',
    textPrompt: 'Текст на снимке',
  },

  en: {
    area: 'Area',
    screen: 'Screen',
    copy: 'Copy',
    save: 'Save',
    room: 'Room',

    hideNote: 'The widget hides for 0.25 s and stays out of the frame',
    tipArea: 'Drag a rectangle with a ×2 loupe.',
    tipScreen: 'The whole screen in one click.',
    tipCopy: 'Put the last shot on the clipboard',
    tipSave: 'Save to Pictures / SnapDock',
    tipNoShot: 'Take a screenshot first',
    tipRoom: 'A room for 8: video, chat and files straight between computers',
    tipMixer: 'A separate volume for every app',
    tipQuit: 'Quit SnapDock',
    dragHint: 'drag\nto send',

    nothing: 'Nothing playing',
    sysAudio: 'System audio',
    prev: 'Previous track',
    next: 'Next track',
    play: 'Play',
    pause: 'Pause',
    mixer: 'Mixer',

    masterVol: 'Master volume',
    muted: 'muted',
    mute: 'Mute',
    unmute: 'Unmute',
    noApps: 'No app is playing anything yet.\nStart some music or a video and it will show up here.',

    copied: 'Copied to clipboard',
    saved: 'Saved to Pictures / SnapDock',
    needShot: 'Take a screenshot first',
    needPerm: 'Screen recording permission is needed — opening settings',
    shotFailed: 'The shot failed. Check the screen recording permission',
    noAudio: 'No audio — check the screen recording permission',
    micAudio: 'Equalizer is running off the microphone: system audio is unavailable',
    codeCopied: 'Room code copied',

    roomTitle: 'Room',
    createRoom: 'Create a room',
    joinRoom: 'Join',
    leaveRoom: 'Leave',
    roomOf: 'of',
    you: 'You',
    message: 'Message',
    dropHere: 'Drop it — everyone gets it',
    emptyChat: 'Drop a file into the window or write a message.',
    roomIntro:
      'The computers connect directly. Neither video nor files pass through a server. ' +
      'So there is no history, and a message only reaches whoever is in the room right now. ' +
      'The password is the door: without it a person is cut off before any video reaches them.',
    copyCodeHint: 'Copy the code and send it to the other person',
    password: 'Room password',
    passHint: 'The password never travels over the network. Send it separately from the code, by another route.',
    needPass: 'A room needs a password',
    wrongPass: 'Wrong password — that person was not let in',
    newPass: 'Suggest one',
    copyPass: 'Copy the password',
    passCopied: 'Password copied',
    encrypted: 'Messages and files are encrypted',
    done: 'Copied',
    micSource: 'Audio from the microphone',
    noSource: 'No access to audio',
    fixPerm: 'Open settings',
    stSignaling: 'Connecting…',
    stWaiting: 'You are first in the room. Send the other person the code and the password.',
    stLive: 'connected',
    stFailed: 'Could not connect',
    noBroker: 'The rendezvous server did not answer. It is a free shared server and gets overloaded — try again in a minute.',
    noRoom: 'Room not found. Check the code: a typo, or everyone has already left.',
    retry: 'Try again',
    modeRoom: 'By room code',
    modeDirect: 'Direct, no server',
    directIntro: 'No server is involved at all. You create an invitation code, send it to the other person any way you like, and they send back a reply code. Two people only.',
    makeInvite: 'Create an invitation code',
    inviteReady: 'Send this code to the other person and paste their reply below',
    answerReady: 'Send this code back and the link is up',
    pasteInvite: 'Paste the invitation code',
    pasteAnswer: 'Paste the reply code',
    accept: 'Accept',
    connectNow: 'Connect',
    copyCode: 'Copy the code',
    badCode: 'Could not read the code. Copy all of it, with no stray spaces.',
    directFailed: 'The direct link did not come up. A strict router or a corporate network is the usual cause.',
    directLive: 'Connected directly',
    saveFile: 'Save',
    lostLink: 'Connection lost. Same room — press Reconnect.',

    overlayHint: 'Drag a frame · Enter to capture · Esc or right click to cancel',

    crop: 'Crop',
    arrow: 'Arrow',
    text: 'Text',
    blur: 'Blur',
    undo: 'Undo',
    doCopy: 'Copy',
    doSave: 'Save',
    close: 'Close',
    textPrompt: 'Text on the shot',
  },
} as const

export type Key = keyof typeof dict.ru

let current: Lang = 'ru'
const subs = new Set<() => void>()

export function t(key: Key): string {
  return (dict[current] as Record<string, string>)[key] ?? dict.ru[key]
}

export function getLang() { return current }

export function setLang(l: Lang) {
  if (l === current) return
  current = l
  document.documentElement.lang = l
  subs.forEach((f) => f())
}

/** Первый запуск: берём язык системы, всё нерусское считаем английским. */
export function initLang(locale?: string) {
  const l = (locale ?? navigator.language ?? 'ru').toLowerCase()
  setLang(l.startsWith('ru') ? 'ru' : 'en')
}

/** Перерисовывает компонент, когда язык переключили из меню в трее. */
export function useLang(): Lang {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    subs.add(bump)
    return () => { subs.delete(bump) }
  }, [])
  return current
}
