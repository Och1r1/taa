import { useEffect, useRef, useState } from 'react'
import type { Song } from '../types'
import { EqualizerBars } from './EqualizerBars'
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

const CARD = 'mb-8 flex flex-col items-center rounded-3xl border border-border bg-surface/70'

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

  return (
    <div className={`${CARD} py-10`}>
      <EqualizerBars active={isPlaying && !revealed} className="mb-5 h-12" />
      <div className="text-sm font-semibold text-muted">Одоо тоглож байна…</div>
      <div className="mt-1 text-xs text-muted-2">Дуунаас хэсэг сонсоод нэрийг нь таа</div>
      {!revealed && (
        <button
          onClick={playSnippet}
          className="mt-5 rounded-full border border-border px-4 py-2 text-sm text-ink-soft hover:border-cyan/60"
        >
          ↻ Дахин сонсох
        </button>
      )}
    </div>
  )
}

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
        className="max-h-80 w-full rounded-2xl bg-black object-contain"
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
        className="max-h-80 w-auto rounded-2xl object-cover"
        draggable={false}
      />
      <div className="text-sm font-semibold text-muted">Энэ хэн бэ?</div>
    </div>
  )
}
