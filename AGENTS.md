# AGENTS.md

Instructions, architecture constraints and invariants for AI coding agents working on the
**BIP-39 Word Reader** codebase.

---

## 1. Project overview & philosophy

`bip39-word-reader` is a zero-tooling, offline-first web utility: it reads the 2,048 BIP-39 English
words aloud in order so a human can check a physical copy of the list (Entropia tablets, a printout,
etc.) without looking away from it.

**Core principles**

1. **Zero tooling / zero build step.** The app must run by opening `index.html` from `file://`. No
   Node.js, npm, bundlers, transpilers or minifiers. No package manager files may be added.
2. **Cryptographic rigor.** The list is tethered to the canonical upstream `english.txt` by raw-byte
   SHA-256, checked in the browser (`sha256.js`, two implementations cross-compared) and outside it
   (`verify_bip39.py`).
3. **Offline-first speech.** Device mode uses only browser-identified local voices, never an
   unspecified default or network voice. Confirm disconnected playback: metadata is not an OS audit.
   No application network requests in device/silent mode; no external dependencies or telemetry.
4. **SeedSigner UI alignment.** Dark theme built only from the tokens in section 3.

## 2. Invariants (do not break these)

1. **`file://` execution.** Never use ES module `import`/`export` or `type="module"`. All scripts are
   classic scripts loaded in order: `words.js`, `sha256.js`, `tts-remote.js`, `app.js`.
   `words.js` declares the global binding `EMBEDDED_WORDS`; `app.js` reads it through a
   `typeof EMBEDDED_WORDS !== 'undefined'` guard. There is no runtime `fetch()` of `english.txt` -
   that fetch was removed because it silently depended on being served over HTTP.
2. **`english.txt` is byte-exact.** It is the canonical upstream file: 13,116 bytes, LF endings, no
   BOM, no trailing blank line, SHA-256
   `2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda`. `.gitattributes` pins
   `*.txt` and `words.js` to `eol=lf`; never remove that file. Never edit the hash constant without an
   explicit user directive.
3. **`words.js` is generated, not edited.** Its shape is exactly one statement:
   `const EMBEDDED_WORDS = ["abandon", ...];\n`. Regenerate it with
   `python verify_bip39.py --write-words-js`. `verify_bip39.py` rejects anything prepended or
   appended, reformatted, quoted with single quotes, or containing a non-string entry.
   Never reintroduce the old "hash the text between the first `[` and the last `]`" logic.
4. **Compare, never replace.** The "Check against my download" panel compares a user-supplied file
   with the list being read aloud. It must never swap the active list, and it must never claim a match
   without hashing the raw bytes.
5. **No `bips` submodule, no vendored copies.** The upstream repository is referenced in `VERIFY.md`
   only. `.gitmodules` must not exist.
6. **Standard library only for tooling.** `verify_bip39.py` and `test_bip39.py` may import only:
   `hashlib`, `json`, `argparse`, `sys`, `pathlib`, `unittest`, `tempfile`, `shutil`. No `pip install`.
7. **Memory-only API keys.** The remote TTS key lives in a JavaScript variable. It must never be
   written to `localStorage`, `sessionStorage`, cookies, IndexedDB or the URL. Endpoint, model and
   voice name may be persisted.
8. **DOM security.** Never use `innerHTML` for user-supplied text (files, clipboard, TTS responses).
   Use `textContent` and `document.createElement`. `innerHTML` is acceptable only for fixed entity
   strings written in `app.js` itself.
9. **Network is opt-in.** The only network code is in `tts-remote.js`, and it runs only while the
   remote engine is selected (`TTSRemote.setActive(true)`). `sha256.js` and `app.js` must stay
   network-free.
10. **Playback correctness.** One playback loop owns advancement. Every word is awaited exactly once
    through a session token (`sessionId`) that invalidates stale `onend` handlers, timers and in-flight
    audio. Pause, jump, repeat and engine changes must never double-advance or skip a word.
11. **Public inventory only.** Close the app and remove the device before selecting seed words.
    Never describe end-of-list or list position as verified coverage. Remote selection is not restored
    after reopening, and only deliberate playback/testing starts requests; prefetch is restricted to
    the playback loop, not display updates or paused navigation.

## 3. SeedSigner aesthetic tokens

| Token | CSS variable | Value | Purpose |
|---|---|---|---|
| Background | `--bg` | `#000000` | True black canvas |
| Surface | `--card-bg` | `#141414` | Card background |
| Border | `--card-border` | `#2C2C2C` | Subtle dividers |
| Active accent | `--accent` | `#FF9F0A` | Active orange |
| Primary text | `--text` | `#FCFCFC` | Foreground text |
| Muted text | `--text-muted` | `#8E8E93` | Secondary labels |
| Success | `--success` | `#30D158` | Verified state |
| Error | `--error` | `#FF1B0A` | Integrity mismatch |
| Warning | `--warn` | `#FFD60A` | Formatting-only / network caveats |

Colors are defined once in `:root` and used through `var()`. No inline `style` attributes in markup;
state classes go on the elements (`hidden`, `current`, `speaking`, `mismatch`, `ok`, `warn`, `error`).

## 4. File map

| File | Role |
|---|---|
| `index.html` | Markup, minimal CSP meta (`object-src`/`base-uri`/`form-action` only) |
| `app.js` | Word list display, single playback loop, compare panel, settings, shortcuts |
| `words.js` | Generated word array (do not hand-edit) |
| `english.txt` | Byte-exact canonical list |
| `sha256.js` | WebCrypto + pure-JS SHA-256, self-test vectors, cross-comparison |
| `tts-remote.js` | Optional OpenAI-compatible TTS engine; deletable |
| `style.css` | All styling |
| `verify_bip39.py` | CLI verifier and `--write-words-js` generator |
| `test_bip39.py` | Negative/fuzz tests for the verifier |
| `test_browser.html`, `test_browser.js` | Dependency-free browser regressions with mocked services |
| `TESTING.md`, `RELEASE.md` | Manual checks and publication gates |
| `THIRD_PARTY_NOTICES.md` | Word-list notice, sources, and provenance limitations |
| `VERIFY.md` | Human verification procedure |
| `SECURITY.md` | Scope and reporting |

## 5. Testing & validation

Run both, and require exit code `0` before submitting any change:

```bash
python verify_bip39.py
python test_bip39.py
```

`test_bip39.py` sets `sys.dont_write_bytecode = True` above its import of the verifier, so running the
tests leaves no `__pycache__` folder behind. Keep that line above the import.

`test_bip39.py` covers: canonical fixtures, truncated / mutated / transposed / duplicated lists, CRLF
and BOM (fail on bytes, still recognized as content-identical), binary garbage, injected JavaScript
before and after the array, non-string entries, malformed JSON, single quotes, desynchronized lists,
SHA-256 test vectors, and `--write-words-js` round-tripping.

Open `test_browser.html` from `file://` and require all tests to pass. The harness mocks speech,
fetch, audio, and timers, not the application scripts. Complete the real-browser/manual checklist
in `TESTING.md` too; mocked results do not establish real voice quality or offline OS behavior.

## 6. Style conventions

- `app.js` is one IIFE in strict mode, modern syntax (`const`/`let`, arrow functions, `async`/`await`).
  `sha256.js` and `tts-remote.js` are ES5-flavored IIFEs that use `async`/`await` only where needed,
  because they touch WebCrypto and `AbortController`; keep them dependency-free and readable rather
  than clever.
- Comments explain *why*, in plain sentences. No commented-out code, no `TODO` without a reason.
- UI copy is sentence case, no marketing adjectives, and states consequences ("every word you play is
  sent to ...") rather than reassurance ("100% secure").
- Python: type hints on public helpers, `%`-style formatting inside long messages, docstrings that say
  what a failure means.
  