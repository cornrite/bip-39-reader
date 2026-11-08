/* app.js - BIP-39 Word Reader.
 *
 * Purpose: read the BIP-39 English word list aloud, in order, so a human can
 * check physical copies (Entropia, printout, etc.) word by word without looking away.
 *
 * Playback guarantees this file is responsible for:
 *   - one loop owns advancement, in list order, for every voice engine
 *   - canceled work cannot advance; resume replays the interrupted word
 *   - manual navigation selects a position; position is not coverage
 *
 * Verification split:
 *   - sha256.js hashes the list in the browser (two implementations compared)
 *   - verify_bip39.py checks the same list outside the browser
 *   - VERIFY.md walks a human through checking without trusting either
 */
(function () {
  'use strict';

  const CANONICAL_BIP39_SHA256 = '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda';
  const EXPECTED_WORD_COUNT = 2048;
  const SILENT_WORD_MS = 800;
  const STORAGE = {
    index: 'wordReader_index',
    delay: 'wordReader_delay',
    rate: 'wordReader_rate',
    engine: 'wordReader_engine',
    voice: 'wordReader_voice'
  };

  // ---------- elements ----------
  const el = (id) => document.getElementById(id);

  const workflowWarningEl = el('workflowWarning');
  const closeWorkflowWarningBtn = el('closeWorkflowWarningBtn');
  const stageCardEl = el('stageCard');
  const wordPrefixEl = el('wordPrefix');
  const wordSuffixEl = el('wordSuffix');
  const indexBadgeEl = el('indexBadge');
  const statusTextEl = el('statusText');
  const progressBarFill = el('progressBarFill');
  const progressBarContainer = el('progressBarContainer');
  const progressPercentEl = el('progressPercent');
  const progressWordsEl = el('progressWords');

  const verifyBadgeEl = el('verifyBadge');
  const verifyIconEl = el('verifyIcon');
  const verifyTextEl = el('verifyText');
  const verifyDetailsEl = el('verifyDetails');
  const currentHashEl = el('currentHash');
  const hashEnginesEl = el('hashEngines');

  const playBtn = el('playBtn');
  const prevBtn = el('prevBtn');
  const nextBtn = el('nextBtn');
  const repeatBtn = el('repeatBtn');
  const resetBtn = el('resetBtn');

  const delaySlider = el('delaySlider');
  const delayVal = el('delayVal');
  const rateSlider = el('rateSlider');
  const rateVal = el('rateVal');
  const engineSelect = el('engineSelect');
  const deviceVoiceGroupEl = el('deviceVoiceGroup');
  const voiceSelect = el('voiceSelect');
  const voiceNoteEl = el('voiceNote');
  const remotePanelEl = el('remotePanel');

  const jumpIndexInput = el('jumpIndex');
  const jumpBtn = el('jumpBtn');
  const searchWordInput = el('searchWord');
  const searchBtn = el('searchBtn');
  const compareBtn = el('compareBtn');
  const compareInput = el('compareInput');
  const compareResultEl = el('compareResult');

  const wordsContainer = el('wordsContainer');
  const scrollCurrentBtn = el('scrollCurrentBtn');

  // ---------- state ----------
  let words = [];
  let currentIndex = 0;
  let isPlaying = false;
  let delayBetweenWords = 1.2;
  let speechRate = 1.0;
  let engine = 'device'; // 'device' | 'silent' | 'remote'
  let selectedVoice = null;
  let savedVoiceName = '';
  let availableVoices = [];

  // The reader owns the page scroll: playback only ever moves the word list box,
  // and stops moving it as soon as the reader scrolls the box by hand.
  let followCurrent = true;

  let sessionId = 0;          // bumped to abandon in-flight speech and waits
  let waitTimer = null;
  let waitResolve = null;
  let activeUtterance = null; // keeps the utterance referenced so engines do not drop it mid-speech
  let cancelDevice = null;
  let integrityPromise = null;
  let hashValid = false;
  let activeListCanonical = false;
  let comparisonId = 0;

  // ---------- small helpers ----------
  const formatInt = (value) => value.toLocaleString('en-US');

  const groupHex = (hex) => (hex || '').replace(/(.{4})(?=.)/g, '$1 ');

  function setStatus(text) {
    statusTextEl.textContent = text;
  }

  function setPlaying(playing) {
    isPlaying = playing;
    playBtn.innerHTML = playing ? '&#10074;&#10074; Pause' : '&#9654; Play';
  }

  function safeGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (err) {
      /* storage blocked (private mode, file:// restrictions): not important */
    }
  }

  function readNumber(key) {
    const raw = safeGet(key);
    if (raw === null) return null;
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : null;
  }


  // ---------- word list ----------
  function loadEmbeddedWords() {
    let source = null;
    try {
      if (typeof EMBEDDED_WORDS !== 'undefined') source = EMBEDDED_WORDS;
    } catch (err) {
      source = null;
    }
    if (!Array.isArray(source) && Array.isArray(window.EMBEDDED_WORDS)) source = window.EMBEDDED_WORDS;
    if (!Array.isArray(source)) return [];
    return source
      .filter((word) => typeof word === 'string' && word.trim())
      .map((word) => word.trim());
  }

  // ---------- verification badge ----------
  async function verifyWordListIntegrity() {
    hashValid = false;
    activeListCanonical = false;
    currentHashEl.textContent = 'calculating...';

    if (!window.SHA256) {
      verifyBadgeEl.classList.add('mismatch');
      verifyIconEl.innerHTML = '&#9888;';
      verifyTextEl.textContent = 'sha256.js is missing: the list cannot be checked';
      hashEnginesEl.textContent = 'no hash implementation available';
      currentHashEl.textContent = 'not computed';
      return;
    }

    try {
      if (!window.SHA256.selfTest()) throw new Error('self-test failed');
    } catch (err) {
      verifyBadgeEl.classList.add('mismatch');
      verifyIconEl.innerHTML = '&#9888;';
      verifyTextEl.textContent = 'Internal hash self-test FAILED: cannot verify the list';
      hashEnginesEl.textContent = 'self-test against published test vectors failed';
      currentHashEl.textContent = 'not trusted';
      return;
    }

    try {
      const result = await window.SHA256.hashText(words.join('\n') + '\n');
      hashValid = true;
      currentHashEl.textContent = groupHex(result.hex);
      hashEnginesEl.textContent = result.engines === 'webcrypto+pure-js'
        ? '2 independent SHA-256 implementations agree'
        : '1 implementation (pure JS: WebCrypto unavailable in this context)';

      const isCanonical = result.hex === CANONICAL_BIP39_SHA256 && words.length === EXPECTED_WORD_COUNT;
      activeListCanonical = isCanonical;
      verifyBadgeEl.classList.remove('pending');
      if (isCanonical) {
        verifyBadgeEl.classList.remove('mismatch');
        verifyIconEl.innerHTML = '&#10003;';
        verifyTextEl.textContent = 'Word list matches the canonical BIP-39 hash';
      } else {
        verifyBadgeEl.classList.add('mismatch');
        verifyIconEl.innerHTML = '&#9888;';
        verifyTextEl.textContent = 'WARNING: this list is NOT the canonical BIP-39 list (' + formatInt(words.length) + ' words)';
      }
    } catch (err) {
      verifyBadgeEl.classList.add('mismatch');
      verifyIconEl.innerHTML = '&#9888;';
      verifyTextEl.textContent = 'Hash check failed: ' + err.message;
      currentHashEl.textContent = 'not trusted';
    }
  }

  verifyBadgeEl.addEventListener('click', () => {
    verifyDetailsEl.classList.toggle('hidden');
  });
  verifyBadgeEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    verifyDetailsEl.classList.toggle('hidden');
  });

  // ---------- compare with a file the user downloaded ----------
  function splitWordFile(text) {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function formattingNotes(bytes, text) {
    const notes = [];
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      notes.push('It starts with a UTF-8 byte order mark (added by some editors, e.g. Notepad).');
    }
    if (text.indexOf('\r\n') !== -1) notes.push('It uses Windows (CRLF) line endings.');
    else if (/\r(?!\n)/.test(text)) notes.push('It uses old Mac (CR) line endings.');
    if (text.charAt(text.length - 1) !== '\n') notes.push('It has no newline after the last word.');
    if (/^\s/.test(text) || /\n[ \t]+\n/.test(text) || /\n\n/.test(text.replace(/\n+$/, ''))) {
      notes.push('It has leading spaces or extra blank lines.');
    }
    return notes;
  }

  function firstDifference(expected, actual) {
    const max = Math.max(expected.length, actual.length);
    for (let i = 0; i < max; i++) {
      if (expected[i] !== actual[i]) {
        return { index: i, expected: expected[i], actual: actual[i] };
      }
    }
    return null;
  }

  function showCompare(kind, headline, details) {
    compareResultEl.textContent = '';
    compareResultEl.className = 'compare-result ' + kind;

    const heading = document.createElement('div');
    heading.className = 'compare-headline';
    heading.textContent = headline;
    compareResultEl.appendChild(heading);

    details.forEach((line) => {
      const row = document.createElement('div');
      row.className = 'compare-detail';
      row.textContent = line;
      compareResultEl.appendChild(row);
    });
  }

  function invalidateHash(error) {
    hashValid = false;
    verifyBadgeEl.classList.add('mismatch');
    verifyIconEl.innerHTML = '&#9888;';
    verifyTextEl.textContent = 'Hash check failed: ' + error.message;
    currentHashEl.textContent = 'not trusted';
    showCompare('error', 'Not verified: a hash check failed. Reload and resolve the failure before use.', [error.message]);
  }

  async function compareWithDownloadedFile(file) {
    const comparison = ++comparisonId;
    const show = (kind, headline, details) => {
      if (comparison === comparisonId) showCompare(kind, headline, details);
    };
    show('info', 'Reading ' + file.name + '...', []);

    await integrityPromise;
    if (comparison !== comparisonId) return;
    if (!hashValid) {
      show('error', 'Cannot verify this download: the hash subsystem has not passed its checks.', []);
      return;
    }

    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (err) {
      show('error', 'Could not read ' + file.name + '.', [err.message]);
      return;
    }

    if (comparison !== comparisonId) return;
    let hashInfo;
    try {
      hashInfo = await window.SHA256.hashBytes(bytes);
    } catch (err) {
      invalidateHash(err);
      show('error', 'Hash check failed: ' + err.message, []);
      return;
    }

    if (comparison !== comparisonId) return;

    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (err) {
      show('error', file.name + ' is not valid UTF-8 text, so it cannot be an english.txt word list.', []);
      return;
    }

    const fileWords = splitWordFile(text.replace(/^\uFEFF/, ''));
    const fileLine = 'File: ' + file.name + ' (' + formatInt(fileWords.length) + ' words, SHA-256 ' + groupHex(hashInfo.hex) + ')';
    let normalized;
    try {
      normalized = await window.SHA256.hashText(fileWords.join('\n') + '\n');
    } catch (err) {
      invalidateHash(err);
      show('error', 'Normalized-content hash check failed: ' + err.message, []);
      return;
    }
    if (comparison !== comparisonId) return;

    const canonicalContent = normalized.hex === CANONICAL_BIP39_SHA256 && fileWords.length === EXPECTED_WORD_COUNT;
    const canonicalBytes = hashInfo.hex === CANONICAL_BIP39_SHA256;
    const diff = firstDifference(words, fileWords);
    const checks = [
      fileLine,
      'Hash subsystem: ' + (hashValid ? 'passed' : 'FAILED') + '.',
      'Active list canonical content: ' + (activeListCanonical ? 'passed' : 'FAILED') + '.',
      'Uploaded raw canonical bytes: ' + (canonicalBytes ? 'passed' : 'FAILED') + '.',
      'Uploaded normalized canonical content: ' + (canonicalContent ? 'passed' : 'FAILED') + '.',
      'Equality with the active list, in order: ' + (!diff ? 'passed' : 'FAILED') + '.'
    ];

    if (!fileWords.length) {
      show('error', 'That file contains no words.', checks);
      return;
    }

    if (diff) {
      const details = checks.slice();
      if (diff.expected === undefined) {
        details.push('Your file has an extra word at position ' + formatInt(diff.index + 1) + ': "' + diff.actual + '".');
      } else if (diff.actual === undefined) {
        details.push('Your file stops after ' + formatInt(fileWords.length) + " words; the app reads \"" + diff.expected + '" at position ' + formatInt(diff.index + 1) + '.');
      } else {
        details.push('First difference at word ' + formatInt(diff.index + 1) + ': the app reads "' + diff.expected + '", your file says "' + diff.actual + '".');
      }
      details.push('Do not use the reader until the failed checks are resolved. See VERIFY.md.');
      show('error', 'MISMATCH: the file does not match the list being read aloud', details);
      return;
    }

    if (!hashValid || !activeListCanonical || !canonicalContent) {
      show('error', 'Not verified: matching lists alone do not establish canonical content.', checks);
      return;
    }
    const notes = formattingNotes(bytes, text);
    if (canonicalBytes) {
      show('ok', 'MATCH: verified against your download. All required checks passed.', checks);
      return;
    }

    const detailLines = checks.concat(['Canonical content matches, but this file is not byte-exact:']);
    notes.forEach((note) => detailLines.push('- ' + note));
    if (!notes.length) detailLines.push('- It differs in some other way (extra spaces, altered bytes).');
    detailLines.push('For a byte-identical file, download the raw file again rather than copying and pasting.');
    show('warn', 'Canonical words, different file formatting. Raw-byte verification did not pass.', detailLines);
  }

  compareBtn.addEventListener('click', () => compareInput.click());

  compareInput.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    compareInput.value = ''; // allow picking the same file twice
    if (!file) return;
    await compareWithDownloadedFile(file);
  });


  // ---------- voices ----------
  const isLocalVoice = (voice) => voice.localService === true;

  function updateVoiceNote() {
    if (!voiceNoteEl) return;
    if (!('speechSynthesis' in window)) {
      voiceNoteEl.textContent = 'This browser has no built-in speech. Use "No voice" or a remote TTS server.';
      return;
    }
    if (!selectedVoice) {
      voiceNoteEl.textContent = 'No identified local voice is available. Install a local system voice or choose "No voice". Browser-default and network voices are not used.';
    } else {
      voiceNoteEl.textContent = 'The browser identifies this voice as local. For an offline check, disconnect the network and test playback; this label is not an audit of the browser or OS.';
    }
  }

  function populateVoices() {
    if (!('speechSynthesis' in window)) {
      updateVoiceNote();
      return;
    }
    availableVoices = (window.speechSynthesis.getVoices() || []).filter(isLocalVoice);

    const sorted = [...availableVoices].sort((a, b) => {
      const aEnglish = (a.lang || '').toLowerCase().startsWith('en') ? 0 : 1;
      const bEnglish = (b.lang || '').toLowerCase().startsWith('en') ? 0 : 1;
      if (aEnglish !== bEnglish) return aEnglish - bEnglish;
      return (a.name || '').localeCompare(b.name || '');
    });

    const previous = voiceSelect.value || savedVoiceName;
    voiceSelect.textContent = '';

    sorted.forEach((voice) => {
      const option = document.createElement('option');
      option.value = voice.name;
      option.textContent = voice.name + ' (' + voice.lang + ')' +
        (voice.default ? ' [default]' : '');
      voiceSelect.appendChild(option);
    });

    let index = 0;
    if (previous) {
      const found = sorted.findIndex((voice) => voice.name === previous);
      if (found >= 0) index = found;
    }
    voiceSelect.selectedIndex = index;
    selectedVoice = sorted[index];
    voiceSelect.disabled = !selectedVoice;
    if (!selectedVoice) {
      const option = document.createElement('option');
      option.textContent = 'No identified local voices';
      voiceSelect.appendChild(option);
    }
    updateVoiceNote();
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = populateVoices;
    populateVoices();
  } else {
    updateVoiceNote();
  }

  voiceSelect.addEventListener('change', () => {
    setPlaying(false);
    cancelSpeech();
    selectedVoice = availableVoices.find((voice) => voice.name === voiceSelect.value && isLocalVoice(voice)) || null;
    savedVoiceName = voiceSelect.value;
    safeSet(STORAGE.voice, savedVoiceName);
    updateVoiceNote();
    setStatus('Local voice changed. Press Play to use it.');
  });

  // ---------- display ----------
  function updateDisplay() {
    if (!words.length) return;
    const word = words[currentIndex] || '';

    // The tablets show the first 4 letters, so those are highlighted.
    if (word.length <= 4) {
      wordPrefixEl.textContent = word;
      wordSuffixEl.textContent = '';
    } else {
      wordPrefixEl.textContent = word.slice(0, 4);
      wordSuffixEl.textContent = word.slice(4);
    }

    indexBadgeEl.textContent = 'Word ' + formatInt(currentIndex + 1) + ' of ' + formatInt(words.length);

    const percent = ((currentIndex + 1) / words.length) * 100;
    progressBarFill.style.width = percent.toFixed(2) + '%';
    progressPercentEl.textContent = 'List position: ' + percent.toFixed(1) + '%';
    progressWordsEl.textContent = 'Word ' + formatInt(currentIndex + 1) + ' / ' + formatInt(words.length);

    jumpIndexInput.max = String(words.length);

    const previousChip = wordsContainer.querySelector('.word-chip.current');
    if (previousChip) previousChip.classList.remove('current');
    const currentChip = document.getElementById('chip-' + currentIndex);
    if (currentChip) currentChip.classList.add('current');

    safeSet(STORAGE.index, currentIndex);

  }

  function renderWordList() {
    wordsContainer.textContent = '';
    const fragment = document.createDocumentFragment();

    words.forEach((word, index) => {
      const chip = document.createElement('div');
      chip.className = 'word-chip' + (index === currentIndex ? ' current' : '');
      chip.id = 'chip-' + index;
      chip.dataset.index = String(index);

      const wordSpan = document.createElement('span');
      wordSpan.textContent = word;

      const numberSpan = document.createElement('span');
      numberSpan.className = 'chip-num';
      numberSpan.textContent = '#' + (index + 1);

      chip.appendChild(wordSpan);
      chip.appendChild(numberSpan);
      fragment.appendChild(chip);
    });

    wordsContainer.appendChild(fragment);
  }

  // Following is switched off when the reader scrolls the box by hand and back on
  // when they move to a word themselves, so the box never fights the reader.
  function setFollow(on) {
    if (followCurrent === on) return;
    followCurrent = on;
    if (scrollCurrentBtn) scrollCurrentBtn.textContent = on ? 'Scroll to Current' : 'Follow current word';
  }

  function scrollToCurrentChip(smooth) {
    if (!followCurrent) return;
    const chip = document.getElementById('chip-' + currentIndex);
    if (!chip || !wordsContainer.scrollTo) return;

    // Compare the chip with the box rather than calling scrollIntoView, which walks
    // every scrollable ancestor and would drag the page away from where the reader put it.
    const boxRect = wordsContainer.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    const margin = 8;
    let top = null;

    if (chipRect.top < boxRect.top + margin) {
      top = wordsContainer.scrollTop + (chipRect.top - boxRect.top) - margin;
    } else if (chipRect.bottom > boxRect.bottom - margin) {
      top = wordsContainer.scrollTop + (chipRect.bottom - boxRect.bottom) + margin;
    }
    if (top === null) return;

    wordsContainer.scrollTo({
      top: Math.max(0, top),
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  wordsContainer.addEventListener('click', (event) => {
    const chip = event.target.closest ? event.target.closest('.word-chip') : null;
    if (!chip || chip.dataset.index === undefined) return;
    jumpTo(parseInt(chip.dataset.index, 10));
  });

  // Hand movement inside the box means the reader is looking at one specific word,
  // so following stops until they ask for it again. The 'scroll' event is not used
  // here because the app's own scrollTo calls fire it as well.
  ['wheel', 'touchstart', 'touchmove'].forEach((type) => {
    wordsContainer.addEventListener(type, () => setFollow(false), { passive: true });
  });

  wordsContainer.addEventListener('mousedown', (event) => {
    if (event.target === wordsContainer) setFollow(false);   // scrollbar or padding, not a word
  });


  // ---------- playback primitives ----------
  // A cancellable wait. Resolves early when cancelWait() is called, so the
  // playback loop never advances on a stale timer.
  function wait(ms) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (waitTimer !== null) {
          clearTimeout(waitTimer);
          waitTimer = null;
        }
        waitResolve = null;
        resolve();
      };
      waitResolve = finish;
      waitTimer = setTimeout(finish, ms);
    });
  }

  function cancelWait() {
    if (waitResolve) waitResolve();
  }

  function cancelSpeech() {
    sessionId += 1; // invalidates any running loop and in-flight speech
    cancelWait();
    if (cancelDevice) cancelDevice();
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (err) {
        /* ignore */
      }
    }
    activeUtterance = null;
    if (window.TTSRemote) window.TTSRemote.stop();
    stageCardEl.classList.remove('speaking');
  }

  function speakDevice(word) {
    if (!selectedVoice || !isLocalVoice(selectedVoice)) {
      return Promise.reject(new Error('no identified local voice: install one or choose "No voice"'));
    }
    const session = sessionId;
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.voice = selectedVoice;
      utterance.rate = speechRate;
      activeUtterance = utterance; // keep a reference: some engines drop unreferenced utterances mid-speech

      let settled = false;
      const settle = (done, value) => {
        if (settled) return;
        settled = true;
        utterance.onstart = null;
        utterance.onend = null;
        utterance.onerror = null;
        if (cancelDevice === cancel) cancelDevice = null;
        if (activeUtterance === utterance) activeUtterance = null;
        done(value);
      };

      const cancel = () => settle(resolve);
      cancelDevice = cancel;
      utterance.onstart = () => {
        if (!settled && sessionId === session) stageCardEl.classList.add('speaking');
      };
      utterance.onend = () => {
        if (settled) return;
        if (sessionId === session) stageCardEl.classList.remove('speaking');
        settle(resolve);
      };
      utterance.onerror = (event) => {
        if (settled) return;
        if (sessionId === session) stageCardEl.classList.remove('speaking');
        const reason = (event && event.error) || 'unknown';
        if (reason === 'interrupted' || reason === 'canceled') settle(resolve);
        else settle(reject, new Error('speech synthesis failed (' + reason + ')'));
      };

      try {
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        settle(reject, err);
      }
    });
  }

  async function speakSilent(word) {
    const session = sessionId;
    const duration = Math.max(400, (SILENT_WORD_MS / Math.max(0.5, speechRate)) * Math.max(1, word.length / 5));
    stageCardEl.classList.add('speaking');
    try {
      await wait(duration);
    } finally {
      if (sessionId === session) stageCardEl.classList.remove('speaking');
    }
  }

  function speakWord(word) {
    if (engine === 'silent') return speakSilent(word);

    if (engine === 'remote') {
      if (!window.TTSRemote) return Promise.reject(new Error('tts-remote.js is not loaded'));
      const session = sessionId;
      stageCardEl.classList.add('speaking');
      return window.TTSRemote.speak(word, speechRate).finally(() => {
        if (sessionId === session) stageCardEl.classList.remove('speaking');
      });
    }

    if (!('speechSynthesis' in window)) {
      return Promise.reject(new Error('this browser has no built-in speech: choose "No voice" or a remote server'));
    }
    return speakDevice(word);
  }

  // ---------- playback loop ----------
  // One loop for every engine. Each word is awaited exactly once, and the loop
  // stops as soon as sessionId changes, so pausing or jumping cannot double-read
  // or skip a word.
  async function playLoop(session) {
    while (sessionId === session && isPlaying) {
      const word = words[currentIndex];
      if (!word) break;

      setStatus('Speaking: "' + word + '"');
      if (engine === 'remote' && window.TTSRemote) window.TTSRemote.prefetch(words[currentIndex + 1]);
      try {
        await speakWord(word);
      } catch (err) {
        if (sessionId !== session) return;
        setPlaying(false);
        cancelSpeech();
        setStatus('Voice error: ' + err.message + '. Playback stopped.');
        return;
      }

      if (sessionId !== session || !isPlaying) return;

      if (currentIndex >= words.length - 1) {
        setPlaying(false);
        setStatus('Reached the end of the list.');
        return;
      }

      if (delayBetweenWords > 0) {
        setStatus('Next word in ' + delayBetweenWords.toFixed(1) + 's...');
        await wait(delayBetweenWords * 1000);
        if (sessionId !== session || !isPlaying) return;
      }

      currentIndex += 1;
      updateDisplay();
      scrollToCurrentChip(false);
    }
  }

  function startPlayback() {
    if (!words.length) return;
    cancelSpeech();              // bumps sessionId, so any previous loop exits
    const session = sessionId;
    setFollow(true);             // pressing Play means the highlight is what you want to see
    scrollToCurrentChip(false);
    setPlaying(true);
    playLoop(session);
  }

  function togglePlay() {
    if (isPlaying) {
      setPlaying(false);
      cancelSpeech();
      setStatus('Paused at word ' + formatInt(currentIndex + 1) + '.');
    } else {
      startPlayback();
    }
  }

  function jumpTo(index, announce) {
    if (!words.length) return;
    const clamped = Math.min(Math.max(0, index), words.length - 1);
    currentIndex = clamped;
    updateDisplay();
    setFollow(true);             // moving to a word by hand resumes following
    scrollToCurrentChip(true);

    if (isPlaying) {
      startPlayback();           // restart from the new position, same word read once
    } else {
      cancelSpeech();
      if (announce !== false) setStatus('Moved to word #' + formatInt(currentIndex + 1) + '.');
    }
  }

  function nextWord() {
    if (currentIndex < words.length - 1) jumpTo(currentIndex + 1);
  }

  function prevWord() {
    if (currentIndex > 0) jumpTo(currentIndex - 1);
  }

  function repeatWord() {
    const word = words[currentIndex];
    if (!word) return;

    if (isPlaying) {
      startPlayback();
      return;
    }

    cancelSpeech();
    const session = sessionId;
    setStatus('Speaking: "' + word + '"');
    speakWord(word).catch((err) => {
      if (sessionId === session) setStatus('Voice error: ' + err.message);
    });
  }

  function resetToStart() {
    jumpTo(0);
  }


  // ---------- settings ----------
  function loadSavedSettings() {
    const savedIndex = readNumber(STORAGE.index);
    if (savedIndex !== null && Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < words.length) {
      currentIndex = savedIndex;
    }

    const savedDelay = readNumber(STORAGE.delay);
    if (savedDelay !== null && savedDelay >= 0 && savedDelay <= 5) delayBetweenWords = savedDelay;
    delaySlider.value = String(delayBetweenWords);
    delayVal.textContent = delayBetweenWords.toFixed(1) + 's';

    const savedRate = readNumber(STORAGE.rate);
    if (savedRate !== null && savedRate >= 0.5 && savedRate <= 4) speechRate = savedRate;
    rateSlider.value = String(speechRate);
    rateVal.textContent = speechRate.toFixed(1) + 'x';

    const savedEngine = safeGet(STORAGE.engine);
    // Restoring preferences must never restore permission to contact a server.
    if (savedEngine === 'device' || savedEngine === 'silent') engine = savedEngine;
    savedVoiceName = safeGet(STORAGE.voice) || '';

    if (engine === 'remote' && !window.TTSRemote) engine = 'device';
    if (engine === 'device' && !('speechSynthesis' in window)) engine = 'silent';

    engineSelect.value = engine;
    populateVoices();
    applyEngineUI();
  }

  function applyEngineUI() {
    deviceVoiceGroupEl.classList.toggle('hidden', engine !== 'device');
    remotePanelEl.classList.toggle('hidden', engine !== 'remote');
    if (window.TTSRemote) window.TTSRemote.setActive(engine === 'remote');

    const remoteOption = engineSelect.querySelector('option[value="remote"]');
    if (remoteOption && !window.TTSRemote) {
      remoteOption.disabled = true;
      remoteOption.textContent = 'Remote TTS server (tts-remote.js not loaded)';
    }

    if (!isPlaying) {
      if (engine === 'silent') setStatus('No voice: words advance on a timer so you can still follow along.');
      else if (engine === 'device' && !('speechSynthesis' in window)) setStatus('This browser has no built-in speech: choose "No voice" or a remote server.');
      else setStatus('Ready: press Play to read the list aloud.');
    }
  }

  delaySlider.addEventListener('input', () => {
    const value = parseFloat(delaySlider.value);
    if (!Number.isFinite(value)) return;
    delayBetweenWords = Math.min(Math.max(value, 0), 5);
    delayVal.textContent = delayBetweenWords.toFixed(1) + 's';
    safeSet(STORAGE.delay, delayBetweenWords);
  });

  rateSlider.addEventListener('input', () => {
    const value = parseFloat(rateSlider.value);
    if (!Number.isFinite(value)) return;
    speechRate = Math.min(Math.max(value, 0.5), 4);
    rateVal.textContent = speechRate.toFixed(1) + 'x';
    safeSet(STORAGE.rate, speechRate);
  });

  engineSelect.addEventListener('change', () => {
    const chosen = engineSelect.value;
    if (chosen === 'remote' && !window.TTSRemote) {
      engineSelect.value = engine;
      setStatus('Remote TTS is unavailable: tts-remote.js is missing from this folder.');
      return;
    }
    if (chosen === 'device' && !('speechSynthesis' in window)) {
      engineSelect.value = engine;
      setStatus('This browser has no built-in speech.');
      return;
    }
    setPlaying(false);
    cancelSpeech();
    engine = chosen;
    safeSet(STORAGE.engine, engine);
    applyEngineUI();
  });

  document.addEventListener('remote-settings-change', () => {
    setPlaying(false);
    cancelSpeech();
    setStatus('Remote settings changed. Press Play, Repeat, or Test to use them.');
  });

  document.addEventListener('remote-test', () => {
    if (engine !== 'remote' || !window.TTSRemote) return;
    setPlaying(false);
    cancelSpeech();
    setStatus('Testing remote voice with “bitcoin”. Press Pause to cancel.');
    setPlaying(true);
    const session = sessionId;
    window.TTSRemote.testConnection().finally(() => {
      if (sessionId !== session) return;
      setPlaying(false);
      setStatus('Remote voice test finished. See connection feedback.');
    });
  });

  window.addEventListener('pagehide', () => {
    setPlaying(false);
    cancelSpeech();
    if (window.TTSRemote) window.TTSRemote.setActive(false);
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted && engine === 'remote') {
      engine = 'device';
      engineSelect.value = engine;
      applyEngineUI();
    }
  });

  // ---------- buttons ----------
  closeWorkflowWarningBtn.addEventListener('click', () => {
    workflowWarningEl.classList.add('hidden');
    verifyBadgeEl.focus({ preventScroll: true });
  });
  closeWorkflowWarningBtn.addEventListener('keydown', (event) => {
    // Let native button activation dismiss the warning without triggering playback shortcuts.
    if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter') event.stopPropagation();
  });
  playBtn.addEventListener('click', togglePlay);
  prevBtn.addEventListener('click', prevWord);
  nextBtn.addEventListener('click', nextWord);
  repeatBtn.addEventListener('click', repeatWord);
  resetBtn.addEventListener('click', resetToStart);
  scrollCurrentBtn.addEventListener('click', () => {
    setFollow(true);
    scrollToCurrentChip(true);
  });


  function doJump() {
    if (!words.length) return;
    const value = parseInt(jumpIndexInput.value, 10);
    if (!Number.isFinite(value)) {
      setStatus('Enter a word number between 1 and ' + formatInt(words.length) + '.');
      return;
    }
    if (value < 1 || value > words.length) {
      jumpIndexInput.value = '';
      setStatus('Word numbers run from 1 to ' + formatInt(words.length) + '.');
      return;
    }
    jumpIndexInput.value = '';
    jumpTo(value - 1);
  }

  function doSearch() {
    if (!words.length) return;
    const query = searchWordInput.value.trim().toLowerCase();
    if (!query) {
      setStatus('Type a word, or just the first 4 letters (that is what the tablets show).');
      return;
    }

    // Prefix matches win: for 415 of the 1,096 three-letter strings in the list, a
    // "contains" hit would land on a different (earlier) word than a "starts with" hit.
    let found = words.findIndex((word) => word.startsWith(query));
    let how = 'starting with "' + query + '"';
    if (found < 0) {
      found = words.findIndex((word) => word.indexOf(query) !== -1);
      how = 'containing "' + query + '"';
    }

    if (found < 0) {
      setStatus('No word ' + how + '.');
      return;
    }

    searchWordInput.value = '';
    jumpTo(found);
    setStatus('Found "' + words[currentIndex] + '" (word #' + formatInt(currentIndex + 1) + ') ' + how + '.');
  }

  jumpBtn.addEventListener('click', doJump);
  searchBtn.addEventListener('click', doSearch);

  jumpIndexInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      doJump();
    }
  });

  searchWordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      doSearch();
    }
  });

  progressBarContainer.addEventListener('click', (event) => {
    if (!words.length) return;
    const rect = progressBarContainer.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    jumpTo(Math.min(words.length - 1, Math.floor(ratio * words.length)));
  });

  // ---------- keyboard shortcuts ----------
  document.addEventListener('keydown', (event) => {
    // Never swallow browser or OS shortcuts (Ctrl+R, Cmd+F, Alt+Tab, ...).
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const target = event.target;
    const tagName = target && target.tagName ? target.tagName.toUpperCase() : '';
    const isTyping = tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' ||
      (target && target.isContentEditable === true);

    if (isTyping) {
      if (event.key === 'Escape' && target.blur) target.blur();
      return;
    }

    switch (event.key) {
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight':
        event.preventDefault();
        nextWord();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        prevWord();
        break;
      case 'r':
      case 'R':
        event.preventDefault();
        repeatWord();
        break;
      case 'Home':
        event.preventDefault();
        resetToStart();
        break;
      default:
        break;
    }
  });

  // ---------- start ----------
  function disableControls() {
    [playBtn, prevBtn, nextBtn, repeatBtn, resetBtn, jumpBtn, searchBtn, compareBtn].forEach((button) => {
      if (button) button.disabled = true;
    });
  }

  function init() {
    if (window.TTSRemote) window.TTSRemote.init();
    words = loadEmbeddedWords();
    renderWordList();

    if (!words.length) {
      disableControls();
      setStatus('words.js is missing or contains no words: nothing can be read aloud.');
      verifyBadgeEl.classList.add('mismatch');
      verifyIconEl.innerHTML = '&#9888;';
      verifyTextEl.textContent = 'No words loaded: words.js is missing or empty';
      return;
    }

    loadSavedSettings();
    updateDisplay();
    scrollToCurrentChip(false);   // opens the box at the saved word; the page itself does not move
    integrityPromise = verifyWordListIntegrity();
  }

  init();
})();

