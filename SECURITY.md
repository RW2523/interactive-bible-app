# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository. You will get a reply as soon as possible, and fixes are
released together with a note in [CHANGELOG.md](CHANGELOG.md).

Useful details: what you found, how to reproduce it, the affected version or commit, and the impact you expect.

## Supported versions

Only the latest release on `main` receives security fixes.

## Security model in short

The Interactive Bible App is built to run **on your own computer**:

- **Personal mode (default).** Requests from the computer running the app act as the owner account, with full access
  and no sign-in. Requests from other devices on the network must sign in with an account. Setting
  `SINGLE_USER_TRUST_NETWORK=true` gives *every* device owner access — only do that on a network you trust.
- **Do not expose port 8000 to the internet.** The app is not hardened as a public multi-tenant service. Put it behind
  a VPN or an authenticating reverse proxy if you need remote access.
- **Secrets stay in `.env`**, which is git-ignored. Never commit it, and rotate your Gemini key if it was ever shared.
- **Only Gemini is remote.** Everything else (database, files, search, maps, fonts) is local. YouTube links are read for
  captions and details only; videos are never downloaded or re-hosted.
- Built-in protections: scrypt password hashes and signed session tokens, HMAC-signed file URLs, upload type and size
  checks (magic bytes, zip-bomb and executable guards), SSRF-guarded URL fetching, server-side HTML sanitising for
  sermons, owner-only access to sermons, rate limits and an hourly cap on paid AI generation.
