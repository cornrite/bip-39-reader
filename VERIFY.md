# VERIFY.md - checking this app without trusting it

This app helps check a BIP-39 word list, keeping your hands and eyes free to inspect a printout
or Entropia tablets. Close the app and remove the reader device before selecting seed words.
Never upload private key material. The upstream download requires a network; local hash tools
and Python are optional checks, not prerequisites for running the app.

There are three separate things to check, and they are not the same:

| Question | How |
|---|---|
| Is the word list on disk the canonical BIP-39 English list? | Step 3 (hash your download) and Step 4 (check this folder's copy) |
| Does the app read the same words I downloaded? | Step 2 (in-app compare) |
| Does the app's JavaScript do anything sneaky? | Step 5 (read it, run the tests, watch the network) |

Checks 2-4 help establish list integrity. Step 5 is code review and testing, not proof of honest code.
Do not use this app with a seed phrase. An application that displays public words can still leak
private choices if used during selection. Inventory completeness does not establish randomness.

The canonical fingerprint, over the 2,048 words joined by `\n` with a trailing `\n` (the exact bytes
of upstream `english.txt`, 13,116 bytes):

```
2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda
```

---

## Step 0 - Get your own copy of the list

Do not rely on the copy inside this folder for this step. Download `english.txt` yourself from the
upstream repository:

- `bitcoin/bips` -> `bip-0039/english.txt`

Use the **Raw** button on GitHub and save the file (`Ctrl+S` / `Cmd+S`). Do not copy and paste the
text out of the browser page: that is how trailing spaces, CRLF line endings and missing final
newlines get introduced.

---

## Step 1 - In-app badge

Open `index.html`. The badge under the title reads *"Word list matches the canonical BIP-39 hash"*
when the embedded list hashes to the fingerprint above. Click the badge to see:

- the hash of the list the app is using, in groups of four characters,
- the canonical hash for comparison,
- which hash engines ran: `2 independent SHA-256 implementations agree` means both WebCrypto and the
  pure-JavaScript implementation produced the same digest.

A red badge means canonical content or the hash subsystem could not be verified. Stop there.
This badge is separate from the download comparison; without an upload, no independent-download
comparison has been performed. It does not verify your physical inventory or the app's code.

## Step 2 - Compare against your own download

Click **Check against my download** and pick the public `english.txt` from Step 0. Outcomes:

| Result | Meaning |
|---|---|
| **MATCH** (green) | Hash checks passed; the active list and normalized upload are canonical, their words agree in order, and the upload's raw bytes have the canonical hash |
| **Canonical words, different file formatting** (amber) | Active and uploaded canonical content agree, but uploaded raw bytes are not canonical; raw-byte verification did not pass |
| **MISMATCH / Not verified** (red) | Content differs, content is noncanonical even if both lists agree, or a hash check failed. Resolve the reported failures before use |

The report separates hash validity, active canonical content, uploaded canonical raw bytes,
uploaded normalized canonical content (including the word count), and equality with the active list.
All must pass for green. Normalization trims lines and removes blank lines; a normalized match is
not a raw-byte match. The check is read-only: uploads never replace the list being read aloud.

## Step 3 - Hash the file yourself

Never trust a hash that a tool prints for a file the tool also chose. Run this in the folder with
*your* downloaded `english.txt`:

**Windows (PowerShell)**
```powershell
Get-FileHash -Algorithm SHA256 .\english.txt
```

**Windows (certutil)**
```
certutil -hashfile english.txt SHA256
```

**macOS**
```bash
shasum -a 256 english.txt
```

**Linux**
```bash
sha256sum english.txt
```

Expected output (any case):

```
2F5EED53A4727B4BF8880D8F3F199EFC90E58503646D9FF8EFF3A2ED3B24DBDA
```

If it does not match, the file is not the canonical list - most often because it was saved with CRLF
line endings or a BOM. Download the raw file again before doing anything else.

## Step 4 - Check this folder's copy

Step 3 checked your own download. This checks the copy that ships with the app, and the `words.js`
that the page actually reads:

```bash
python verify_bip39.py
```

It checks the raw bytes of `english.txt`, the word count and uniqueness, and that `words.js` is
exactly one generated statement with nothing prepended or appended. That last check exists because an
earlier version of the script only hashed the text between the first `[` and the last `]`, so a
`words.js` with arbitrary JavaScript smuggled in after the array still "passed".

## Step 5 - Check the code, not just the list

Nothing here needs a build tool.

```bash
python verify_bip39.py     # word list: bytes, content, words.js shape
python test_bip39.py       # 42 tests, mostly negative: corrupted lists and injected code must fail
```

Both must exit `0`. Open `test_browser.html` from `file://` for dependency-free script regressions
with mocked audio/network, then complete the manual checks in [TESTING.md](TESTING.md).
Read the code with specific questions in mind:

- Search the JavaScript for `fetch`, `XMLHttpRequest`, `WebSocket` and `sendBeacon`. The only network
  code must be in `tts-remote.js`, active only after deliberate remote selection and Play/Repeat/Test.
  Prefetch can send upcoming words during playback; restoring settings must not start requests.
- Search for `localStorage`, `sessionStorage` and `document.cookie`. Settings may be saved; the API
  key must not be (it is described as "memory only" in the UI and it is).
- `words.js` must be a single line: `const EMBEDDED_WORDS = [...];` and nothing else.

The honest summary of the app's capability: it reads a public word list, speaks it, and optionally
POSTs played and prefetched public words to a TTS endpoint you configure yourself. The voice test
sends `bitcoin`. Loopback endpoints may themselves forward requests.

## Going offline

When you are satisfied, disconnect the network (or switch the browser to offline mode), reload the
page, and confirm playback still works with a local voice. If a voice stops working when you pull the
plug, investigate the browser/OS speech service; do not assume the local metadata guarantees offline
operation. The picker excludes unknown/network voices and does not use an unspecified default.

---

## What these checks do not prove

- They do not prove the operating system, browser or a browser extension is honest. A compromised
  machine can show you anything. For maximum assurance, do this on a freshly booted machine.
- They do not prove the app is free of bugs, legally cleared, or independently audited. Hash checks
  establish a content fingerprint under the stated trust assumptions; review and tests have limits.
- A green badge is not an audit. The verifier and the app share the same idea of "canonical"; the
  point of Step 3 is that the hash is checked with a tool that knows nothing about this project.
- They do not prove that the upstream repository was never altered: Step 0 uses a single source.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `FAIL english.txt holds the right words but the wrong bytes` | CRLF line endings or a BOM. Re-download the raw file; do not change the expected hash |
| Badge says *1 implementation (pure JS)* | WebCrypto is unavailable - typically `http://` on a LAN address, or an old browser. Still valid, just a single engine |
| Badge says *Hash self-test FAILED* | The pure-JS SHA-256 failed its published test vectors. Do not trust the page |
| Compare says amber | Your file's words are right, its bytes are not (usually line endings) |
| Compare says red at word #N | The file is a different list or was edited. Re-download it |
| Remote TTS request blocked | Local files commonly have `Origin: null`. This is not authentication or a unique app identity; do not broadly trust it. Use operator-reviewed CORS/authentication or device speech. See README.md |

