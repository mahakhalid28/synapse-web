# Local accounts, login and signup

Login and signup use the existing design system, native labelled forms, keyboard navigation, validation descriptions, heading focus and live status messages. Built previews and packaged builds require sign-in before study screens mount. Vite development opens the existing local profile automatically, with Sign in and Create account controls for testing. Tests select their access policy explicitly. Files and account records remain on this computer.

Signup signs in automatically. Existing device onboarding appears after authentication if incomplete; development retains the existing Welcome/Home startup. No registered account receives development-profile data automatically. The Navbar shows the signed-in display name and Sign out. Account screens retain the theme picker and shared skip link; lecture voice navigation is not mounted on those screens. Passwords never enter the speech-command pipeline.

## Frontend session boundary

Import the account module from `src/lib/accountSession.js`:

```js
import { signup, login, logout, initializeAccount } from "./lib/accountSession";

await initializeAccount(); // restores/verifies a persisted session
const { user, persistent } = await signup(username, password, displayName);
await login(username, password);
await logout();
```

Successful signup signs in automatically. Usernames have 3–64 ASCII letters/numbers/dots/dashes/underscores, begin with a letter or number and are case-insensitive. Passwords have 8–128 characters and are never trimmed. Errors have a numeric `status` for future accessible forms. Do not log the returned session object, token or password. `persistent: false` means the browser could not store the session; it remains available in memory but must not be described as surviving restart.

`initializeAccount` is called by App and personal requests. Missing credentials select the local profile only under the development policy; normal builds have `user: null` and `status: "signed-out"`. Personal requests reject that state before issuing fetch. Invalid/expired/revoked credentials produce 401 and clear private views; they never silently retry as the development profile. Explicit logout revokes the session before returning to login in built mode or the local profile in development. If logout cannot be confirmed, the client keeps its account state and reports failure. Development offers an explicit Back to development app action to recover from an invalid-session marker.

App waits for persisted-session verification before mounting study screens, so personal-summary reads and processing restoration cannot start early. A verification outage keeps the credential and shows Retry and Sign in instead. Storage events from another tab also require verification before private reads. Existing recording guards run before opening account pages or changing identity. Form submission prevents duplicate requests and disables form navigation while pending; passwords are discarded when a form is left or authentication succeeds.

Sessions have a fixed 30-day expiry, survive backend restarts and are revocable individually. Separate clients can have independent sessions. Browser tabs on the same frontend origin share the selected account; localhost and 127.0.0.1 browser storage origins are separate. There is no email recovery, online login, password reset, account deletion or automatic transfer of existing local data in this phase.

## API contract

| Endpoint | Request | Result |
| --- | --- | --- |
| `POST /auth/signup` | `username`, `password`, optional `display_name` | 201, user/token/expiry |
| `POST /auth/login` | `username`, `password` | user/token/expiry |
| `GET /auth/session` | optional bearer credential | current user/expiry; development profile if absent and compatibility enabled |
| `POST /auth/logout` | optional bearer credential | 204; revocation is idempotent |

Personal requests use `Authorization: Bearer <token>`. Ownership always comes from the backend-verified session. Existing `/me` JSON/media routes check it. Another user's resources are absent/404; idempotent deletes may return 204 without changing anything. The frontend authenticates saved-audio and recording fetches and uses temporary blob URLs for playback. Future private frame consumers must use `accountRequest(path, options, "blob")` too; a raw image tag cannot supply bearer authentication.

Passwords use Argon2id. SQLite holds salted password hashes and SHA-256 digests of cryptographically random session tokens. Credential bodies are limited to 8 KiB; attempts and concurrent password hashing are bounded. Origin checks, explicit CORS origins, Authorization-header preflights and loopback restrictions remain enforced. No cookies, wildcard origins or tokens in URLs are introduced.

The bearer token is persisted in guarded browser localStorage, scoped to the backend URL. This supports the current cross-origin local HTTP topology, including different loopback hostnames. JavaScript on the application origin can read it. This does not protect against compromised app scripts, local programs, database/file access or computer administrators. Public/remote deployment needs a separate authentication/transport review. The compatibility development profile remains accessible to allowed local clients without a password.

## Account transitions and data boundaries

- Private lists, loaded explanations, playback and pending confirmations are disposed when identity changes. Requests/body reads are checked against the initiating identity; stale results cannot invalidate a newer login.
- An explicit account change is rejected while a recording/draft/save is active: use existing Save/Discard actions first. Another tab must stop and durably retain the old recording before disposing its view. If storage fails, it keeps that window's old context rather than moving the recording to another account.
- IndexedDB draft and quiz stores are account-scoped. Existing unowned records stay in the original development store. Quiz sessions bind a store once so late autosaves stay with the original account. Quiz generation/scoring is unchanged.
- Legacy browser/package saves are offered only in the development profile. Registered accounts can retry their own drafts. Originals are retained; signup never claims them automatically.
- Theme, accessibility/display and speech preferences remain device settings. No settings synchronization is added.
- Processing jobs, source lectures and generated cache content remain shared. Account changes dispose the old personal view and polling without server open/cancel calls or cancelling a server job. The previous profile's processing selection remains in its scoped sessionStorage for restoration on reopening. Explanation capture still follows persisted Library subscriptions.
- Personal commit and logout are serialized by a conditional session write before commit. Work committed first belongs to its original user; revoked/expired sessions cannot commit afterward. Interrupted uploads retain their recovery draft; unused media follows existing reconciliation.

## Operations

Install backend requirements, then run `python -m api.setup` for additive migration `20261113_0010`. Existing profile IDs and data are preserved. Setup checks both account tables. Take a coordinated database/media backup with the API stopped using `python -m scripts.backup_learning_storage`. Protect backups because they include account hashes/session digests. Downgrading populated account tables is refused.

The backend defaults to `SYNAPSE_LOCAL_PROFILE_COMPAT=0` when unset. Development explicitly uses `1`; normal/built/packaged use must use `0`, so unauthenticated personal API requests receive 401 as well as being blocked by the frontend. Frontend build mode is not a backend security boundary.

The existing PowerShell launcher defaults to development access when no inherited compatibility setting is present. It does not edit `.env`:

```powershell
# Development backend, then run npm run dev or npm run electron:dev in synapse-web.
.\scripts\synapse.ps1 start

# Normal use: stop any existing backend first, then launch with sign-in required.
.\scripts\synapse.ps1 stop
.\scripts\synapse.ps1 start -RequireSignIn
```

For a direct API launch, set `$env:SYNAPSE_LOCAL_PROFILE_COMPAT="1"` for development or `"0"` for normal use before starting it. The launcher reuses an existing server; changing modes requires stopping and restarting that server. Do not point normal-use clients at a development-compatibility backend and claim unauthenticated API access is disabled. Browser localhost and 127.0.0.1 origins remain separate storage profiles.

Account APIs remain restricted to local development environments and loopback clients in both modes. Keep `SYNAPSE_ENV=development` (or another supported local environment) for this local packaged application: `SYNAPSE_ENV=production` disables these local account APIs. Remote/public deployment is outside this change.

Automated checks cover lifecycle, two-account ownership, private media, slow-upload revocation, browser draft/quiz separation, stale responses, account-switch disposal and saved reopening. Real microphone, NVDA and installed Electron/session-storage behavior require manual verification. Existing unrelated lint/test failures are reported separately instead of changing their features as part of authentication.

## Validation

On 14 November 2026, the final login/signup implementation passed 1,325 frontend tests across 67 files, including form accessibility/keyboard, authentication-policy, persistence-failure and recording-recovery tests, plus 62 focused backend account/storage/migration/history/request/lease tests. The production build, launcher PowerShell syntax check and ESLint on changed frontend files passed. Repository-wide lint still reports five existing errors in Home, Timeline and localFrontend.test.js, plus four existing conversation-hook warnings. A full-suite run during concurrent checks initially failed 27 lecture tests; those suites passed separately and two subsequent full runs passed.

No real user database migration or account creation was performed for these checks. Browser/desktop inspection could not start because the computer-use runtime failed to initialize. Real NVDA, Windows High Contrast, theme/zoom visual review, microphone and installed Electron/session-restoration checks remain manual release gates. Automated axe and DOM checks do not certify those checks. Run the focused checks with isolated SQLite/media fixtures; avoid starting the real API/model warmups merely to test forms.

### Historical validation before account pages

On 13 November 2026: 1,286 frontend tests passed across 63 files; 115 focused backend account/storage/migration/history/preparation/audio/lease/voice tests passed. Production build and ESLint on the authentication-related changed files passed. Repository-wide ESLint still reports five existing errors in Home, Timeline and the localFrontend test, plus three existing conversation-hook warnings; those unrelated files were not changed to fix lint. This is not a claim that the entire backend suite or hardware/packaged manual checks passed.

The real database is at `20261113_0010`; the existing development user and 30 videos, 6,270 transcripts, 345 interventions and 48 explanations were retained. No registered account or example password was inserted. A coordinated verified pre-migration backup is in `backups/learning-storage-20261113T090925461132Z`, with an additional SQLite backup in `backups/synapse-pre-migration-20261113T091001958070Z.db.backup`.
