# Security policy

## Scope and supported use

This app reads the complete public BIP-39 English word list so you can check physical copies.
It is not a wallet, seed generator, or recovery-phrase reader. Close it and remove the reader device
before selecting seed words. Never enter selected seed words, passphrases, or key material into
search, uploaded files, endpoint settings, or playback. Secret use can expose choices through audio,
saved position, remote requests, the browser, or observers.

Inventory completeness does not establish randomness or ceremony security. This project is not
affiliated with or endorsed by SeedSigner. No independent security audit is claimed.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** option if it is available. GitHub private
vulnerability reporting must be enabled by the maintainer; a local source copy cannot establish that
it is enabled. If that option is absent, open a public issue asking only for a private reporting
channel, without exploit details or secrets. No private email address or response-time promise is
published by this project. Never send real recovery material in a report.

Please include the affected version or commit, files involved, browser/OS, expected and actual
behavior, impact, and a reproduction using public words and dummy credentials.

## In scope

- Incorrect list content/order, extra executable content in generated `words.js` accepted by the verifier.
- Misleading integrity success, including after hash self-test failure or for two corrupted matching lists.
- Unsafe rendering of uploaded text, settings, or TTS responses as HTML.
- Requests without deliberate remote-mode activation, browser-default/network speech used as local,
  or stale audio after cancellation.
- API keys deliberately persisted in browser storage, cookies, or URLs by the app.
- Playback bugs that skip or double-advance words.

## Trust boundaries and limitations

- A compromised OS, browser, extension, or downloaded application can change checks and output. A
  green badge covers list content only, not application integrity. Review code and independently hash
  the upstream list using [VERIFY.md](VERIFY.md).
- Voice metadata comes from the browser. Only `localService === true` voices are allowed in device
  mode; confirm disconnected playback. Pronunciation, OS behavior, and third-party services still
  require user review. Failure to enforce the local-voice restriction is in scope.
- Remote mode sends public played and prefetched words plus request metadata to the configured
  endpoint. The voice test sends `bitcoin`. Loopback does not prove offline processing. Cancellation
  stops local work but cannot retract requests already received by a service.
- `Origin: null` is not authentication or a unique identity for this page. Do not broadly allow null
  origins on sensitive services. Use operator-reviewed CORS/authentication and loopback binding, or
  avoid remote TTS. Endpoint URLs and responses are untrusted; do not embed credentials in URLs.
- Comparison files stay in page memory and never replace the active list. Very large files can
  consume memory; upload only public inventory text.
- The API key stays in page memory. Browser extensions/password managers can still access inputs;
  other preferences and list position may persist. Remote activation is not restored after reopening.

## Risk-reducing design

No external dependencies, CDN, fonts, telemetry, installation, or build step. Classic scripts support
`file://`; the only application network code is the optional `tts-remote.js`. Device/silent modes
make no application network requests. The explicit external guidance link opens a website.
User-supplied content is rendered as text, not HTML. Hash vectors, available-engine cross-comparison,
raw and normalized checks, a strict offline verifier, and regression tests provide separate checks,
not a guarantee of safety. Review [TESTING.md](TESTING.md) before release.