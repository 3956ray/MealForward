import {useState} from 'react'

export function Scanner({disabled, onCode, onError}: {disabled: boolean; onCode: (value: string) => void; onError: (value: string) => void}) {
  const [busy, setBusy] = useState(false)
  async function decode(file?: File) {
    if (!file || disabled || busy) return
    setBusy(true)
    try {
      if (file.size > 5*1024*1024 || !file.type.startsWith('image/')) throw new Error('请选择小于 5 MB 的二维码图片')
      const bitmap = await createImageBitmap(file)
      try {
        const scale = Math.min(1, 1600/Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width*scale)); canvas.height = Math.max(1, Math.round(bitmap.height*scale))
        const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('当前浏览器无法解码图片，请手输展示码')
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const {default: jsQR} = await import('jsqr')
        const result = jsQR(pixels.data, pixels.width, pixels.height)
        if (!result || !/^mealforward:manual:v1:[A-Za-z0-9_-]{32}$/.test(result.data)) throw new Error('没有识别到本轮到店码，请重新展示或手输六位码')
        onCode(result.data)
      } finally {bitmap.close()}
    } catch (e) {onError(e instanceof Error ? e.message : '图片无法解码')}
    finally {setBusy(false)}
  }
  return <label>读取到店二维码图片（仅在本机解码）<input type="file" accept="image/*" disabled={disabled || busy} onChange={e => {void decode(e.target.files?.[0]); e.target.value = ''}}/></label>
}
