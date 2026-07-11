import { useCallback, useEffect, useRef, useState } from 'react'

interface PlayArgs {
  url: string
  start: number
  duration: number
}

/**
 * Controls a single HTMLAudioElement to play a bounded snippet of a track.
 * Handles seeking to `start`, auto-stopping after `duration`, and cleanup.
 */
export function useAudioSnippet() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  // Lazily create the audio element once.
  if (audioRef.current === null && typeof Audio !== 'undefined') {
    audioRef.current = new Audio()
    audioRef.current.preload = 'auto'
  }

  const clearStopTimer = useCallback(() => {
    if (stopTimerRef.current !== null) {
      clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    clearStopTimer()
    const audio = audioRef.current
    if (audio) {
      audio.pause()
    }
    setIsPlaying(false)
  }, [clearStopTimer])

  const play = useCallback(
    async ({ url, start, duration }: PlayArgs) => {
      const audio = audioRef.current
      if (!audio) return
      clearStopTimer()

      if (audio.src !== url) {
        audio.src = url
      }

      const beginPlayback = () => {
        try {
          audio.currentTime = start
        } catch {
          // Some browsers reject seeking before metadata loads; ignore.
        }
        void audio.play().then(
          () => setIsPlaying(true),
          () => setIsPlaying(false), // Autoplay may be blocked until a user gesture.
        )
        clearStopTimer()
        stopTimerRef.current = setTimeout(() => stop(), duration * 1000)
      }

      if (audio.readyState >= 1 /* HAVE_METADATA */) {
        beginPlayback()
      } else {
        audio.addEventListener('loadedmetadata', beginPlayback, { once: true })
        audio.load()
      }
    },
    [clearStopTimer, stop],
  )

  // Stop and release on unmount.
  useEffect(() => {
    return () => {
      clearStopTimer()
      const audio = audioRef.current
      if (audio) {
        audio.pause()
        audio.src = ''
      }
    }
  }, [clearStopTimer])

  return { play, stop, isPlaying }
}
