# Phase 4 Multiplayer Plan

Phase 4 expands `Хамтдаа` after the room, synced-round, and room-polish work. It is intentionally split into independent features so each can ship without blocking the others.

## Goals

- Make rooms safer and more persistent with Supabase Auth.
- Support private sharing, rematches, and QR-based joining.
- Record multiplayer results in the leaderboard.
- Let people watch a game without affecting it.

## Status overview

| Feature | Status |
|---------|--------|
| 1. Auth foundation (anonymous + `user_id`) | Done |
| 2. Private rooms + invite links | In progress / this ship |
| 3. Rematch (same-room restart polish) | Done (full new-room rematch deferred) |
| 4. Multiplayer leaderboard | Done |
| 5. QR join (public PIN) | Done (private invite QR in this ship) |
| 6. Spectator mode | In progress / this ship |

## Delivery order (original)

1. Authentication and RLS foundation
2. Private rooms and invite links
3. Rematch
4. Multiplayer leaderboard results
5. QR join
6. Spectator mode

Playability reorder used in practice: QR → rematch polish → thin Auth → multi leaderboard → private → spectators.

---

## 1. Authentication and RLS foundation

### Scope

- [x] Add Supabase Auth sign-in flow, initially using anonymous sign-in.
- [x] Create a `profiles` table for display names and optional avatar metadata.
- [x] Associate room hosts and players with authenticated user IDs.
- [x] Replace host-token-only authorization with Auth-aware host checks.
- [x] Preserve the current host token as a temporary migration fallback.
- [ ] Remove host_token entirely once Auth-only host checks are trusted in production.
- [ ] Restrict RLS reads and writes to the relevant room participants (SELECT still open for Realtime).
- [x] Ensure an answer can only be submitted by its authenticated player.

### Acceptance checks

- [x] Refreshing a page restores the same signed-in identity.
- [x] A player cannot heartbeat, answer for, or remove another player.
- [x] Only the authenticated host (or host_token fallback) can start, reveal, advance, finish, or close a room.
- [x] Existing public-PIN flow continues to work during the migration.

**SQL:** `supabase/rooms-auth.sql`

---

## 2. Private rooms

### Scope

- [x] Add a room visibility field: `public` or `private`.
- [x] Add a cryptographically random invite secret for private rooms.
- [x] Let the host choose visibility during room creation.
- [x] Add a private invite URL and sharing controls in the lobby.
- [x] Update join RPCs to validate the invite secret for private rooms (invite link only — PIN alone fails).
- [x] QR / copy-link uses invite URLs for private rooms.
- [x] Host can rotate the invite secret without ending the game.
- [ ] Hide private rooms from any future room discovery views (no discovery UI yet).

### Acceptance checks

- [x] A private room cannot be joined using its PIN alone.
- [x] A valid invite link joins the intended private room.
- [x] Rotating or invalidating an invite prevents later joins without ending the game.

**Product default:** private = invite link only (not PIN + invite).

**SQL:** `supabase/rooms-private-spectators.sql`

---

## 3. Rematch

### Shipped (same-room polish)

- [x] Host `Дахин тоглох` on finished podium.
- [x] Reset scores, answers, and rounds; return everyone to lobby; same PIN/pack.
- [x] Guest waiting copy on podium; lobby handoff; host kick + presence.

### Deferred (full redesign)

- [ ] Create a **new** room with the same pack and game configuration.
- [ ] Generate a new PIN and rematch invitation / accept / decline states.
- [ ] Expiration timeout for an unanswered rematch invitation.
- [ ] Rematch never reuses the completed room row (stricter than current restart).

---

## 4. Multiplayer leaderboard results

### Scope

- [x] Extend score storage with `mode` (`solo` or `multi`) and room metadata.
- [x] Save every participant (not only podium).
- [x] Host-authorized finish path writes final scores once per completed match.
- [x] Idempotency via `rooms.score_export_id` (rematch clears marker for a new batch).
- [x] Multiplayer badge on the leaderboard screen.
- [x] Solo and multiplayer on one shared board.
- [ ] Optional filter tabs: All / Solo / Хамтдаа.

**SQL:** `supabase/rooms-leaderboard.sql`

---

## 5. QR join

### Scope

- [x] QR dependency (`qrcode.react`).
- [x] Public join URL `/join?pin=123456` + PIN prefill + lobby QR + copy-link.
- [x] Private rooms use `/join?invite=…` QR/copy (with this private-rooms ship).
- [x] Malformed join links fail with a clear message.

---

## 6. Spectator mode

### Scope

- [x] Participant role: `player` or `spectator`.
- [x] Spectators may join after a game starts (and from lobby).
- [x] Read-only game UI: media, timer, reveal, rankings (no answer controls).
- [x] Excluded from answer submission, score export, and all-answered waits.
- [x] Separate player / spectator counts in the lobby.
- [x] Spectator capacity (default 20).
- [ ] Optional host “promote / kick spectator” extras beyond normal kick.

### Acceptance checks

- [x] A spectator cannot submit an answer or receive points.
- [x] A spectator joining mid-round does not delay reveal.
- [x] Spectators receive the same authoritative room and round state as players.

**Product default:** spectators see full media (same stage as players), read-only.

**SQL:** `supabase/rooms-private-spectators.sql`

---

## Backlog (options / leftovers)

Track these explicitly so they are not lost after Phase 4 core ships:

### Auth & security

- [x] `profiles` table (display name, optional avatar) + light UI.
- [x] Magic-link / email sign-in (optional upgrade from anonymous).
- [x] Remove `host_token` fallback; Auth-only host checks.
- [x] Tighten RLS SELECT to room participants (hybrid: peeks/joins via RPC; Realtime for seated players).
- [x] Rate limits on create, join, answer, rematch, invite validation.

### Product polish

- [x] Full new-room rematch with accept/decline + timeout.
- [x] Leaderboard mode filter (All / Solo / Хамтдаа).
- [ ] Room discovery list (public lobbies only; never private).
- [ ] Invite rotate UI confirmations + copy feedback polish.
- [ ] Spectator capacity controls editable by host.

### Quality

- [x] Document SQL apply order in README (keep updated as files ship).
- [x] Focused automated tests for RPC auth, visibility, rematch, score idempotency, spectators.
- [ ] Manual matrix: host refresh, guest refresh, idle prune, host departure (two browsers).
- [ ] `npm run build` before each release.

### Open product decisions

- [x] Guests remain anonymous (no required sign-up).
- [x] Private rooms: invite link only (not PIN alone).
- [x] Rematch: new-room propose + accept/decline + timeout (same-room restart retired).
- [x] Solo + multi share one leaderboard with a Хамтдаа badge.
- [x] Spectators can see media (full stage, read-only).
- [ ] When to require real (non-anonymous) accounts for ranked multi scores.

---

## SQL apply order (multiplayer)

After base catalog / leaderboard SQL:

1. `supabase/rooms.sql`
2. `supabase/rooms-game.sql`
3. `supabase/rooms-polish.sql`
4. `supabase/rooms-auth.sql` — enable Anonymous Sign-Ins first
5. `supabase/rooms-leaderboard.sql`
6. `supabase/rooms-private-spectators.sql`
7. `supabase/rooms-profiles.sql`
8. `supabase/rooms-rematch.sql`
9. `supabase/rooms-rls-auth-host.sql`
10. `supabase/rooms-rate-limits.sql`
11. `supabase/rooms-rls-participant-fix.sql` — fixes room_players RLS recursion
