# Security Notes

> Security model, authentication, and network considerations for
> LAN Games. See also: [State-Emission Audit](state-emission-audit.md).
> Back to [README](../README.md).

- **JWT Secret (required)** — the server **refuses to start** if `JWT_SECRET` is not set. There is no built-in default; a predictable or shared secret would let tokens from any other installation be accepted by yours.

  Generate a secret (run once, save the output somewhere safe):
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
  Start the server with it:
  ```bash
  JWT_SECRET=<paste-secret-here> npm start
  ```
  Or export it in your shell profile, process manager, or `.env` file before running `npm start`.

- **LAN-only binding warning** — when the server binds to all interfaces (`HOST=0.0.0.0`, the default) and `NODE_ENV` is not `development`, it logs a prominent warning at startup. CORS is `*` and there is no rate limiting — this server is designed for trusted local networks. Do **not** expose it to the public internet without a TLS-terminating reverse proxy (nginx, Caddy), rate limiting on auth endpoints, and a firewall restricting inbound connections to LAN addresses.

  To bind to localhost only:
  ```bash
  HOST=127.0.0.1 npm start
  ```
  To silence the warning during local development:
  ```bash
  NODE_ENV=development npm start
  ```

- **Passwords** — hashed with bcrypt at 12 salt rounds; plaintext is never stored or logged. Minimum length is 8 characters.

- **Randomness** — dice rolls, shuffles, and spinners use `Math.random()`, which is not cryptographically secure. This is fine for casual LAN play; competitive or high-stakes contexts would need `crypto.randomInt()`.

- **Server-side validation** — every action is validated on the server before being applied. Clients cannot manipulate state directly or forge another player's moves.

- **State-emission boundary audited** — every state-bearing emission (both socket and REST) routes through `getStateForPlayer` via the shared [`filterStateForUser`](../server/src/state-filter.js) helper. This is the security boundary that protects hidden-information games (Risk's card hands, Battleship's ship positions, future Coup-style games) from leaking opponent state. The full audit and the closure of a real leak in `GET /api/games/:id` is documented in [`state-emission-audit.md`](state-emission-audit.md).

- **Offline by design** — once installed and configured, the server and client need **zero internet connectivity** to run. This is a deliberate property of the architecture, not an accident:

  - **No external CDN assets.** All scripts, styles, fonts, and images are served from the local `client/` directory. There are no `<script src="https://…">`, no `@import url(https://…)`, no Google Fonts — the UI uses the system font stack (`Segoe UI`, `system-ui`, `sans-serif`, `monospace`).
  - **No third-party runtime fetches.** The client only ever hits relative URLs (`/api/*`, `/img/*`, `/socket.io/socket.io.js`). Socket.io connects to the same origin it loaded from.
  - **No telemetry or analytics.** Server dependencies are limited to seven self-contained packages (`bcrypt`, `better-sqlite3`, `cors`, `express`, `jsonwebtoken`, `socket.io`, `uuid`) — none of them phone home.
  - **No server-side outbound HTTP.** The server's only use of the `http` module is `http.createServer(app)` for the listener. There are no `fetch()`, `axios`, or `node-fetch` calls anywhere in `src/` or `games/`.
  - **No runtime npm install.** Both the local `npm start` path and the bundled Docker image install dependencies once at setup time. After that, an air-gapped LAN deployment runs indefinitely.

  This makes the project safe for trusted internal LANs with no internet uplink — a school LAN party, a board-gamers' Wi-Fi, a flight, a basement bunker.
