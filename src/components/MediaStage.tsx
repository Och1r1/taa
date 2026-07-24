import { useEffect, useRef, useState } from 'react'
import type { Song } from '../types'
import { useAudioSnippet } from '../audio/useAudioSnippet'

interface Props {
  item: Song
  revealed: boolean
}

/** Presents the round's media (audio / video / image) and controls playback. */
export function MediaStage({ item, revealed }: Props) {
  if (item.mediaType === 'image') return <ImageStage item={item} />
  if (item.mediaType === 'video') return <VideoStage item={item} revealed={revealed} />
  return <AudioStage item={item} revealed={revealed} />
}

const CARD =
  'mb-8 flex flex-col items-center rounded-3xl border border-border bg-gradient-to-b from-surface to-base'

function AudioStage({ item, revealed }: Props) {
  const { play, stop, isPlaying } = useAudioSnippet()

  const playSnippet = () =>
    void play({ url: item.mediaUrl, start: item.snippetStart, duration: item.snippetDuration })

  useEffect(() => {
    if (revealed) {
      stop()
      return
    }
    playSnippet()
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, revealed])

  const active = isPlaying && !revealed

  return (
    <div className={`${CARD} gap-5 py-14`}>
      <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-muted-2">
        Одоо тоглож байна
      </div>
      <div className={`wave wave-lg ${active ? '' : 'paused'}`} aria-hidden="true">
        {WAVE_BARS.map((bar, i) => (
          <span key={i} style={{ height: `${bar.height}%`, animationDelay: `${bar.delay}s` }} />
        ))}
      </div>
      <button
        onClick={playSnippet}
        aria-label="Дахин сонсох"
        className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-pink to-purple text-white shadow-xl shadow-purple/40 transition hover:brightness-110"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
          {active ? (
            <>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </>
          ) : (
            <path d="M6 4l14 8-14 8z" />
          )}
        </svg>
      </button>
      <div className="text-2xl font-black tracking-[0.3em] text-muted-2">? ? ? ? ?</div>
    </div>
  )
}

const WAVE_BARS = [55, 80, 40, 95, 60, 100, 45, 75, 35, 90, 50, 70, 85, 42, 65].map((height, i) => ({
  height,
  delay: (i % 7) * 0.1,
}))

function VideoStage({ item, revealed }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [ready, setReady] = useState(false)

  const clearStop = () => {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current)
      stopTimer.current = null
    }
  }

  const playSnippet = () => {
    const v = videoRef.current
    if (!v) return
    clearStop()
    try {
      v.currentTime = item.snippetStart
    } catch {
      /* seeking before metadata is ready — ignore */
    }
    void v.play().catch(() => {})
    stopTimer.current = setTimeout(() => v.pause(), item.snippetDuration * 1000)
  }

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (revealed) {
      clearStop()
      v.pause()
      return
    }
    if (v.readyState >= 1) playSnippet()
    else v.addEventListener('loadedmetadata', playSnippet, { once: true })
    return () => {
      clearStop()
      v.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, revealed])

  return (
    <div className={`${CARD} gap-4 p-4`}>
      <video
        ref={videoRef}
        src={item.mediaUrl}
        playsInline
        onLoadedMetadata={() => setReady(true)}
        className="max-h-[28rem] w-full rounded-2xl bg-black object-contain"
      />
      <div className="text-xs text-muted-2">Хэсгийг нь хараад киног таа</div>
      {!revealed && (
        <button
          onClick={playSnippet}
          disabled={!ready}
          className="rounded-full border border-border px-4 py-2 text-sm text-ink-soft hover:border-cyan/60 disabled:opacity-40"
        >
          ↻ Дахин үзэх
        </button>
      )}
    </div>
  )
}

function ImageStage({ item }: { item: Song }) {
  return (
    <div className={`${CARD} gap-4 p-6`}>
      <img
        src={item.mediaUrl}
        alt=""
        className="max-h-[28rem] w-auto rounded-2xl object-cover"
        draggable={false}
      />
      <div className="text-sm font-semibold text-muted">Энэ хэн бэ?</div>
    </div>
  )
}
