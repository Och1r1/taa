#!/usr/bin/env node
/** Fast, non-destructive preflight for the browser and ingestion Supabase settings. */
import { lookup } from 'node:dns/promises'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const verifyRemote = process.argv.includes('--remote')

function fail(message) {
  console.error(`✖ ${message}`)
  process.exitCode = 1
}

if (!url) {
  fail('Missing VITE_SUPABASE_URL (or SUPABASE_URL).')
} else if (url.includes('YOUR_PROJECT_REF.supabase.co')) {
  fail('VITE_SUPABASE_URL still contains YOUR_PROJECT_REF.')
} else {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    fail('VITE_SUPABASE_URL is not a valid URL.')
  }
  if (parsed) {
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) {
      fail('VITE_SUPABASE_URL must be an https://<project>.supabase.co URL.')
    } else {
      console.log(`✓ Supabase URL format is valid: ${parsed.hostname}`)
      if (verifyRemote) {
        try {
          await lookup(parsed.hostname)
          console.log(`✓ Supabase host resolves: ${parsed.hostname}`)
        } catch {
          fail(`Supabase host does not resolve: ${parsed.hostname}`)
        }
      }
    }
  }
}

if (anonKey && !anonKey.startsWith('your-')) console.log('✓ VITE_SUPABASE_ANON_KEY is set')
else fail('Missing or placeholder VITE_SUPABASE_ANON_KEY.')

if (serviceKey && !serviceKey.startsWith('your-')) console.log('✓ SUPABASE_SERVICE_ROLE_KEY is set (ingestion/live tests available)')
else console.log('ℹ SUPABASE_SERVICE_ROLE_KEY is not set; ingestion and live RPC tests remain unavailable.')

if (!verifyRemote) console.log('ℹ Run `npm run verify:env -- --remote` to include a DNS lookup.')
