import { spawn, ChildProcess } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Громкость на Windows без единого стороннего файла.
 *
 * Общая громкость и громкость каждой программы живут в Core Audio — это COM,
 * из JavaScript туда хода нет. Зато PowerShell умеет собирать код на C# прямо
 * на лету: мы один раз поднимаем процесс, он компилирует внутри себя обёртку
 * над Core Audio и дальше просто ждёт команды строкой. Запуск занимает секунду,
 * каждая следующая команда — миллисекунды.
 *
 * Если PowerShell заблокирован политикой, остаётся запасной путь: эмуляция
 * мультимедийных клавиш. Она умеет только «тише-громче», без точного значения,
 * но работает всегда.
 */

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Diagnostics;

public static class Snap {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class DevEnum { }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int NotImpl1(); int NotImpl2();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ep);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  }

  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int NotImpl1(); int NotImpl2(); int NotImpl3(); int NotImpl4();
    int SetMasterVolumeLevelScalar(float level, ref Guid ev);
    int GetMasterVolumeLevelScalar(out float level);
    int NotImpl5(); int NotImpl6();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ev);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int NotImpl1(); int NotImpl2();
    int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int i, out IAudioSessionControl s);
  }

  [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl {
    int GetState(out int state);
    int NotImpl1(); int NotImpl2(); int NotImpl3(); int NotImpl4();
    int NotImpl5(); int NotImpl6(); int NotImpl7(); int NotImpl8();
  }

  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int state);
    int NotImpl1(); int NotImpl2(); int NotImpl3(); int NotImpl4();
    int NotImpl5(); int NotImpl6(); int NotImpl7(); int NotImpl8();
    int NotImpl9(); int NotImpl10();
    int GetProcessId(out int pid);
  }

  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    int SetMasterVolume(float level, ref Guid ev);
    int GetMasterVolume(out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ev);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  static Guid NO_EVENT = Guid.Empty;

  static IMMDevice Device() {
    var en = (IMMDeviceEnumerator)(new DevEnum() as object);
    IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);   // 0 = вывод, 1 = мультимедиа
    return dev;
  }
  static T Activate<T>(IMMDevice dev, string iid) {
    var g = new Guid(iid); object o;
    dev.Activate(ref g, 23, IntPtr.Zero, out o);                // 23 = CLSCTX_ALL
    return (T)o;
  }

  public static float GetMaster() {
    var v = Activate<IAudioEndpointVolume>(Device(), "5CDF2C82-841E-4546-9722-0CF74078229A");
    float lvl; v.GetMasterVolumeLevelScalar(out lvl); return lvl;
  }
  public static void SetMaster(float lvl) {
    var v = Activate<IAudioEndpointVolume>(Device(), "5CDF2C82-841E-4546-9722-0CF74078229A");
    v.SetMasterVolumeLevelScalar(lvl, ref NO_EVENT);
  }
  public static void SetMasterMute(bool m) {
    var v = Activate<IAudioEndpointVolume>(Device(), "5CDF2C82-841E-4546-9722-0CF74078229A");
    v.SetMute(m, ref NO_EVENT);
  }

  public static string List() {
    var mgr = Activate<IAudioSessionManager2>(Device(), "77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    IAudioSessionEnumerator en; mgr.GetSessionEnumerator(out en);
    int n; en.GetCount(out n);
    var rows = new List<string>();
    for (int i = 0; i < n; i++) {
      IAudioSessionControl s; en.GetSession(i, out s);
      var s2 = (IAudioSessionControl2)s;
      int pid; s2.GetProcessId(out pid);
      if (pid == 0) continue;
      string name;
      try { name = Process.GetProcessById(pid).ProcessName; } catch { continue; }
      var vol = (ISimpleAudioVolume)s;
      float lvl; vol.GetMasterVolume(out lvl);
      bool mute; vol.GetMute(out mute);
      int state; s2.GetState(out state);              // 1 = сейчас звучит
      rows.Add("{\"id\":\"" + pid + "\",\"name\":\"" + name.Replace("\\", "").Replace("\"", "") +
               "\",\"volume\":" + lvl.ToString(System.Globalization.CultureInfo.InvariantCulture) +
               ",\"muted\":" + (mute ? "true" : "false") +
               ",\"active\":" + (state == 1 ? "true" : "false") + "}");
    }
    return "[" + string.Join(",", rows.ToArray()) + "]";
  }

  static ISimpleAudioVolume Find(int pid) {
    var mgr = Activate<IAudioSessionManager2>(Device(), "77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    IAudioSessionEnumerator en; mgr.GetSessionEnumerator(out en);
    int n; en.GetCount(out n);
    for (int i = 0; i < n; i++) {
      IAudioSessionControl s; en.GetSession(i, out s);
      int p; ((IAudioSessionControl2)s).GetProcessId(out p);
      if (p == pid) return (ISimpleAudioVolume)s;
    }
    return null;
  }
  public static void SetApp(int pid, float lvl) {
    var v = Find(pid); if (v != null) v.SetMasterVolume(lvl, ref NO_EVENT);
  }
  public static void MuteApp(int pid, bool m) {
    var v = Find(pid); if (v != null) v.SetMute(m, ref NO_EVENT);
  }
}
"@
# Доступ к транспорту любого плеера: название, артист, кнопки.
# Оборачиваем в try — если WinRT недоступен, звук всё равно должен работать.
$NP = $false
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + [char]96 + '1') })[0]
  function Await($task, $type) {
    $m = $asTaskGeneric.MakeGenericMethod($type)
    $t = $m.Invoke($null, @($task)); $t.Wait(-1) | Out-Null; $t.Result
  }
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null
  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $propType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  $SMTC = Await ($mgrType::RequestAsync()) ($mgrType)
  $NP = $true
} catch { $NP = $false }

function Esc($x) { if ($null -eq $x) { '' } else { ([string]$x).Replace('\', '').Replace('"', '') } }

function NowPlaying {
  if (-not $NP) { return '{}' }
  $s = $SMTC.GetCurrentSession()
  if ($null -eq $s) { return '{}' }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ($propType)
  $t = $s.GetTimelineProperties()
  $b = $s.GetPlaybackInfo()
  '{"source":"' + (Esc $s.SourceAppUserModelId) + '","title":"' + (Esc $p.Title) +
  '","artist":"' + (Esc $p.Artist) + '","album":"' + (Esc $p.AlbumTitle) +
  '","playing":' + $(if ($b.PlaybackStatus -eq 4) { 'true' } else { 'false' }) +
  ',"position":' + [math]::Round($t.Position.TotalSeconds, 1) +
  ',"duration":' + [math]::Round($t.EndTime.TotalSeconds, 1) + ',"canSeek":true}'
}

function MediaCmd($c) {
  if (-not $NP) { return }
  $s = $SMTC.GetCurrentSession(); if ($null -eq $s) { return }
  switch ($c) {
    'play'   { $s.TryPlayAsync()            | Out-Null }
    'pause'  { $s.TryPauseAsync()           | Out-Null }
    'toggle' { $s.TryTogglePlayPauseAsync() | Out-Null }
    'next'   { $s.TrySkipNextAsync()        | Out-Null }
    'prev'   { $s.TrySkipPreviousAsync()    | Out-Null }
  }
}

[Console]::Out.WriteLine("READY")
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $a = $line.Split(' ')
  try {
    switch ($a[0]) {
      'list'    { [Console]::Out.WriteLine([Snap]::List()) }
      'get'     { [Console]::Out.WriteLine([Snap]::GetMaster()) }
      'master'  { [Snap]::SetMaster([float]$a[1]); [Console]::Out.WriteLine('ok') }
      'mmute'   { [Snap]::SetMasterMute([bool]::Parse($a[1])); [Console]::Out.WriteLine('ok') }
      'app'     { [Snap]::SetApp([int]$a[1], [float]$a[2]); [Console]::Out.WriteLine('ok') }
      'amute'   { [Snap]::MuteApp([int]$a[1], [bool]::Parse($a[2])); [Console]::Out.WriteLine('ok') }
      'np'      { [Console]::Out.WriteLine((NowPlaying)) }
      'mc'      { MediaCmd $a[1]; [Console]::Out.WriteLine('ok') }
      default   { [Console]::Out.WriteLine('?') }
    }
  } catch { [Console]::Out.WriteLine('err') }
}
`

let proc: ChildProcess | null = null
let ready = false
let queue: ((line: string) => void)[] = []
let buffer = ''

async function ensure(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  if (proc && !proc.killed) return ready

  const dir = join(tmpdir(), 'snapdock')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'audio.ps1')
  await writeFile(file, PS_SCRIPT, 'utf8')

  proc = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })

  proc.stdout!.setEncoding('utf8')
  proc.stdout!.on('data', (chunk: string) => {
    buffer += chunk
    let i: number
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (line === 'READY') { ready = true; continue }
      queue.shift()?.(line)
    }
  })
  proc.on('exit', () => { proc = null; ready = false; queue = [] })

  // Сборка обёртки занимает около секунды — ждём её один раз за запуск
  for (let i = 0; i < 60 && !ready; i++) await new Promise((r) => setTimeout(r, 100))
  return ready
}

function ask(cmd: string, timeout = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    if (!proc?.stdin) return resolve(null)
    const timer = setTimeout(() => resolve(null), timeout)
    queue.push((line) => { clearTimeout(timer); resolve(line) })
    proc.stdin.write(cmd + '\n')
  })
}

/** Запасной путь: мультимедийные клавиши. Точное значение не выставить, но работает везде. */
function nudge(up: boolean) {
  const key = up ? 175 : 174
  spawn('powershell.exe',
    ['-NoProfile', '-Command', `(New-Object -ComObject WScript.Shell).SendKeys([char]${key})`],
    { windowsHide: true, stdio: 'ignore' })
}

export async function winReady() { return ensure() }

export async function winSessions() {
  if (!(await ensure())) return []
  const out = await ask('list')
  if (!out || !out.startsWith('[')) return []
  try {
    return (JSON.parse(out) as any[]).map((s) => ({
      id: String(s.id), name: String(s.name), process: String(s.name),
      volume: Math.max(0, Math.min(1, Number(s.volume) || 0)),
      muted: !!s.muted, active: !!s.active, icon: null as string | null,
    }))
  } catch { return [] }
}

export async function winGetMaster() {
  if (!(await ensure())) return null
  const out = await ask('get')
  const v = Number(String(out).replace(',', '.'))
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null
}

export async function winSetMaster(v: number, prev?: number) {
  if (!(await ensure())) { nudge(prev === undefined ? true : v > prev); return false }
  await ask(`master ${v.toFixed(3)}`)
  return true
}
export async function winSetMasterMute(m: boolean) {
  if (!(await ensure())) return false
  await ask(`mmute ${m ? 'true' : 'false'}`)
  return true
}
export async function winSetApp(pid: string, v: number) {
  if (!(await ensure())) return false
  await ask(`app ${pid} ${v.toFixed(3)}`)
  return true
}
export async function winMuteApp(pid: string, m: boolean) {
  if (!(await ensure())) return false
  await ask(`amute ${pid} ${m ? 'true' : 'false'}`)
  return true
}
/** Что играет прямо сейчас — из транспорта Windows, без сторонних файлов. */
export async function winNowPlaying(): Promise<any | null> {
  if (!(await ensure())) return null
  const out = await ask('np')
  if (!out || !out.startsWith('{') || out === '{}') return null
  try { return JSON.parse(out) } catch { return null }
}

export async function winMediaCommand(cmd: string) {
  if (!(await ensure())) return false
  await ask(`mc ${cmd}`)
  return true
}

export function winStop() { proc?.kill(); proc = null; ready = false }
