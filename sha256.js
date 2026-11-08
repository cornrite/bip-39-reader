/* sha256.js - SHA-256 helpers for the BIP-39 Word Reader.
 *
 * Two reasons this file exists:
 *   1. When the browser exposes WebCrypto, BOTH implementations run and their
 *      digests must agree. The badge reports that, so the number on screen is
 *      not the output of one unchecked function.
 *   2. When WebCrypto is unavailable (older browsers, or the folder served over
 *      plain http:// on a LAN) the pure JavaScript implementation still works.
 *
 * The pure implementation is checked against the published test vectors at
 * startup. If it fails, the app refuses to claim anything about the word list.
 *
 * No dependencies, no network access. Loaded as a classic script so file:// works.
 */
(function (global) {
  'use strict';

  // FIPS 180-4 round constants (first 32 bits of the cube roots of the first 64 primes).
  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  // Published FIPS 180-4 / RFC 6234 test vectors, plus regression vectors with
  // expected digests verified independently with sha256sum / Node's crypto.
  //
  // The extra inputs are not decoration. The published vectors happen to contain
  // no 32-bit word with more than one leading zero nibble, so a hex-padding bug
  // in wordsToHex() passed all three of them while producing malformed digests
  // for roughly one input in thirty. "vector-205" and "vector-69" contain such
  // words (0003616a and 00e90559) on purpose, so the self-test fails if the
  // padding ever regresses.
  var TEST_VECTORS = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['vector-205', 'd0f130820003616acf29c4c11780e32edf7c6626d59ad88c1260fba6baf0a5ce'],
    ['vector-69', '6ac74de8dc2b3d9c00e90559dc1191da36cba3e786e44fd69a377bb6eb3176ec'],
    ['vector-105', '5316f40650f0e967026835f12ec2eec67e2aebc8004e752026b0d26d7f54f955']
  ];

  var nativeEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  // UTF-8 encode without the deprecated unescape(encodeURIComponent(...)) trick.
  function utf8Bytes(text) {
    if (nativeEncoder) return nativeEncoder.encode(text);
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        var low = text.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return new Uint8Array(out);
  }

  function toHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return out;
  }

  // Every 32-bit word must be written as exactly 8 hex digits. Padding with a
  // single '0' is not enough: a word such as 0x0000abcd has five leading zeros,
  // which used to produce a 5-character chunk and a malformed digest for about
  // one input in thirty.
  function wordsToHex(h) {
    var out = '';
    for (var i = 0; i < h.length; i++) {
      var w = h[i] >>> 0;
      var hex = w.toString(16);
      while (hex.length < 8) hex = '0' + hex;
      out += hex;
    }
    return out;
  }

  function hashBytesPure(bytes) {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var len = bytes.length;
    var total = ((len + 9 + 63) >> 6) << 6;
    var buffer = new Uint8Array(total);
    buffer.set(bytes);
    buffer[len] = 0x80;

    var view = new DataView(buffer.buffer);
    var bitLength = len * 8;
    view.setUint32(total - 8, Math.floor(bitLength / 4294967296));
    view.setUint32(total - 4, bitLength >>> 0);

    var w = new Uint32Array(64);
    for (var offset = 0; offset < total; offset += 64) {
      var i;
      for (i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (i = 16; i < 64; i++) {
        var w15 = w[i - 15];
        var w2 = w[i - 2];
        var s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
        var s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }

      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var sum1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var choose = (e & f) ^ (~e & g);
        var temp1 = (hh + sum1 + choose + K[i] + w[i]) | 0;
        var sum0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var majority = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (sum0 + majority) | 0;
        hh = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }

      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    return wordsToHex(h);
  }

  function webCryptoAvailable() {
    return !!(global.crypto && global.crypto.subtle && global.crypto.subtle.digest);
  }

  // Returns { hex, engines } where engines is 'webcrypto+pure-js' or 'pure-js'.
  // Throws if the two implementations disagree, because that means the digest
  // cannot be trusted at all.
  async function hashBytes(bytes) {
    var pureHex = hashBytesPure(bytes);
    if (!webCryptoAvailable()) return { hex: pureHex, engines: 'pure-js' };
    var buffer;
    try {
      buffer = await global.crypto.subtle.digest('SHA-256', bytes);
    } catch (err) {
      return { hex: pureHex, engines: 'pure-js' };
    }
    var webHex = toHex(new Uint8Array(buffer));
    if (webHex !== pureHex) {
      throw new Error('SHA-256 implementations disagree (WebCrypto vs pure JS)');
    }
    return { hex: webHex, engines: 'webcrypto+pure-js' };
  }

  function hashText(text) {
    return hashBytes(utf8Bytes(text));
  }

  function selfTest() {
    for (var i = 0; i < TEST_VECTORS.length; i++) {
      if (hashBytesPure(utf8Bytes(TEST_VECTORS[i][0])) !== TEST_VECTORS[i][1]) return false;
    }
    return true;
  }

  global.SHA256 = {
    hashBytes: hashBytes,
    hashText: hashText,
    selfTest: selfTest,
    webCryptoAvailable: webCryptoAvailable,
    utf8Bytes: utf8Bytes
  };
})(typeof window !== 'undefined' ? window : this);
