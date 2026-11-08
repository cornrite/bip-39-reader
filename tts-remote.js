/* tts-remote.js - optional remote TTS voice engine (OpenAI-compatible API).
 *
 * Delete this file and its <script> tag and the rest of the app still works:
 * app.js only calls window.TTSRemote when it exists.
 *
 * Meant for people who want a specific trusted voice: a local Kokoro/Piper/LocalAI
 * server, their own machine, or the OpenAI API. Only use the public inventory;
 * never use word selection or playback to communicate a seed phrase. Note that:
 *   - the audio comes from whatever server the endpoint points at, and
 *   - an API key lives in memory only (never in localStorage/sessionStorage/cookies).
 *
 * The page is opened from file://, so its origin is "null". A local TTS server
 * needs compatible CORS handling. A null origin is not proof of a trusted app.
 */
(function (global) {
  'use strict';

  var CACHE_LIMIT = 64;
  var REQUEST_TIMEOUT_MS = 20000;
  var STORAGE = {
    endpoint: 'wordReader_remoteEndpoint',
    model: 'wordReader_remoteModel',
    voice: 'wordReader_remoteVoice'
  };

  var cache = new Map();   // cache key -> object URL (insertion ordered for eviction)
  var pending = new Map(); // cache key -> cancellable request
  var activeAudio = null;
  var active = false;
  var apiKey = '';         // memory only, by design
  var generation = 0;      // invalidates requests even when a server ignores abort
  var initialized = false;

  var ui = {};

  function el(id) {
    return document.getElementById(id);
  }

  function endpoint() {
    var value = (ui.endpoint.value || '').trim().replace(/\/+$/, '');
    return value || 'https://api.openai.com/v1';
  }

  function model() {
    return (ui.model.value || '').trim() || 'tts-1';
  }

  function voice() {
    return (ui.voice.value || '').trim() || 'alloy';
  }

  function isLoopbackEndpoint() {
    try {
      var url = new URL(endpoint());
      var host = url.hostname;
      return url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1');
    } catch (err) {
      return false;
    }
  }

  function setFeedback(text, kind) {
    if (!ui.feedback) return;
    ui.feedback.textContent = text || '';
    ui.feedback.className = 'test-feedback' + (kind ? ' ' + kind : '');
  }

  function updateWarning() {
    if (!ui.warning) return;
    if (isLoopbackEndpoint()) {
      ui.warning.textContent = 'Loopback endpoint: played and prefetched words go to ' + endpoint() + '. Test sends “bitcoin”. That server may forward them elsewhere. Pause cannot retract transmitted data.';
      ui.warning.className = 'remote-warning network';
    } else {
      ui.warning.textContent = 'Network endpoint: played words and upcoming prefetched words are sent to ' + endpoint() + '. Test sends “bitcoin”. Pause cannot retract transmitted data.';
      ui.warning.className = 'remote-warning network';
    }
  }

  function saveSetting(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      /* storage may be unavailable (private mode); not important */
    }
  }

  function loadSettings() {
    try {
      var savedEndpoint = localStorage.getItem(STORAGE.endpoint);
      if (savedEndpoint) ui.endpoint.value = savedEndpoint;
      var savedModel = localStorage.getItem(STORAGE.model);
      if (savedModel) ui.model.value = savedModel;
      var savedVoice = localStorage.getItem(STORAGE.voice);
      if (savedVoice) ui.voice.value = savedVoice;
    } catch (err) {
      /* ignore */
    }
  }

  function cacheKey(word) {
    return [endpoint(), model(), voice(), word].join('|');
  }

  function cacheStore(key, url) {
    cache.set(key, url);
    while (cache.size > CACHE_LIMIT) {
      var oldest = cache.keys().next().value;
      var oldUrl = cache.get(oldest);
      cache.delete(oldest);
      try {
        URL.revokeObjectURL(oldUrl);
      } catch (err) {
        /* ignore */
      }
    }
  }

  function fetchAudio(word) {
    if (!initialized || !active) return Promise.reject(new Error('remote speech is not active'));
    var token = generation;
    var key = cacheKey(word);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (pending.has(key)) return pending.get(key).promise;

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var entry = { controller: controller, cancel: null, promise: null, canceled: false };
    var canceled = new Promise(function (resolve, reject) {
      entry.cancel = function (error) {
        entry.canceled = true;
        reject(error);
        if (controller) controller.abort();
      };
    });
    var timer = setTimeout(function () {
      entry.cancel(new Error('request timed out after ' + (REQUEST_TIMEOUT_MS / 1000) + 's'));
    }, REQUEST_TIMEOUT_MS);
    var request = (async function () {
      var headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
      var response = await fetch(endpoint() + '/audio/speech', {
        method: 'POST',
        headers: headers,
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({
          model: model(),
          input: word,
          voice: voice(),
          speed: 1.0 // pacing stays under the app's control
        })
      });
      checkRequest();
      if (!response.ok) {
        var detail = '';
        try {
          detail = (await response.text()).slice(0, 120);
        } catch (err) {
          detail = '';
        }
        checkRequest();
        throw new Error('HTTP ' + response.status + (detail ? ': ' + detail : ''));
      }
      var blob = await response.blob();
      checkRequest();
      if (!blob.size) throw new Error('server returned an empty audio file');
      var url = URL.createObjectURL(blob);
      cacheStore(key, url);
      return url;
    })();

    function checkRequest() {
      requireCurrent(token);
      if (entry.canceled) throw cancellationError();
    }

    entry.promise = Promise.race([request, canceled]).finally(function () {
      clearTimeout(timer);
      if (pending.get(key) === entry) pending.delete(key);
    });
    pending.set(key, entry);
    return entry.promise;
  }

  function cancellationError() {
    var error = new Error('remote playback canceled');
    error.name = 'AbortError';
    return error;
  }

  function requireCurrent(token) {
    if (!active || generation !== token) throw cancellationError();
  }

  // Cancellation of a pending request rejects; stopping active audio resolves.
  // Both paths settle immediately so the app can abandon the old session.
  function speak(word, rate) {
    var token = generation;
    return fetchAudio(word).then(function (url) {
      requireCurrent(token);
      return new Promise(function (resolve, reject) {
        var audio = new Audio(url);
        var settled = false;
        var playback = { audio: audio, cancel: function () { finish(); } };
        function finish(error) {
          if (settled) return;
          settled = true;
          audio.onended = null;
          audio.onerror = null;
          if (activeAudio === playback) activeAudio = null;
          if (error) reject(error);
          else resolve();
        }
        activeAudio = playback;
        audio.playbackRate = rate || 1;
        audio.onended = function () { finish(); };
        audio.onerror = function () {
          finish(new Error('audio playback failed'));
        };
        try {
          var started = audio.play();
          if (started && typeof started.catch === 'function') {
            started.catch(function (err) { finish(new Error('browser blocked playback: ' + err.message)); });
          }
        } catch (err) {
          finish(err);
        }
      });
    });
  }

  function stop() {
    generation += 1;
    pending.forEach(function (entry) { entry.cancel(cancellationError()); });
    pending.clear();
    if (activeAudio) {
      var playback = activeAudio;
      try {
        playback.audio.pause();
        playback.audio.currentTime = 0;
      } catch (err) {
        /* ignore */
      }
      playback.cancel();
    }
    setFeedback('', '');
  }

  function prefetch(word) {
    if (!initialized || !active || !word) return;
    fetchAudio(word).catch(function () { /* prefetch failures are not user-visible */ });
  }

  function setActive(isActive) {
    active = !!isActive;
    if (!active) stop();
  }

  function init() {
    if (initialized) return;
    ui.panel = el('remotePanel');
    if (!ui.panel) return; // markup removed; feature simply unavailable

    ui.endpoint = el('remoteEndpoint');
    ui.key = el('remoteApiKey');
    ui.model = el('remoteModel');
    ui.voice = el('remoteVoice');
    ui.feedback = el('remoteFeedback');
    ui.warning = el('remoteWarning');
    initialized = true;

    loadSettings();
    updateWarning();

    function settingsChanged() {
      stop();
      cache.forEach(function (url) { URL.revokeObjectURL(url); });
      cache.clear();
      document.dispatchEvent(new CustomEvent('remote-settings-change'));
    }

    ui.endpoint.addEventListener('input', function () {
      settingsChanged();
      saveSetting(STORAGE.endpoint, ui.endpoint.value.trim());
      updateWarning();
    });

    ui.model.addEventListener('input', function () {
      settingsChanged();
      saveSetting(STORAGE.model, ui.model.value.trim());
    });

    ui.voice.addEventListener('input', function () {
      settingsChanged();
      saveSetting(STORAGE.voice, ui.voice.value.trim());
    });

    ui.key.addEventListener('input', function () {
      settingsChanged();
      apiKey = ui.key.value.trim(); // memory only, never persisted
    });

    var preset = el('remoteLocalPreset');
    if (preset) {
      preset.addEventListener('click', function () {
        settingsChanged();
        ui.endpoint.value = 'http://localhost:8000/v1';
        saveSetting(STORAGE.endpoint, ui.endpoint.value);
        updateWarning();
        setFeedback('Endpoint set to a local server. Leave the API key blank unless your server needs one.', 'info');
      });
    }

    var testBtn = el('remoteTestBtn');
    if (testBtn) {
      testBtn.addEventListener('click', function () {
        document.dispatchEvent(new CustomEvent('remote-test'));
      });
    }
  }

  async function testConnection() {
    if (!active || !initialized) return;
    var token = generation;
    setFeedback('Contacting ' + endpoint() + '...', 'info');
    try {
      await speak('bitcoin', 1);
      if (active && generation === token) setFeedback('Connected. Audio played.', 'ok');
    } catch (err) {
      if (active && generation === token) {
        setFeedback('Failed: ' + err.message + ' — check the endpoint and its CORS policy. See README.md.', 'error');
      }
    }
  }

  global.TTSRemote = {
    init: init,
    testConnection: testConnection,
    speak: speak,
    stop: stop,
    prefetch: prefetch,
    setActive: setActive,
    isLoopbackEndpoint: isLoopbackEndpoint
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);
