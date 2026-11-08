/* Dependency-free browser regression harness. Fixtures never call real speech or fetch. */
(function () {
  'use strict';

  const fixtures = new Map();
  const tests = [];
  const canonical = EMBEDDED_WORDS.join('\n') + '\n';
  let sequence = 0;
  let current = null;
  const localVoice = { name: 'Local English', lang: 'en-US', localService: true };
  const networkVoice = { name: 'Network English', lang: 'en-US', localService: false, default: true };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const test = (name, run) => tests.push({ name, run });

  async function until(predicate, message) {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await tick();
    }
    throw new Error(message || 'Timed out waiting for state');
  }

  function setup(win, id) {
    const f = fixtures.get(id);
    f.win = win;
    f.doc = win.document;
    f.errors = [];
    f.storage = new Map(Object.entries(f.options.saved || {}));
    f.requests = [];
    f.audios = [];
    f.spoken = [];
    f.urls = [];
    f.revoked = [];
    f.timers = new Map();
    f.voices = f.options.voices || [networkVoice, localVoice];
    win.addEventListener('error', (event) => f.errors.push(event.message));
    win.addEventListener('unhandledrejection', (event) => f.errors.push(String(event.reason)));
    Object.defineProperty(win, 'localStorage', { value: {
      getItem: (key) => f.storage.has(key) ? f.storage.get(key) : null,
      setItem: (key, value) => f.storage.set(key, String(value))
    } });
    let timerId = 0;
    win.setTimeout = (callback, ms) => {
      f.timers.set(++timerId, { callback, ms });
      return timerId;
    };
    win.clearTimeout = (id) => f.timers.delete(id);
    Object.defineProperty(win, 'speechSynthesis', { value: {
      getVoices: () => f.voices,
      cancel: () => {},
      speak: (utterance) => {
        f.spoken.push(utterance);
        if (utterance.onstart) utterance.onstart();
      }
    } });
    win.SpeechSynthesisUtterance = function (text) { this.text = text; };
    win.fetch = (url, options) => new Promise((resolve, reject) => {
      // Deliberately ignore abort so generation guards, not just AbortController, are exercised.
      f.requests.push({ url, options, resolve, reject, word: JSON.parse(options.body).input });
    });
    win.Audio = function (url) {
      this.url = url;
      this.play = () => { this.played = true; return Promise.resolve(); };
      this.pause = () => { this.paused = true; };
      f.audios.push(this);
    };
    win.URL.createObjectURL = () => {
      const url = 'blob:fixture-' + id + '-' + f.urls.length;
      f.urls.push(url);
      return url;
    };
    win.URL.revokeObjectURL = (url) => f.revoked.push(url);
    f.el = (id) => f.doc.getElementById(id);
    f.click = (id) => f.el(id).click();
    f.change = (id, value, type = 'change') => {
      f.el(id).value = value;
      f.el(id).dispatchEvent(new win.Event(type, { bubbles: true }));
    };
    f.respond = (request, blobPromise) => request.resolve({
      ok: true,
      blob: () => blobPromise || Promise.resolve(new win.Blob(['mock audio']))
    });
    f.fireTimers = (filter = () => true) => {
      [...f.timers].forEach(([id, timer]) => {
        if (!filter(timer.ms)) return;
        f.timers.delete(id);
        timer.callback();
      });
    };
    f.compare = (text, name = 'public-list.txt', delayed) => {
      const bytes = new TextEncoder().encode(text);
      const file = { name, arrayBuffer: () => delayed || Promise.resolve(bytes.buffer) };
      Object.defineProperty(f.el('compareInput'), 'files', { configurable: true, value: [file] });
      f.el('compareInput').dispatchEvent(new win.Event('change'));
    };
    f.compareDone = () => until(() => !f.el('compareResult').textContent.startsWith('Reading '));
    f.finishWord = () => {
      const utterance = f.spoken[f.spoken.length - 1];
      if (utterance && utterance.onend) utterance.onend();
    };
  }

  function prepare(win, words, id) {
    const options = fixtures.get(id).options;
    if (options.corrupt) words[0] = 'notcanonical';
    if (options.selfTestFail) win.SHA256.selfTest = () => false;
    if (options.noCrypto) Object.defineProperty(win, 'crypto', { value: {} });
    if (options.disagree) {
      Object.defineProperty(win, 'crypto', { value: { subtle: {
        digest: () => Promise.resolve(new Uint8Array(32).buffer)
      } } });
    }
  }

  window.ReaderTests = { setup, prepare };

  async function fixture(options = {}) {
    const id = ++sequence;
    const f = { options };
    fixtures.set(id, f);
    const frame = document.createElement('iframe');
    f.frame = frame;
    current = f;
    const ids = ['stageCard', 'wordPrefix', 'wordSuffix', 'indexBadge', 'statusText',
      'progressBarFill', 'progressBarContainer', 'progressPercent', 'progressWords', 'verifyBadge',
      'verifyIcon', 'verifyText', 'verifyDetails', 'currentHash', 'hashEngines', 'delayVal', 'rateVal',
      'deviceVoiceGroup', 'voiceNote', 'remotePanel', 'compareResult', 'wordsContainer',
      'remoteFeedback', 'remoteWarning'];
    const buttons = ['playBtn', 'prevBtn', 'nextBtn', 'repeatBtn', 'resetBtn', 'jumpBtn', 'searchBtn',
      'compareBtn', 'scrollCurrentBtn', 'remoteLocalPreset', 'remoteTestBtn'];
    const inputs = ['delaySlider', 'rateSlider', 'jumpIndex', 'searchWord', 'compareInput',
      'remoteApiKey'];
    let markup = '<div id="workflowWarning"><p>Public inventory warning</p>' +
      '<button type="button" id="closeWorkflowWarningBtn" aria-label="Dismiss workflow warning">&times;</button></div>' +
      ids.map((id) => '<div id="' + id + '"></div>').join('') +
      buttons.map((id) => '<button id="' + id + '"></button>').join('') +
      inputs.map((id) => '<input id="' + id + '">').join('') +
      '<select id="engineSelect"><option value="device">Device</option><option value="silent">Silent</option><option value="remote">Remote</option></select>' +
      '<select id="voiceSelect"></select><input id="remoteEndpoint" value="https://example.invalid/v1">' +
      '<input id="remoteModel" value="tts-1"><input id="remoteVoice" value="alloy">';
    const script = (source) => '<script>' + source + '<' + '/script>';
    const external = (name) => '<script src="' + name + '"><' + '/script>';
    markup += script('parent.ReaderTests.setup(window,' + id + ');') +
      external('words.js') + external('sha256.js') +
      script('parent.ReaderTests.prepare(window,EMBEDDED_WORDS,' + id + ');') +
      (options.noRemote ? '' : external('tts-remote.js')) + external('app.js');
    const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    frame.srcdoc = '<!doctype html><html><body>' + markup + '</body></html>';
    document.getElementById('testFrames').appendChild(frame);
    await loaded;
    await until(() => f.el('verifyText').textContent !== '', 'App did not initialize');
    await tick();
    assert(!f.errors.length, f.errors.join('; '));
    return f;
  }

  async function remotePlaying() {
    const f = await fixture();
    f.change('engineSelect', 'remote');
    assert(f.requests.length === 0, 'Selecting mode must not start requests');
    f.click('playBtn');
    assert(f.requests.length === 2, 'Expected current word and next-word prefetch');
    return f;
  }

  test('Workflow warning dismisses without playback or saved dismissal', async () => {
    const f = await fixture();
    const saved = JSON.stringify([...f.storage]);
    assert(!f.el('workflowWarning').classList.contains('hidden'), 'Warning should start visible');
    f.click('closeWorkflowWarningBtn');
    assert(f.el('workflowWarning').classList.contains('hidden'), 'Warning was not dismissed');
    assert(f.spoken.length === 0 && f.requests.length === 0, 'Dismissal started playback or network');
    assert(JSON.stringify([...f.storage]) === saved, 'Dismissal persisted a setting');
  });

  test('Workflow warning close button keeps native keyboard activation without playback shortcut', async () => {
    const f = await fixture();
    for (const key of [' ', 'Spacebar', 'Enter']) {
      const event = new f.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      f.el('closeWorkflowWarningBtn').dispatchEvent(event);
      assert(!event.defaultPrevented, 'Native button activation was blocked');
    }
    assert(f.spoken.length === 0 && f.requests.length === 0, 'Close button keyboard event started playback');
  });

  test('Canonical badge and raw download produce green MATCH', async () => {
    const f = await fixture();
    assert(!f.el('verifyBadge').classList.contains('mismatch'), 'Canonical badge failed');
    f.compare(canonical);
    await f.compareDone();
    assert(f.el('compareResult').classList.contains('ok'), 'Canonical upload not green');
    assert(f.el('compareResult').textContent.includes('Uploaded normalized canonical content: passed'), 'Missing distinct status');
  });

  test('CRLF, BOM, whitespace, and missing final LF are amber, never green', async () => {
    const f = await fixture();
    for (const text of [canonical.replace(/\n/g, '\r\n'), '\uFEFF' + canonical, ' ' + canonical, canonical.trimEnd()]) {
      f.compare(text);
      await f.compareDone();
      assert(f.el('compareResult').classList.contains('warn'), 'Formatting-only upload not amber');
    }
  });

  test('Edited download is red and never replaces the active list', async () => {
    const f = await fixture();
    f.compare(canonical.replace('abandon', 'wrong'));
    await f.compareDone();
    assert(f.el('compareResult').classList.contains('error'), 'Mutated upload not red');
    assert(f.el('wordPrefix').textContent === 'aban', 'Upload replaced active words');
  });

  test('Matching corrupted lists cannot produce reassurance', async () => {
    const f = await fixture({ corrupt: true });
    f.compare(canonical.replace('abandon', 'notcanonical'));
    await f.compareDone();
    assert(f.el('verifyBadge').classList.contains('mismatch'), 'Corrupt active badge not red');
    assert(f.el('compareResult').classList.contains('error'), 'Matching corrupt lists not red');
  });

  test('Failed self-test blocks green download comparison', async () => {
    const f = await fixture({ selfTestFail: true });
    f.compare(canonical);
    await f.compareDone();
    assert(f.el('compareResult').classList.contains('error'), 'Self-test failure allowed success');
  });

  test('Hash-engine disagreement fails closed', async () => {
    const f = await fixture({ disagree: true });
    f.compare(canonical);
    await f.compareDone();
    assert(f.el('verifyBadge').classList.contains('mismatch'), 'Disagreement badge not red');
    assert(f.el('compareResult').classList.contains('error'), 'Disagreement allowed green');
  });

  test('Pure-JS fallback passes vectors and canonical comparison', async () => {
    const f = await fixture({ noCrypto: true });
    f.compare(canonical);
    await f.compareDone();
    assert(f.el('hashEngines').textContent.startsWith('1 implementation'), 'Fallback not labelled');
    assert(f.el('compareResult').classList.contains('ok'), 'Fallback canonical comparison failed');
  });

  test('Older asynchronous comparison cannot overwrite the latest result', async () => {
    const f = await fixture();
    let release;
    f.compare(canonical, 'older.txt', new Promise((resolve) => { release = resolve; }));
    await tick();
    f.compare(canonical.replace('abandon', 'wrong'), 'newer.txt');
    await f.compareDone();
    release(new TextEncoder().encode(canonical).buffer);
    await tick();
    assert(f.el('compareResult').textContent.includes('newer.txt'), 'Older result won race');
    assert(f.el('compareResult').classList.contains('error'), 'Older green overwrote red');
  });

  test('Older hash result cannot overwrite a newer comparison', async () => {
    const f = await fixture();
    const hashBytes = f.win.SHA256.hashBytes;
    let release;
    let calls = 0;
    f.win.SHA256.hashBytes = (bytes) => {
      if (++calls === 1) return new Promise((resolve) => { release = () => hashBytes(bytes).then(resolve); });
      return hashBytes(bytes);
    };
    f.compare(canonical, 'older-hash.txt');
    await until(() => release);
    f.compare(canonical.replace('abandon', 'wrong'), 'newer-hash.txt');
    await f.compareDone();
    release();
    await tick();
    assert(f.el('compareResult').textContent.includes('newer-hash.txt'), 'Stale hash result won');
    assert(f.el('compareResult').classList.contains('error'), 'Stale hash made green');
  });

  test('Hash failure after successful startup invalidates prior green status', async () => {
    const f = await fixture();
    f.compare(canonical);
    await f.compareDone();
    f.win.SHA256.hashBytes = () => Promise.reject(new Error('forced engine disagreement'));
    f.compare(canonical);
    await f.compareDone();
    assert(f.el('verifyBadge').classList.contains('mismatch'), 'Old badge stayed green');
    assert(f.el('compareResult').classList.contains('error'), 'Old comparison stayed green');
  });

  test('Untrusted file names and words remain text', async () => {
    const f = await fixture();
    f.compare(canonical.replace('abandon', '<img src=x onerror=alert(1)>'), '<svg onload=alert(1)>');
    await f.compareDone();
    assert(!f.el('compareResult').querySelector('img,svg'), 'User text became markup');
  });

  for (const [label, voices] of [['empty', []], ['network-only', [networkVoice]], ['unknown', [{ name: 'Unknown' }]]]) {
    test(label + ' voice list never invokes browser-default speech', async () => {
      const f = await fixture({ voices });
      f.click('playBtn');
      await tick();
      assert(f.spoken.length === 0, 'Unidentified voice used');
      assert(f.el('statusText').textContent.includes('no identified local voice'), 'Missing voice explanation');
    });
  }

  test('Only identified local voices are selectable, including saved network preference', async () => {
    const f = await fixture({ saved: { wordReader_voice: networkVoice.name } });
    assert(f.el('voiceSelect').options.length === 1, 'Network voice offered');
    f.click('playBtn');
    assert(f.spoken[0].voice.localService === true, 'Network preference restored');
    assert(f.requests.length === 0, 'Device path made a request');
  });

  test('Saved remote mode starts safely with no network and integrity initialized', async () => {
    const f = await fixture({ saved: { wordReader_engine: 'remote', wordReader_remoteEndpoint: 'http://localhost:8000/v1' } });
    assert(f.el('engineSelect').value !== 'remote', 'Remote consent restored');
    assert(f.requests.length === 0, 'Startup made a request');
    assert(f.el('verifyText').textContent.includes('canonical'), 'Integrity initialization skipped');
    assert(f.el('remoteEndpoint').value === 'http://localhost:8000/v1', 'Endpoint preference not restored');
  });

  test('Remote API refuses inactive speech and prefetch', async () => {
    const f = await fixture();
    let rejected = false;
    await f.win.TTSRemote.speak('abandon', 1).catch(() => { rejected = true; });
    f.win.TTSRemote.prefetch('ability');
    assert(rejected && f.requests.length === 0, 'Inactive engine made requests');
  });

  test('Pause while fetch is pending prevents late audio, even if abort is ignored', async () => {
    const f = await remotePlaying();
    f.click('playBtn');
    f.requests.forEach((r) => f.respond(r));
    await tick();
    assert(f.audios.length === 0 && f.urls.length === 0, 'Late response created audio');
    assert(f.el('indexBadge').textContent === 'Word 1 of 2,048', 'Paused request advanced position');
    assert(f.requests.every((r) => r.options.signal.aborted), 'Requests were not aborted');
  });

  test('Pause after headers but before body prevents late audio', async () => {
    const f = await remotePlaying();
    const request = f.requests.find((r) => r.word === 'abandon');
    let release;
    f.respond(request, new Promise((resolve) => { release = resolve; }));
    await tick();
    f.click('playBtn');
    release(new f.win.Blob(['late audio']));
    await tick();
    assert(f.audios.length === 0 && f.urls.length === 0, 'Late body played');
  });

  test('Cancellation without AbortController still settles and blocks late audio', async () => {
    const f = await fixture();
    f.win.AbortController = undefined;
    f.win.TTSRemote.setActive(true);
    let settled = false;
    f.win.TTSRemote.speak('abandon', 1).then(() => { settled = true; }, () => { settled = true; });
    f.win.TTSRemote.stop();
    await tick();
    assert(settled, 'No-AbortController cancellation did not settle');
    f.respond(f.requests[0]);
    await tick();
    assert(f.urls.length === 0 && f.audios.length === 0, 'No-AbortController late response played');
  });

  test('Cached audio cannot start after same-turn cancellation', async () => {
    const f = await fixture();
    f.win.TTSRemote.setActive(true);
    f.win.TTSRemote.prefetch('abandon');
    f.respond(f.requests[0]);
    await until(() => f.urls.length === 1);
    await tick();
    let settled = false;
    f.win.TTSRemote.speak('abandon', 1).then(() => { settled = true; }, () => { settled = true; });
    f.win.TTSRemote.stop();
    await tick();
    assert(settled && f.audios.length === 0, 'Cached continuation escaped cancellation');
    assert(f.requests.length === 1, 'Cache unexpectedly requested again');
  });

  test('Deactivation prevents pending speech and settles its promise', async () => {
    const f = await fixture();
    f.win.TTSRemote.setActive(true);
    let settled = false;
    f.win.TTSRemote.speak('abandon', 1).then(() => { settled = true; }, () => { settled = true; });
    f.win.TTSRemote.setActive(false);
    await tick();
    assert(settled, 'Pending speech did not settle');
    f.respond(f.requests[0]);
    await tick();
    assert(f.audios.length === 0, 'Inactive engine played audio');
  });

  test('Stopping active audio settles playback and ignores saved end callback', async () => {
    const f = await fixture();
    f.win.TTSRemote.setActive(true);
    let settled = false;
    f.win.TTSRemote.speak('abandon', 1).then(() => { settled = true; });
    f.respond(f.requests[0]);
    await until(() => f.audios.length === 1);
    const ended = f.audios[0].onended;
    f.win.TTSRemote.stop();
    await tick();
    assert(settled && f.audios[0].paused, 'Active audio did not stop and settle');
    ended();
  });

  test('Request timeout settles even when fetch ignores abort; late response is discarded', async () => {
    const f = await fixture();
    f.win.TTSRemote.setActive(true);
    let error;
    f.win.TTSRemote.speak('abandon', 1).catch((err) => { error = err; });
    f.fireTimers((ms) => ms === 20000);
    await tick();
    assert(error && error.message.includes('timed out'), 'Timeout did not settle');
    f.respond(f.requests[0]);
    await tick();
    assert(f.urls.length === 0 && f.audios.length === 0, 'Timed-out response was retained');
  });

  test('Remote configuration edits stop requests and require another Play', async () => {
    const f = await remotePlaying();
    f.change('remoteModel', 'other-model', 'input');
    f.requests.forEach((r) => f.respond(r));
    await tick();
    assert(f.audios.length === 0, 'Old configuration played');
    assert(f.el('playBtn').textContent.includes('Play'), 'Settings did not pause');
    f.click('playBtn');
    assert(JSON.parse(f.requests[f.requests.length - 1].options.body).model === 'other-model', 'New config not used');
  });

  test('Engine change cancels pending remote work without auto-playing new engine', async () => {
    const f = await remotePlaying();
    f.change('engineSelect', 'device');
    f.requests.forEach((r) => f.respond(r));
    await tick();
    assert(f.audios.length === 0 && f.spoken.length === 0, 'Engine switch auto-played');
    assert(f.el('playBtn').textContent.includes('Play'), 'Engine switch did not pause');
  });

  test('Test button sends bitcoin only, and Pause cancels it', async () => {
    const f = await fixture();
    f.change('engineSelect', 'remote');
    f.click('remoteTestBtn');
    assert(f.requests.length === 1 && f.requests[0].word === 'bitcoin', 'Test input not isolated');
    f.click('playBtn');
    f.respond(f.requests[0]);
    await tick();
    assert(f.audios.length === 0, 'Canceled test played');
    assert(!f.el('remoteFeedback').textContent.includes('Connected'), 'Stale test feedback');
  });

  test('API key is sent only as authorization, never written to preference storage', async () => {
    const f = await fixture();
    f.change('engineSelect', 'remote');
    f.change('remoteApiKey', 'dummy-regression-key', 'input');
    f.click('playBtn');
    assert(f.requests[0].options.headers.Authorization === 'Bearer dummy-regression-key', 'Key not used');
    assert(![...f.storage.values()].some((v) => v.includes('dummy-regression-key')), 'Key persisted');
  });

  test('Rapid jump/repeat discards old remote generations without skipping position', async () => {
    const f = await remotePlaying();
    f.click('nextBtn');
    f.click('repeatBtn');
    f.requests.forEach((r) => f.respond(r));
    await tick();
    assert(f.audios.length === 1, 'Stale generation played or current generation lost');
    assert(f.el('indexBadge').textContent === 'Word 2 of 2,048', 'Jump/repeat skipped position');
    f.audios[0].onended();
    await tick();
    f.fireTimers((ms) => ms !== 20000);
    await tick();
    assert(f.el('indexBadge').textContent === 'Word 3 of 2,048', 'Advancement not exactly once');
  });

  test('Device pause/resume ignores stale handlers and advances exactly once', async () => {
    const f = await fixture();
    f.click('playBtn');
    const staleEnd = f.spoken[0].onend;
    f.click('playBtn');
    f.click('playBtn');
    staleEnd();
    await tick();
    assert(f.el('stageCard').classList.contains('speaking'), 'Stale handler cleared current state');
    f.finishWord();
    await tick();
    f.fireTimers();
    await tick();
    assert(f.spoken.map((u) => u.text).join(',') === 'abandon,abandon,ability', 'Pause/resume skipped or double-advanced');
  });

  test('Saved last-word resume reports end, not full coverage', async () => {
    const f = await fixture({ saved: { wordReader_index: '2047' } });
    f.click('playBtn');
    f.finishWord();
    await tick();
    assert(f.spoken.length === 1 && f.spoken[0].text === 'zoo', 'Last-word restore wrong');
    assert(f.el('statusText').textContent === 'Reached the end of the list.', 'Completion overclaim');
    assert(f.el('progressPercent').textContent === 'List position: 100.0%', 'Position not labelled');
  });

  test('Duplicate end callbacks cannot clear the next word speaking state', async () => {
    const f = await fixture();
    f.click('playBtn');
    const ended = f.spoken[0].onend;
    ended();
    await tick();
    f.fireTimers();
    await tick();
    assert(f.spoken.length === 2, 'Second word did not start');
    ended();
    await tick();
    assert(f.el('stageCard').classList.contains('speaking'), 'Duplicate callback cleared current speaking state');
    assert(f.el('indexBadge').textContent === 'Word 2 of 2,048', 'Duplicate callback advanced');
  });

  test('Silent mode cancels timers and never requests speech or network', async () => {
    const f = await fixture({ saved: { wordReader_engine: 'silent' } });
    f.click('playBtn');
    f.click('playBtn');
    f.fireTimers();
    await tick();
    assert(f.spoken.length === 0 && f.requests.length === 0, 'Silent mode used speech/network');
    assert(f.el('indexBadge').textContent === 'Word 1 of 2,048', 'Canceled silent timer advanced');
  });

  test('Local voice changes pause and suppress stale device callbacks', async () => {
    const f = await fixture();
    f.click('playBtn');
    const ended = f.spoken[0].onend;
    f.change('voiceSelect', localVoice.name);
    ended();
    await tick();
    assert(f.el('playBtn').textContent.includes('Play'), 'Voice change did not pause');
    assert(f.el('indexBadge').textContent === 'Word 1 of 2,048', 'Stale voice callback advanced');
  });

  test('Page hide stops remote work and back-forward restore requires new consent', async () => {
    const f = await remotePlaying();
    f.win.dispatchEvent(new f.win.Event('pagehide'));
    f.requests.forEach((r) => f.respond(r));
    await tick();
    const restored = new f.win.Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    f.win.dispatchEvent(restored);
    assert(f.audios.length === 0, 'Hidden page played delayed audio');
    assert(f.el('engineSelect').value === 'device', 'Back-forward restore retained remote consent');
  });

  test('Keyboard activation of integrity details does not start playback', async () => {
    const f = await fixture();
    const before = f.el('verifyDetails').classList.contains('hidden');
    f.el('verifyBadge').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    assert(f.el('verifyDetails').classList.contains('hidden') !== before, 'Details did not toggle');
    assert(f.spoken.length === 0, 'Badge activation started playback');
  });

  test('Optional remote script can be absent', async () => {
    const f = await fixture({ noRemote: true });
    assert(f.el('engineSelect').querySelector('option[value="remote"]').disabled, 'Unavailable mode offered');
    f.click('playBtn');
    assert(f.spoken.length === 1, 'Device path broken without remote script');
  });

  test('SHA-256 vectors and binary padding boundaries agree with WebCrypto', async () => {
    assert(window.SHA256.selfTest(), 'Published/regression self-tests failed');
    for (let length = 0; length <= 2048; length++) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 37 + length) & 255;
      const digest = await window.SHA256.hashBytes(bytes);
      assert(digest.hex.length === 64, 'Digest not 64 hex digits at length ' + length);
    }
  });

  async function run() {
    let failures = 0;
    for (const item of tests) {
      const row = document.createElement('li');
      try {
        await item.run();
        if (current) assert(!current.errors.length, current.errors.join('; '));
        row.textContent = 'PASS: ' + item.name;
      } catch (err) {
        failures += 1;
        row.textContent = 'FAIL: ' + item.name + ': ' + err.message;
        console.error(item.name, err);
      } finally {
        if (current) {
          current.win.dispatchEvent(new Event('pagehide'));
          await tick();
          current.frame.remove();
          current = null;
        }
      }
      document.getElementById('testResults').appendChild(row);
    }
    const summary = document.getElementById('testSummary');
    summary.textContent = (tests.length - failures) + '/' + tests.length + ' passed; ' + failures + ' failed.';
    document.documentElement.dataset.testResult = failures ? 'fail' : 'pass';
    document.title = failures ? 'FAIL: browser regressions' : 'PASS: browser regressions';
  }

  run().catch((err) => {
    document.getElementById('testSummary').textContent = 'Harness failed: ' + err.message;
    document.documentElement.dataset.testResult = 'fail';
  });
})();