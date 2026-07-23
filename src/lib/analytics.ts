/**
 * Lightweight, privacy-friendly product event buffer. Events stay on-device
 * until a hosted analytics provider is deliberately connected.
 */
export type ProductEventName =
  | 'game_started'
  | 'game_completed'
  | 'daily_started'
  | 'daily_completed'
  | 'result_shared'

export interface ProductEvent {
  id: string
  name: ProductEventName
  at: string
  properties?: Record<string, string | number | boolean>
}

const EVENT_KEY = 'taa.product-events'
const MAX_EVENTS = 100

export function trackEvent(name: ProductEventName, properties?: ProductEvent['properties']): void {
  try {
    const previous = JSON.parse(localStorage.getItem(EVENT_KEY) ?? '[]') as ProductEvent[]
    const next: ProductEvent[] = [...previous, {
      id: crypto.randomUUID(),
      name,
      at: new Date().toISOString(),
      properties,
    }]
    localStorage.setItem(EVENT_KEY, JSON.stringify(next.slice(-MAX_EVENTS)))
  } catch {
    // Analytics must never interrupt play when storage is unavailable.
  }
}

export function readBufferedEvents(): ProductEvent[] {
  try {
    const events = JSON.parse(localStorage.getItem(EVENT_KEY) ?? '[]') as Partial<ProductEvent>[]
    return events
      .filter((event): event is ProductEvent => Boolean(event.name && event.at))
      .map((event) => ({
        id: event.id ?? crypto.randomUUID(),
        name: event.name,
        at: event.at,
        properties: event.properties,
      }))
  } catch {
    return []
  }
}

export function removeBufferedEvents(ids: string[]): void {
  try {
    const complete = new Set(ids)
    const remaining = readBufferedEvents().filter((event) => !complete.has(event.id))
    localStorage.setItem(EVENT_KEY, JSON.stringify(remaining))
  } catch {
    /* analytics must never block play */
  }
}
