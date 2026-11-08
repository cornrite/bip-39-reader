# BIP-39 Word Reader

Reads the complete public BIP-39 English word list aloud, in order, freeing your eyes and hands to
check a physical copy (Entropia tablets or a printout) without looking away. No build step,
dependencies, installation, or server is needed: open `index.html` from `file://`.

**Scope:** check the complete public inventory, then close the app and remove the reader device
before selecting any seed words. Hold any subsequent lottery selection privately, away from cameras,
recording-capable devices, and observers. Never enter, search for, or replay your selected seed words
in this app. Uploaded comparison files must be public word lists, never private key material.
Inventory completeness does not establish randomness or ceremony security. This is not a wallet,
seed generator, or seed-phrase reader.

This independent project uses a SeedSigner-inspired theme. It is not affiliated with or endorsed by
SeedSigner. For external background, see the
[SeedSigner Independent Custody Guide](https://seedsigner.com/seedsigner-independent-custody-guide/),
particularly “Creating Secure Private Keys in a Trust-Minimized Way”. No ceremony instructions are
provided here, and that link does not establish endorsement of this app or any particular method.

## Use it

1. Download or clone the folder and open `index.html` in a browser.
2. Check the embedded-list badge and compare an independently downloaded public list as described in
   **[VERIFY.md](VERIFY.md)**. A green badge covers the list, not the application or a physical inventory.
3. Choose an identified local voice, or **No voice** for timed advance. Press **Play** and check each
   physical word. The first four letters (or the whole word if shorter) are highlighted.
4. Jump, search, repeat, and the progress bar navigate the public inventory. The bar is **list
   position**, not a record of coverage. “Reached the end of the list” does not mean every word was
   played or physically checked. Start at word 1 to check the complete inventory.
5. Close the app and remove this device before selecting seed words.

### Voices and privacy

| Engine | Behavior |
|---|---|
| Identified local device voice (default) | Only voices with the browser's `localService === true` are selectable. No browser-default fallback. If none are available, speech stops with a message; install a local voice or use No voice. |
| No voice | Silent, timed advance; no speech-service requests. |
| Remote TTS server (optional) | Sends played words and upcoming prefetched words to the configured OpenAI-compatible `/audio/speech` endpoint. Test sends `bitcoin`. Select this mode deliberately each time the page is reopened, then press Play, Repeat, or Test to make requests. |

The application makes no network requests in device or silent mode. A browser's “local” label is
not an audit of the browser, extension, or OS. Disconnect the network and test actual playback for an
offline run. The page contains an external guidance link; opening it intentionally uses the network.

Remote mode is not private: endpoint operators can observe words, timing, and request metadata. Even
a `localhost` server may forward requests to another service. Pause, navigation, engine changes, or
configuration edits cancel pending work and stop current audio. Cancellation cannot retract words
already sent or guarantee that the server stops processing. Changing the engine/configuration pauses
playback; press Play again. Speed changes apply to the next utterance.

The app saves list position, delay, rate, local voice name, engine preference, and remote endpoint,
model, and voice in browser storage when available. Remote permission is never restored. The API key
stays in page memory and is never deliberately stored by the app; browser extensions, password managers,
and the OS remain outside its control. Do not put credentials in endpoint URLs. Clear browser site
data to remove preferences (storage behavior for `file://` varies by browser).

### Keyboard

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `ArrowLeft` / `ArrowRight` | Previous / Next word |
| `R` | Repeat the current word |
| `Home` | Back to word 1 |
| `Enter` in search or jump | Search or jump |

`Ctrl`/`Cmd`/`Alt` combinations are not intercepted. Typing inside a field does not trigger shortcuts;
`Escape` leaves the field.

## Integrity checks

- The badge hashes the active embedded list's normalized content after SHA-256 self-tests. When
  WebCrypto is usable, it must agree with the pure-JavaScript implementation.
- **Check against my download** hashes raw bytes and normalized words separately, checks equality
  with the active list, and requires canonical active content. All checks must pass for green MATCH.
  Canonical content with different formatting is amber, not a raw-byte match. Matching corrupted
  lists or a failed hash subsystem cannot produce green. Uploading never replaces the active list.
- `python verify_bip39.py` checks raw `english.txt` bytes and the exact generated `words.js` statement
  outside the browser. Python is optional for using the app; no packages are needed for verification.

Canonical SHA-256 over upstream `english.txt` (13,116 bytes, LF, final LF):

```
2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda
```

## Tests and review

```
python verify_bip39.py
python test_bip39.py
```

Both must exit 0. The second command runs 42 standard-library verifier tests, including temporary-file
negative cases. Open `test_browser.html` from `file://` to run dependency-free JavaScript/browser
regressions. The test page runs the real scripts in isolated frames with mocked speech, fetch, and
audio; it does not contact a TTS provider. See [TESTING.md](TESTING.md) for limitations and manual checks.
No Node.js, npm, package manager, or build step is required.

Main files: `index.html` (markup), `app.js` (reader and comparisons), `style.css` (theme), `words.js`
(generated), `english.txt` (canonical bytes), `sha256.js` (hash helpers), `tts-remote.js` (optional
remote engine), `verify_bip39.py` (verifier/generator), `test_bip39.py` (verifier tests), and
`test_browser.html` / `test_browser.js` (browser regressions). Deleting `tts-remote.js` and its script
tag leaves device and silent modes usable.

## Troubleshooting

- **No local voice:** install an OS speech voice, reload, or choose No voice. Unknown/network voices
  are deliberately excluded. Test pronunciation and advancement before relying on the reader.
- **Remote request blocked from `file://`:** a local file commonly has the browser origin `null`.
  CORS is the server's rule for which browser pages may read responses. `null` does not identify this
  app: sandboxed and other opaque-origin pages can have it too. Do not broadly trust null origins,
  disable browser security, or expose an unauthenticated service. Use an operator-reviewed CORS and
  authentication configuration, bind local services to loopback, or use local device speech instead.
- **Raw bytes wrong but content right:** download the raw canonical file again; do not edit the hash
  constant to make a file pass. CRLF, a BOM, or whitespace can change the raw hash.

## License and disclosure

MIT for rights held by project contributors: see [LICENSE](LICENSE). Word-list attribution and
third-party license text are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Code was developed
with AI assistance through VS Code/Cline using multiple models. This is not an independent audit or
a guarantee of provenance; see the notices for the remaining limitations.

Security scope and reporting: [SECURITY.md](SECURITY.md). Publication gates: [RELEASE.md](RELEASE.md).