#!/usr/bin/env python3
"""verify_bip39.py - independent check of the BIP-39 word list in this folder.

The browser badge is convenient, but it runs inside the page it is checking.
This script is the out-of-band check: it uses only the Python standard library
and has no idea what the browser thinks.

It fails (exit code 1) unless all of the following hold:

  1. english.txt is byte-for-byte the canonical upstream file. appending,
     truncating, re-encoding or re-wrapping the file changes the hash.
  2. english.txt holds exactly 2048 unique words, all lowercase ASCII.
  3. words.js is one single statement - ``const EMBEDDED_WORDS = [...];`` -
     with nothing before or after it, and that array is exactly the same list.
     (A previous version of this script only hashed the text between the first
     '[' and the last ']', which accepted words.js with arbitrary JavaScript
     appended to it. It no longer does.)
  4. The list hashes to the canonical SHA-256 fingerprint

       2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda

     computed over the 2048 words joined by LF with a trailing LF, which is the
     exact byte content of the upstream english.txt file.

Usage:
    python verify_bip39.py                     # verify this folder
    python verify_bip39.py path/to/folder      # verify another copy
    python verify_bip39.py --write-words-js    # rebuild words.js from english.txt

Standard library only: hashlib, json, argparse, sys, pathlib.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

CANONICAL_SHA256 = "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda"
EXPECTED_WORD_COUNT = 2048
ENGLISH_TXT_NAME = "english.txt"
WORDS_JS_NAME = "words.js"
WORDS_JS_PREFIX = "const EMBEDDED_WORDS = "
WORDS_JS_SUFFIX = ";"


class WordListError(Exception):
    """Raised when a word file is not in the expected shape."""


def sha256_hex(text: str) -> str:
    """SHA-256 of a string, encoded as UTF-8 without a BOM."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_hex_bytes(raw: bytes) -> str:
    """SHA-256 of raw bytes, exactly as stored on disk."""
    return hashlib.sha256(raw).hexdigest()


def decode_text(raw: bytes) -> str:
    """Decode UTF-8, tolerating (and ignoring) a byte order mark."""
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise WordListError("file is not valid UTF-8 text (%s)" % exc)


def normalize_words(raw: bytes) -> list:
    """Word list content, ignoring BOM, line ending style and blank lines."""
    text = decode_text(raw).replace("\r\n", "\n").replace("\r", "\n")
    return [line.strip() for line in text.split("\n") if line.strip()]


def compute_hash(words) -> str:
    """Canonical hash: words joined by LF, trailing LF, UTF-8, no BOM."""
    return sha256_hex("\n".join(words) + "\n")


def render_words_js(words) -> str:
    """The exact words.js content for a word list (LF endings)."""
    return WORDS_JS_PREFIX + json.dumps(words) + WORDS_JS_SUFFIX + "\n"


def parse_words_js(raw: bytes) -> list:
    """Parse words.js strictly: one statement, one array, nothing else.

    Line ending style is tolerated (CRLF checkouts still work) but any extra
    JavaScript, comments, reformatting or non-string entry is rejected.
    """
    text = decode_text(raw).replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")

    if not text.startswith(WORDS_JS_PREFIX):
        raise WordListError(
            "%s must start with %r (found %r)"
            % (WORDS_JS_NAME, WORDS_JS_PREFIX, text[:48])
        )
    if not text.endswith(WORDS_JS_SUFFIX):
        raise WordListError(
            "%s must end with ';' - nothing may follow the word array" % WORDS_JS_NAME
        )

    body = text[len(WORDS_JS_PREFIX):-len(WORDS_JS_SUFFIX)]
    try:
        words = json.loads(body)
    except json.JSONDecodeError as exc:
        raise WordListError("%s array is not valid JSON: %s" % (WORDS_JS_NAME, exc))

    if not isinstance(words, list):
        raise WordListError("%s must contain a JSON array of strings" % WORDS_JS_NAME)

    for index, word in enumerate(words):
        if not isinstance(word, str):
            raise WordListError(
                "%s entry %d is not a string (found %s)"
                % (WORDS_JS_NAME, index + 1, type(word).__name__)
            )

    if render_words_js(words).rstrip("\n") != text:
        raise WordListError(
            "%s contains extra content or unexpected formatting around the word array"
            % WORDS_JS_NAME
        )

    return words


def check_word_content(words, source: str) -> None:
    """Raise WordListError unless the list looks like the BIP-39 English list."""
    if len(words) != EXPECTED_WORD_COUNT:
        raise WordListError(
            "%s has %d words, expected %d" % (source, len(words), EXPECTED_WORD_COUNT)
        )

    seen = set()
    for index, word in enumerate(words):
        if word in seen:
            raise WordListError("%s repeats %r (entry %d)" % (source, word, index + 1))
        seen.add(word)
        if word != word.lower():
            raise WordListError("%s entry %d is not lowercase: %r" % (source, index + 1, word))
        if not word.isascii() or not word.isalpha():
            raise WordListError(
                "%s entry %d is not plain ASCII letters: %r" % (source, index + 1, word)
            )


def verify(root_dir=None, verbose: bool = True) -> int:
    """Verify the word list in ``root_dir``. Returns 0 on success, 1 on failure."""
    root = Path(root_dir) if root_dir is not None else Path(__file__).resolve().parent
    english_path = root / ENGLISH_TXT_NAME
    words_path = root / WORDS_JS_NAME

    def log(message: str = "") -> None:
        if verbose:
            print(message)

    def fail(message: str) -> int:
        log("FAIL " + message)
        return 1

    log("BIP-39 word list verification")
    log("  folder: %s" % root)

    # 1. english.txt must be byte-identical to the canonical upstream file.
    if not english_path.is_file():
        return fail("%s is missing" % ENGLISH_TXT_NAME)

    raw_english = english_path.read_bytes()
    raw_hash = sha256_hex_bytes(raw_english)
    log("  %-12s %s bytes  sha256 %s"
        % (ENGLISH_TXT_NAME, format(len(raw_english), ","), raw_hash))

    if raw_hash != CANONICAL_SHA256:
        try:
            content_words = normalize_words(raw_english)
        except WordListError as exc:
            return fail(str(exc))

        content_hash = compute_hash(content_words)
        if content_hash == CANONICAL_SHA256:
            log("FAIL %s holds the right words but the wrong bytes." % ENGLISH_TXT_NAME)
            log("     Line endings or a byte order mark changed; the hash covers raw bytes.")
            log("     Fix: download the raw file again, or run: git add --renormalize .")
            return 1

        log("FAIL %s does not match the canonical BIP-39 list" % ENGLISH_TXT_NAME)
        log("     expected sha256 %s" % CANONICAL_SHA256)
        log("     found    sha256 %s (words joined by LF)" % content_hash)
        return 1

    # 2. Content sanity: count, duplicates, character set.
    try:
        english_words = normalize_words(raw_english)
        check_word_content(english_words, ENGLISH_TXT_NAME)
    except WordListError as exc:
        return fail(str(exc))

    log("  %-12s %s unique lowercase words"
        % ("words", format(len(english_words), ",")))

    # 3. words.js must be exactly the generated copy of that list.
    if not words_path.is_file():
        return fail(
            "%s is missing (regenerate with: python verify_bip39.py --write-words-js)"
            % WORDS_JS_NAME
        )

    raw_words_js = words_path.read_bytes()
    log("  %-12s %s bytes" % (WORDS_JS_NAME, format(len(raw_words_js), ",")))

    try:
        embedded_words = parse_words_js(raw_words_js)
    except WordListError as exc:
        return fail(str(exc))

    if len(embedded_words) != len(english_words):
        return fail(
            "%s has %d words but %s has %d"
            % (WORDS_JS_NAME, len(embedded_words), ENGLISH_TXT_NAME, len(english_words))
        )

    for index, (embedded, expected) in enumerate(zip(embedded_words, english_words)):
        if embedded != expected:
            return fail(
                "%s word %d is %r but %s has %r"
                % (WORDS_JS_NAME, index + 1, embedded, ENGLISH_TXT_NAME, expected)
            )

    if compute_hash(embedded_words) != CANONICAL_SHA256:
        return fail("%s does not hash to the canonical fingerprint" % WORDS_JS_NAME)

    log("  %-12s OK (256-bit hash, %s words, nothing appended)"
        % ("result", format(len(english_words), ",")))
    log("")
    log("Word list verified. Canonical SHA-256:")
    log("  %s" % CANONICAL_SHA256)
    log("")
    log("This covers the word list only. To check the code that reads it, follow")
    log("VERIFY.md (download-and-compare, plus the in-app badge).")
    return 0


def write_words_js(root_dir=None, verbose: bool = True) -> int:
    """Rebuild words.js from english.txt. Refuses to write a non-canonical list."""
    root = Path(root_dir) if root_dir is not None else Path(__file__).resolve().parent
    english_path = root / ENGLISH_TXT_NAME
    words_path = root / WORDS_JS_NAME

    if not english_path.is_file():
        print("FAIL %s is missing" % ENGLISH_TXT_NAME, file=sys.stderr)
        return 1

    try:
        words = normalize_words(english_path.read_bytes())
        check_word_content(words, ENGLISH_TXT_NAME)
    except WordListError as exc:
        print("FAIL %s" % exc, file=sys.stderr)
        return 1

    if compute_hash(words) != CANONICAL_SHA256:
        print(
            "FAIL %s does not hash to the canonical fingerprint; refusing to write %s"
            % (ENGLISH_TXT_NAME, WORDS_JS_NAME),
            file=sys.stderr,
        )
        return 1

    content = render_words_js(words)
    with open(words_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)

    if verbose:
        print("Wrote %s (%s bytes, %s words, LF endings)"
              % (words_path.name, format(len(content.encode("utf-8")), ","), format(len(words), ",")))
        print("Canonical SHA-256: %s" % CANONICAL_SHA256)
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify the BIP-39 word list in this folder (standard library only)."
    )
    parser.add_argument(
        "folder",
        nargs="?",
        default=None,
        help="folder holding english.txt and words.js (default: this script's folder)",
    )
    parser.add_argument(
        "--write-words-js",
        action="store_true",
        help="regenerate words.js from english.txt, then exit",
    )
    args = parser.parse_args(argv)

    if args.write_words_js:
        return write_words_js(args.folder)
    return verify(args.folder)


if __name__ == "__main__":
    sys.exit(main())

