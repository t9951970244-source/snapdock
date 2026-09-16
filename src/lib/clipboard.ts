import { useEffect } from 'react'

/**
 * Cmd+C, Cmd+V, Cmd+A и Cmd+X своими руками.
 *
 * Виджет запускается без значка в доке, а таким программам macOS не даёт
 * строки меню — вместе с ней пропадают и стандартные сочетания. События
 * клавиатуры до страницы при этом доходят, поэтому обрабатываем их сами
 * и ходим в буфер через главный процесс.
 */
export function useClipboardKeys() {
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
      const editable = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      const k = e.key.toLowerCase()

      if (k === 'v' && editable && !el!.readOnly) {
        e.preventDefault()
        const text = (await window.snap?.readText()) ?? ''
        if (!text) return
        const s = el!.selectionStart ?? el!.value.length
        const f = el!.selectionEnd ?? s
        const next = el!.value.slice(0, s) + text + el!.value.slice(f)
        // Ставим значение так, чтобы React увидел изменение
        const proto = el!.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, next)
        el!.dispatchEvent(new Event('input', { bubbles: true }))
        const pos = s + text.length
        el!.setSelectionRange(pos, pos)
        return
      }

      if (k === 'a' && editable) { e.preventDefault(); el!.select(); return }

      if (k === 'c' || k === 'x') {
        const sel = editable
          ? el!.value.slice(el!.selectionStart ?? 0, el!.selectionEnd ?? 0)
          : String(window.getSelection() ?? '')
        if (!sel) return
        e.preventDefault()
        await window.snap?.copyText(sel)
        if (k === 'x' && editable && !el!.readOnly) {
          const s = el!.selectionStart ?? 0, f = el!.selectionEnd ?? 0
          const next = el!.value.slice(0, s) + el!.value.slice(f)
          const proto = el!.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
          Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, next)
          el!.dispatchEvent(new Event('input', { bubbles: true }))
          el!.setSelectionRange(s, s)
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}
