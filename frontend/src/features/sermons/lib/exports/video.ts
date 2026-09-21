// Ported from the original sermon builder's narration video renderer.
// Draws the sermon visuals onto a canvas with cross-fades while the recorded
// narration plays, captures canvas + audio with MediaRecorder, and returns a
// WebM (or MP4 where WebM recording is unsupported) blob.

export interface VideoConfig {
  audioBlob: Blob
  /** Image URLs (same-origin signed URLs) used as the visual backdrop, in order. */
  images: string[]
  title: string
  onProgress?: (pct: number) => void
  /** Measured recording length (s) — used when the WebM blob reports Infinity. */
  fallbackDurationSec?: number
}

async function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

export async function renderAudioVideo({
  audioBlob,
  images,
  title,
  onProgress,
  fallbackDurationSec,
}: VideoConfig): Promise<Blob> {
  const WIDTH = 1280
  const HEIGHT = 720

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Video recording is not supported in this browser')
  }

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  if (typeof canvas.captureStream !== 'function') {
    throw new Error('Canvas video capture is not supported in this browser')
  }
  const ctx = canvas.getContext('2d')!

  // Load images
  const imgElements: HTMLImageElement[] = []
  for (const url of images) {
    if (!url) continue
    try {
      const el = await loadImageElement(url)
      imgElements.push(el)
    } catch {
      // skip unloadable image
    }
  }

  // Determine audio duration
  const audioUrl = URL.createObjectURL(audioBlob)
  const audioEl = new Audio(audioUrl)
  let audioContext: AudioContext | null = null
  const cleanup = () => {
    URL.revokeObjectURL(audioUrl)
    if (audioContext && audioContext.state !== 'closed') void audioContext.close()
  }

  try {
    // MediaRecorder WebM blobs commonly report duration === Infinity until the
    // browser is forced to seek to the end. Resolve a real, finite duration
    // (falling back to the measured length captured during recording).
    const rawDuration = await new Promise<number>((resolve, reject) => {
      audioEl.onerror = () => reject(new Error('Could not load the recorded audio'))
      audioEl.onloadedmetadata = () => {
        if (audioEl.duration === Infinity || isNaN(audioEl.duration)) {
          audioEl.ontimeupdate = () => {
            audioEl.ontimeupdate = null
            const d = audioEl.duration
            audioEl.currentTime = 0
            resolve(Number.isFinite(d) ? d : (fallbackDurationSec ?? 0))
          }
          audioEl.currentTime = 1e101 // force the browser to compute the duration
        } else {
          resolve(audioEl.duration)
        }
      }
      audioEl.load()
    })
    const audioDuration = Number.isFinite(rawDuration) && rawDuration > 0
      ? rawDuration
      : (fallbackDurationSec && fallbackDurationSec > 0 ? fallbackDurationSec : 60)

    // Set up MediaRecorder on canvas stream
    const canvasStream = canvas.captureStream(30)

    // Mix audio into the stream
    audioContext = new AudioContext()
    const audioSource = audioContext.createMediaElementSource(audioEl)
    const streamDestination = audioContext.createMediaStreamDestination()
    audioSource.connect(streamDestination)
    audioSource.connect(audioContext.destination)

    // Combine video + audio tracks
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...streamDestination.stream.getAudioTracks(),
    ])

    // Pick the best supported container/codec
    const mimeType = pickVideoMimeType()

    const chunks: BlobPart[] = []
    const recorder = new MediaRecorder(combinedStream, { mimeType })
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

    // Image per second allocation
    const imgDwell = imgElements.length > 0 ? audioDuration / imgElements.length : audioDuration
    let startTime: number | null = null
    let animFrameId: number

    function drawFrame(ts: number) {
      if (!startTime) startTime = ts
      const elapsed = (ts - startTime) / 1000

      // Determine current image
      const imgIndex = Math.min(Math.floor(elapsed / imgDwell), imgElements.length - 1)
      const nextIndex = Math.min(imgIndex + 1, imgElements.length - 1)

      // Cross-fade factor (last 0.5s of each image)
      const timeInSlide = elapsed - imgIndex * imgDwell
      const fadeStart = imgDwell - 0.5
      const alpha = timeInSlide > fadeStart && nextIndex !== imgIndex
        ? (timeInSlide - fadeStart) / 0.5
        : 0

      // Clear
      ctx.fillStyle = '#070E1D'
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      if (imgElements.length > 0) {
        // Draw current image (cover)
        drawCoverImage(ctx, imgElements[imgIndex], WIDTH, HEIGHT)

        if (alpha > 0 && nextIndex !== imgIndex) {
          ctx.globalAlpha = Math.min(alpha, 1)
          drawCoverImage(ctx, imgElements[nextIndex], WIDTH, HEIGHT)
          ctx.globalAlpha = 1
        }
      } else {
        // No images — gradient background
        const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
        grad.addColorStop(0, '#13223F')
        grad.addColorStop(1, '#0B1426')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
      }

      // Semi-transparent overlay for text readability
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(0, HEIGHT - 120, WIDTH, 120)

      // Title text
      ctx.fillStyle = '#F7F5EF'
      ctx.font = 'bold 32px Georgia, serif'
      ctx.textAlign = 'center'
      ctx.fillText(title, WIDTH / 2, HEIGHT - 65)

      // Progress bar
      const progress = Math.min(elapsed / audioDuration, 1)
      ctx.fillStyle = 'rgba(255,255,255,0.2)'
      ctx.fillRect(40, HEIGHT - 30, WIDTH - 80, 6)
      ctx.fillStyle = '#E3B448'
      ctx.fillRect(40, HEIGHT - 30, (WIDTH - 80) * progress, 6)

      onProgress?.(Math.round(progress * 100))

      if (elapsed < audioDuration) {
        animFrameId = requestAnimationFrame(drawFrame)
      }
    }

    return await new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        cleanup()
        resolve(new Blob(chunks, { type: mimeType }))
      }
      recorder.onerror = (e) => {
        cancelAnimationFrame(animFrameId)
        cleanup()
        reject(e)
      }

      recorder.start(100) // collect data every 100ms

      audioEl.play().then(() => {
        animFrameId = requestAnimationFrame(drawFrame)
      }).catch((err) => {
        recorder.stop()
        reject(err)
      })

      audioEl.onended = () => {
        cancelAnimationFrame(animFrameId)
        recorder.stop()
      }

      // Safety timeout
      setTimeout(() => {
        if (recorder.state === 'recording') {
          cancelAnimationFrame(animFrameId)
          recorder.stop()
        }
      }, (audioDuration + 3) * 1000)
    })
  } catch (err) {
    cleanup()
    throw err
  }
}

const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
]

/** The first container/codec MediaRecorder can produce in this browser. */
export function pickVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return 'video/webm'
  return VIDEO_MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm'
}

/** File extension for a recorded blob's MIME type. */
export function extensionForMime(mime: string): string {
  return mime.includes('mp4') ? 'mp4' : 'webm'
}

function drawCoverImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number) {
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight)
  const sw = img.naturalWidth * scale
  const sh = img.naturalHeight * scale
  const sx = (W - sw) / 2
  const sy = (H - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh)
}
