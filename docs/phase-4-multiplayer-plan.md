# Phase 4 Multiplayer Plan

Phase 4 expands `Хамтдаа` after the room, synced-round, and room-polish work. It is intentionally split into independent features so each can ship without blocking the others.

## Goals

- Make rooms safer and more persistent with Supabase Auth.
- Support private sharing, rematches, and QR-based joining.
- Record multiplayer results in the leaderboard.
- Let people watch a game without affecting it.

## Delivery order

1. Authentication and RLS foundation
2. Private rooms and invite links
3. Rematch
4. Multiplayer leaderboard results
5. QR join
6. Spectator mode

Authentication comes first because private access and reliable score ownership depend on it. QR joining can be delivered earlier if it remains a public-PIN convenience feature.

## 1. Authentication and RLS foundation

### Scope

- [x] Add Supabase Auth sign-in flow, initially using anonymous sign-in or magic links.
- [ ] Create a `profiles` table for display names and optional avatar metadata.
- [x] Associate room hosts and players with authenticated user IDs.
- [x] Replace host-token-only authorization with Auth-aware host checks.
- [x] Preserve the current host token only as a temporary migration fallback, then remove it.
- [ ] Restrict RLS reads and writes to the relevant room participants.
- [x] Ensure an answer can only be submitted by its authenticated player.

### Acceptance checks

- [x] Refreshing a page restores the same signed-in identity.
- [x] A player cannot heartbeat, answer for, or remove another player.
- [x] Only the authenticated host can start, reveal, advance, finish, or close a room.
- [x] Existing public-PIN flow continues to work during the migration.

## 2. Private rooms

### Scope

- [ ] Add a room visibility field: `public_pin` or `private_invite`.
- [ ] Add a cryptographically random invite secret for private rooms.
- [ ] Let the host choose visibility during room creation.
- [ ] Add a private invite URL and sharing controls in the lobby.
- [ ] Update join RPCs and RLS to validate the invite secret for private rooms.
- [ ] Hide private rooms from any future room discovery views.

### Acceptance checks

- [ ] A private room cannot be joined using its PIN alone.
- [ ] A valid invite link joins the intended private room.
- [ ] Rotating or invalidating an invite prevents later joins without ending the game.

## 3. Rematch

### Scope

- [ ] Add a `Rematch` action to the finished podium for the host.
- [ ] Create a new room with the same pack and game configuration.
- [ ] Generate a new PIN and reset all player scores, answers, and rounds.
- [ ] Show current players a rematch invitation and acceptance state.
- [ ] Allow new players to join the new room normally.
- [ ] Add an expiration timeout for an unanswered rematch invitation.

### Acceptance checks

- [ ] A rematch never reuses the completed room or its score state.
- [ ] Players can accept or decline without affecting the completed results.
- [ ] The original host remains host of the new room.

## 4. Multiplayer leaderboard results

### Scope

- [x] Extend score storage with `mode` (`solo` or `multi`) and room metadata.
- [x] Decide whether to save every participant, only the podium, or both.
- [x] Add a host-authorized RPC that writes final scores once per completed room.
- [x] Add idempotency so reconnecting or refreshing cannot duplicate results.
- [x] Add multiplayer filters or badges to the leaderboard screen.
- [x] Define whether solo and multiplayer rankings appear together or separately.

### Acceptance checks

- [x] Finished-room results are stored exactly once.
- [x] Saved results match final room scores and correct-answer counts.
- [x] The leaderboard clearly identifies multiplayer results.

## 5. QR join

### Scope

- [ ] Add a small QR code generation dependency.
- [ ] Generate a join URL such as `/join?pin=123456` for public rooms.
- [ ] Pre-fill the PIN on the join form when the URL contains it.
- [ ] Display the QR code in the host lobby.
- [ ] Use invite URLs, not bare PIN URLs, for private rooms.
- [ ] Provide a copy-link fallback for devices that cannot scan QR codes.

### Acceptance checks

- [ ] Scanning a public-room QR code opens the join flow with the PIN filled in.
- [ ] Scanning a private-room QR code validates the private invite.
- [ ] A malformed join link fails safely with a clear message.

## 6. Spectator mode

### Scope

- [ ] Add a participant role: `player` or `spectator`.
- [ ] Permit spectators to join after a game starts.
- [ ] Render game state, media, timer, reveal, and rankings in read-only mode.
- [ ] Exclude spectators from answer submission, scores, and all-answered calculations.
- [ ] Show player and spectator counts separately.
- [ ] Set a spectator capacity and host controls if needed.

### Acceptance checks

- [ ] A spectator cannot submit an answer or receive points.
- [ ] A spectator joining mid-round does not delay reveal.
- [ ] Spectators receive the same authoritative room and round state as players.

## Cross-cutting quality checklist

- [ ] Add database migrations in dependency order and document that order in the README.
- [ ] Add focused tests for RPC authorization, room visibility, rematch, score idempotency, and spectator rules.
- [ ] Test host refresh, guest refresh, reconnect after idle pruning, and host departure.
- [ ] Test with at least two browser sessions for each feature.
- [ ] Apply rate limits to create, join, answer, rematch, and invite validation endpoints.
- [ ] Run `npm run build` before each release.

## Open product decisions

- [ ] Is sign-in required for everyone, or should guests remain anonymous?
- [ ] Are private rooms PIN plus invite link, or invite link only?
- [ ] Should rematches preserve the existing player roster automatically?
- [x] Should multiplayer scores share a leaderboard with solo scores?
- [ ] Can spectators see media, or should they see answers and rankings only?
