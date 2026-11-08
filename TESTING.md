# Validation and human checks

## Recorded validation: 2026-11-07

Windows, Microsoft Edge 156.0.4314.58 (headless), loaded from `file://`:

- Canonical CLI verifier: exit 0; all 42 Python tests: passed.
- JavaScript syntax checks: passed for all four application scripts and `test_browser.js`.
- Browser regression harness: **38/38 passed**, including ignored abort, delayed body, cached
  continuation cancellation, no AbortController, stale comparison hashing, and page restore.
- Actual `index.html` integration, separate from the harness fixtures: 2,048 word chips rendered;
  canonical badge and both hash engines completed; pending upload status displayed. Actual `File`
  objects assigned through `DataTransfer` produced canonical green, mutated red, and BOM amber.
  These fixtures were generated from the embedded public list; an independent upstream download
  comparison remains a manual check.
- Actual silent playback advanced from word 2,047 to 2,048 and displayed the correct end message.
  Reload with a saved remote preference kept remote inactive, restored its endpoint, and produced
  no HTTP requests or uncaught page exceptions during the observed integration run.
- Canonical word files, hash constant, hash implementation, and project MIT license were unchanged.
  Basic credential/private-path patterns and local document links had no findings; that scan is not
  a complete secret or provenance audit.

**Still manual:** audible pronunciation/advancement with real system speech while physically
disconnected, visual/accessibility review, independently downloaded comparison input, and an actual
delayed-response TTS service with its CORS/authentication. Mocked audio results are not a substitute.
No real provider was contacted and no real API key was used in these tests. Browser profiles and
headless output were isolated in temporary storage outside the repository. Node.js was used only as
an available syntax/integration driver during development; it is not an application dependency.

## Automated checks (no packages or build step)

Run from this folder:

```
python verify_bip39.py
python test_bip39.py
```

Require exit 0 from both. The 42 Python tests include temporary-file negative cases and remove their
temporary workspaces. `english.txt` and generated `words.js` must remain unchanged.

Open `test_browser.html` from `file://` in a browser. Its summary must say all tests passed. The page
loads actual application scripts in isolated `srcdoc` frames and substitutes in-memory storage,
speech synthesis, fetch, audio, and timers. Fetch deliberately ignores abort, so generation guards
must prevent late audio. No provider, key, package, or server is needed. Tests cover:

- Canonical/formatting/mutated comparisons, matching corrupted lists, failed hash self-tests and
  engine disagreement, pure-JS fallback, stale comparisons, and text-only rendering.
- Empty, network-only, unknown, and mixed voice lists; saved network voice preference.
- Saved remote startup with no requests, inactive API enforcement, cancellation before headers and
  during body decoding, active-audio settlement, timeout, and ignored abort.
- Settings/engine changes, isolated voice tests, API-key nonpersistence, jump/repeat/pause/resume,
  silent timers, last-word resume, optional remote-script removal, and 2,049 binary hash inputs.

This is a regression harness, not a security sandbox. Do not use it for secrets. It does not prove
real audio quality, browser speech-service behavior, provider CORS behavior, or the absence of bugs.

## Manual release checks

Use public inventory words and dummy credentials only. Record browser version, OS, date, and results.

1. Open `index.html` directly from `file://`. Check the workflow warning, usable layout, and canonical
   badge. Expand hash details. Before uploading, there is no claim of independent-download verification.
2. Compare an independently downloaded canonical file: green MATCH with separate passed checks.
   Compare an edited copy: red. CRLF/BOM copies: amber. Reload: the upload never changed the active list.
3. With a local voice installed, disconnect the device network, reload, and verify speech starts,
   pronounces words understandably, and advances. Pause, resume, jump, repeat, change engine, and
   change voice. No double advancement or unexpected late audio. If no local voice exists, verify a
   clear error and use No voice. Browser voice metadata alone is not proof of offline behavior.
4. Open browser developer tools before playback. In device/silent mode, application code should
   make no network requests. Browser/OS traffic is separate; do not infer that DevTools captures all
   system traffic. Intentional external guidance navigation is outside the TTS path.
5. Set a distinctive endpoint/model/voice, select remote, then close and reopen. Endpoint/model/voice
   may restore, but remote mode must not reactivate and startup must not issue speech requests. No
   API key should restore. Position, delay, rate, and local voice may restore.
6. Start at word 2,048 (`zoo`), play it, and verify “Reached the end of the list.” The bar must say
   list position, not claim that 2,048 words have been checked.
7. If you operate an optional TTS service, test its actual CORS/authentication and audio behavior.
   Do not weaken browser security or broadly trust `Origin: null` to make it work. Confirm that Test
   sends `bitcoin`, and Play may prefetch the next word. Inspect memory-only key handling with dummy
   credentials, not a real key in screenshots or reports.

## Human reproduction of the old delayed-audio bug

You do not need a paid provider: `test_browser.html` has deterministic no-network reproductions.
For a real-service check, use only a service you already operate or intend to use:

1. Open `index.html` in Edge/Chrome, open DevTools (`F12`), select **Network**, and choose a slow
   throttling profile (or create one with several seconds of latency). Keep DevTools open.
2. Select remote mode and configure the service. Pick a word not yet cached, then press Play.
3. While its POST `/audio/speech` is pending and before sound begins, press Pause. Wait longer than
   the configured latency. A fixed app must remain silent and at the same position. Canceled network
   entries are expected. Browser throttling or a slow service is needed to make the timing visible.
4. Repeat while switching to device mode, editing the endpoint/model, and navigating to another word.
   Only newly requested playback may speak; an old delayed response must not start audio. Requests
   already received by the service cannot be retracted by the browser.

The old bug was that Pause stopped only an audio object that already existed; a pending response
could subsequently create another one. The regression also forces the response body to finish late,
and a fetch mock that ignores AbortController, to check both boundaries.

## Human check for the old startup-order bug

Previously, a saved remote selection could prepare audio before its configuration controls were
initialized, interrupting startup before the integrity badge ran. Select remote mode, close/reopen
the page, and confirm the console has no uncaught startup error, the badge completes, and no remote
request occurs. Remote preferences may restore; permission to make requests must not.