# API Reference

> REST endpoints for the LAN Games server. All endpoints live under `/api`.
> For real-time WebSocket events used during gameplay, see
> [Socket.io Events](socket-events.md). Back to [README](../README.md).

Authenticated endpoints (`✓`) require:

```
Authorization: Bearer <jwt-token>
```

## Auth

| Method | Path | Auth | Body | Response |
|--------|------|:----:|------|----------|
| POST | `/api/auth/register` | | `{ username, password }` | `{ token, user }` |
| POST | `/api/auth/login` | | `{ username, password }` | `{ token, user }` |
| GET | `/api/auth/me` | ✓ | — | `{ id, username }` |

## Games

| Method | Path | Auth | Body | Response |
|--------|------|:----:|------|----------|
| GET | `/api/games` | ✓ | — | `{ games[] }` — open & in-progress |
| GET | `/api/games/saved` | ✓ | — | `{ games[] }` — paused games for current user |
| GET | `/api/games/mine` | ✓ | — | `{ games[] }` — active games the user is in |
| GET | `/api/games/types` | ✓ | — | `{ types[] }` — registered game types + metadata |
| GET | `/api/games/types/:type/config` | ✓ | — | `{ config }` — default config for game type |
| POST | `/api/games/types/:type/config/reload` | ✓ | — | `{ success, config }` — hot-reload from disk |
| GET | `/api/games/config/default` | ✓ | — | `{ config }` — alias for Monopoly default config |
| POST | `/api/games` | ✓ | `{ name, gameType?, configOverrides? }` | `{ gameId, state }` |
| GET | `/api/games/:id` | ✓ | — | `{ state }` |
| POST | `/api/games/:id/join` | ✓ | — | `{ state }` |
| POST | `/api/games/:id/start` | ✓ (host) | — | `{ state }` |
| POST | `/api/games/:id/save` | ✓ (host) | — | `{ success }` |
| DELETE | `/api/games/:id` | ✓ (host) | — | `{ success }` |

`configOverrides` follows the same shape as the game's `settings.json` and is merged at game-creation time. Only `waiting` and `paused` games can be deleted.
