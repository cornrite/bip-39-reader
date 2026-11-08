# Publication checklist

Do not treat this checklist as proof that a release has happened. Complete the following before
the first public commit/push or describing this as ready for maintainer review.

- [ ] Run `python verify_bip39.py` and `python test_bip39.py`; both exit 0.
- [ ] Open `test_browser.html` from `file://`; all tests pass. Run the manual checks in [TESTING.md](TESTING.md).
- [ ] Review the actual final diff and all staged contents, including untracked new documents/tests.
      This repository initially had files staged before fixes; staging is not automatic.
- [ ] Check for keys, tokens, real recovery material, private paths, logs, and unintended files. Never
      publish browser profiles or local test output. Verify no `.gitmodules`, vendored repository,
      package-manager files, or modified canonical word bytes have appeared.
- [ ] Confirm the intended public name/email in Git's effective author/committer identity; use an
      appropriate GitHub no-reply address if desired. Do not infer identity from a Windows account name.
- [ ] Choose/create the GitHub repository, confirm visibility and URL, and review remote configuration.
- [ ] Enable **Settings → Security → Private vulnerability reporting** on GitHub; verify that the
      **Security → Report a vulnerability** route works. If unavailable, choose a real private contact
      and update `SECURITY.md` before release. Never fabricate a contact or claim it is enabled locally.
- [ ] Review [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), relevant model/provider
      terms, and the documented unresolved SHA-256 provenance. Decide whether further provenance or
      legal review is needed; automated tests cannot resolve licensing uncertainty.
- [ ] Commit only the reviewed files, push to the confirmed remote, and inspect the published tree.
- [ ] Request SeedSigner maintainer review as an independent inventory utility, not an endorsed
      ceremony method or an audited wallet/security product. Include test results and limitations.

No repository URL, author identity, private reporting configuration, or publication status is inferred
or hard-coded by the app. These are maintainer decisions.