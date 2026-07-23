import { ensureAnonymousUser } from './auth'
import { removeBufferedEvents, readBufferedEvents } from '../lib/analytics'
import { supabase } from '../lib/supabase'

/** Uploads locally buffered events after auth is available; failures retain the buffer for retry. */
export async function flushAnalyticsEvents(): Promise<void> {
  const events = readBufferedEvents()
  if (events.length === 0) return
  await ensureAnonymousUser()
  const { error } = await supabase.from('analytics_events').upsert(
    events.map((event) => ({
      id: event.id,
      event_name: event.name,
      occurred_at: event.at,
      properties: event.properties ?? {},
    })),
    { onConflict: 'id', ignoreDuplicates: true },
  )
  if (error) throw error
  removeBufferedEvents(events.map((event) => event.id))
}
