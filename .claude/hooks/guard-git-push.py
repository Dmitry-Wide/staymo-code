#!/usr/bin/env python3
"""PreToolUse hook: refuse a force-push, and any deletion of main, from Claude's shell tools.

core.hooksPath does not travel to cloud sessions and most repos have no .githooks/pre-push,
so this is the gate that goes wherever .claude/ goes. It stops accidents, not a determined
push: aliases, scripts, eval, `... | sh`, `git -c remote.*.push=+...`, `git submodule foreach`,
`rebase --exec`, `watch`, empty expansions ("${X}:main") and bash's $'...' quoting slip past it.

Force-push is refused on every branch, not only main: the target of a bare `git push -f`
cannot be read from the command line, and the studio rule is "no push --force" anyway.
To replace your own branch, push it under a new name.

Source: Dmitry-Wide/studio .claude/hooks/guard-git-push.py. Edit there, copy to each repo.
Self-test: python3 .claude/hooks/guard-git-push.py --selftest
"""
import json
import os
import re
import shlex
import sys

PROTECTED = ("main", "heads/main", "refs/heads/main")
FORCE_OPTS = ("--force", "--force-with-lease", "--force-if-includes", "--mirror")
SHELLS = ("sh", "bash", "zsh")
GIT_OPTS_WITH_ARG = ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env",
                     "--attr-source")
HEREDOC = re.compile(r"(?<!<)<<(-?)\s*(\\?)(['\"]?)([A-Za-z_][\w.-]*)\3")
SHELL_READS_HEREDOC = re.compile(r"(?:^|[;&|(])\s*(?:[^\s;&|(]*/)?(?:ba|z)?sh\b[^;&|<]*<<")

FORCE = ("Blocked by .claude/hooks/guard-git-push.py: force-push is off for agents "
         "(--force, --force-with-lease, -f, +refspec, --mirror). main is never rewritten: "
         "if the push was rejected, run `git pull --rebase` and push again. To replace your "
         "own branch, push it under a new name. Only Dmitry can override, by hand.")
DELETE = ("Blocked by .claude/hooks/guard-git-push.py: deleting main on the remote is off "
          "for agents (--delete/-d main, :main, --prune). Ask Dmitry.")
API = ("Blocked by .claude/hooks/guard-git-push.py: moving or deleting refs/heads/main "
       "through the GitHub API is off for agents. Ask Dmitry.")


def split_heredocs(cmd):
    """(the command without heredoc bodies, the bodies the shell expands).

    A heredoc body is data (a commit message quoting `git push --force`), not a command. But an
    unquoted one still runs `...` and $(...), and one fed to a shell is commands after all.
    """
    lines, out, expanding = cmd.split("\n"), [], []
    pending, body, opened, kept = [], [], 0, 0
    for k, line in enumerate(lines):
        if pending:
            dash, literal, word, to_shell = pending[0]
            if (line.lstrip("\t") if dash else line) == word:
                if not literal:
                    expanding.append("\n".join(body))
                if to_shell:
                    out.extend(body)
                pending.pop(0)
                body = []
            else:
                body.append(line)
            continue
        out.append(line)
        opened, kept = k, len(out)
        to_shell = "<<" in line and SHELL_READS_HEREDOC.search(line) is not None
        pending = [(d, bool(b or q), w, to_shell) for d, b, q, w in HEREDOC.findall(line)]
    if pending:  # never closed, so no heredoc at all (`"<<EOF"` inside a string): keep the lines
        out = out[:kept] + lines[opened + 1:]
    return "\n".join(out), expanding


def substitutions(text, heredoc=False):
    """Bodies of `...` and $(...) that the shell runs: outside single quotes, even inside "...".

    In a heredoc body every quote is literal.
    ponytail: an apostrophe in a `# comment` opens a quote here and hides the substitutions after
    it; accident-grade.
    """
    out, i, n, quote = [], 0, len(text), None
    while i < n:
        c = text[i]
        if quote == "'":
            quote = None if c == "'" else quote
        elif c == "\\":
            i += 1
        elif c in "'\"" and not heredoc:
            quote = None if quote == c else (quote or c)
        elif c == "`":
            j = text.find("`", i + 1)
            j = n if j < 0 else j
            out.append(text[i + 1:j])
            i = j
        elif text.startswith("$(", i):
            depth, j = 1, i + 2
            while j < n and depth:
                depth += {"(": 1, ")": -1}.get(text[j], 0)
                j += 1
            out.append(text[i + 2:j - 1] if depth == 0 else text[i + 2:])
            i = j - 1
        i += 1
    return out


def tokens(text):
    # A # inside a word is no comment (color:#5a53a0, $#, ${#a[@]}), but shlex thinks it is.
    text = re.sub(r"(?<=[^\s'\";&|()<>])#", "\x1f", text.replace("\\\n", " "))
    # `;` after each newline keeps commands apart even when a `# comment` eats the newline.
    text = text.replace("\n", "\n;")
    if len(text) > 100_000:  # shlex is quadratic here; past the hook timeout it would fail open
        return re.findall(r"[;&|()<>]+|[^\s;&|()<>]+", text)
    lex = shlex.shlex(text, posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    try:
        return list(lex)
    except ValueError:  # unbalanced quote: fall back to bare words so a push is still seen
        return re.findall(r"[;&|()<>]+|[^\s;&|()<>]+", text)


def segments(toks):
    seg = []
    for t in toks:
        if t and all(c in ";&|()<>" for c in t):
            yield seg
            seg = []
        else:
            seg.append(t)
    yield seg


def short_flag(arg, letter):
    return re.fullmatch(r"-[A-Za-z0-9]+", arg) is not None and letter in arg


def long_opt(arg, names):
    # git takes any unambiguous prefix of a long option: --force-w, --mirr, --del.
    name = arg.split("=", 1)[0]
    return len(name) >= 5 and any(n.startswith(name) for n in names)


def check_push(args):
    it = iter(args)
    for a in it:  # skip git's global options to reach the subcommand
        if a in GIT_OPTS_WITH_ARG:
            next(it, None)
        elif not a.startswith("-"):
            if a != "push":
                return None
            break
    else:
        return None
    rest = list(it)
    flags = [a for a in rest if a.startswith("-")]
    refs = [a for a in rest if not a.startswith("-")]
    if (any(long_opt(a, FORCE_OPTS) or short_flag(a, "f") for a in flags)
            or any(r.startswith("+") for r in refs)):
        return FORCE
    deleting = any(long_opt(a, ("--delete",)) or short_flag(a, "d") for a in flags)
    if (any(long_opt(a, ("--prune",)) for a in flags)
            or (deleting and any(r in PROTECTED for r in refs))
            or any(r.lstrip("+").startswith(":") and r.lstrip("+")[1:] in PROTECTED for r in refs)):
        return DELETE
    return None


def check_gh(args):
    # The REST route to the same move: PATCH (force) or DELETE on git/refs/heads/main.
    if (any(a.endswith("git/refs/heads/main") for a in args)
            and any(re.fullmatch(r"(-X|--method=?)?(DELETE|PATCH)", a, re.I) for a in args)):
        return API
    return None


def shell_script(args):
    """The script of `sh [flags] -c 'script'`, or None."""
    it = iter(args)
    for a in it:
        if short_flag(a, "c"):
            return next(it, None)
        if re.fullmatch(r"[-+][A-Za-z]*o", a):  # -o pipefail, -euo pipefail: o takes a value
            next(it, None)
        elif not a.startswith(("-", "+")):
            return None
    return None


def verdict(cmd):
    """Why the command must not run, or None."""
    text, bodies = split_heredocs(cmd)
    for sub in substitutions(text) + [s for b in bodies for s in substitutions(b, heredoc=True)]:
        why = verdict(sub)
        if why:
            return why
    for seg in segments(tokens(text)):
        for i, t in enumerate(seg):
            name = os.path.basename(t).lstrip("=").lower()  # zsh runs =git; APFS runs GIT
            if name == "git":
                why = check_push(seg[i + 1:])
            elif name == "gh" and seg[i + 1:i + 2] == ["api"]:
                why = check_gh(seg[i + 2:])
            elif name in SHELLS:
                script = shell_script(seg[i + 1:])
                why = verdict(script) if script else None
            else:
                continue
            if why:
                return why
    return None


def selftest():
    blocked = [
        "git push --force origin main",
        "git push -f origin main",
        "git push -uf origin claude/x",
        "git push --force-with-lease origin claude/x",
        "git push --force-with-lease=main:abc origin main",
        "git push --force-if-includes origin main",
        "git push origin +main",
        "git push origin +HEAD:main",
        "git push --mirror origin",
        "git push origin main --force",
        "cd repo && git push --force origin main",
        "git fetch; git push -f",
        "git -C ../repo push -f origin main",
        "git -c push.default=current push -f",
        "/usr/bin/git push --force origin main",
        "GIT_TRACE=1 git push --force origin main",
        "git push origin --delete main",
        "git push -d origin main",
        "git push origin :main",
        "git push origin :refs/heads/main",
        "git push --prune origin 'refs/heads/*:refs/heads/*'",
        "bash -c 'git push --force origin main'",
        "sh -lc \"cd x && git push -f\"",
        "git status && git push \\\n  --force origin main",
        "git push origin x # plain\ngit push -f origin main",
        "echo don't && git push -f origin main",
        "$(git push -f origin main)",
        # the shell runs `...` and $(...) even inside double quotes
        'git commit -m "feat: blocks `git push --force origin main`"',
        'result="$(git push --force-with-lease origin claude/x 2>&1)" && echo "$result"',
        'echo "r: $(git push -f origin "$(git branch --show-current)")"',
        "git commit -F - <<EOF\nfix `git push -f origin main`\nEOF",
        # a mid-word # is not a comment
        "grep -rn color:#5a53a0 docs && git push -f origin main",
        "[ $# -eq 0 ] && git push -f origin main",
        # heredoc edge cases must not hide the commands after them
        'git commit -m "fix: hook\n\nStrips <<EOF heredoc bodies."\ngit push --force origin main',
        "cat > f <<END-MSG\nx\nEND-MSG\ngit push -f origin main",
        "cat > s.sh <<'EOF'\necho a \\\nEOF\ngit push -f origin main",
        "bash <<'EOF'\ngit push -f origin main\nEOF",
        # flags git accepts in other spellings
        'bash -o pipefail -c "git push -f origin main"',
        "bash -l -c 'git push -f'",
        'bash -euo pipefail -c "git push -f origin main"',
        "git push -4f origin main",
        "git push --force-w origin main",
        "git push --mirr origin",
        "git push --del origin main",
        "git push origin :heads/main",
        "git push --delete origin heads/main",
        "git --config-env x=Y push -f origin main",
        "=git push -f origin main",
        "GIT push -f origin main",
        # the same move through the REST API
        "gh api -X DELETE repos/o/r/git/refs/heads/main",
        "gh api --method PATCH repos/o/r/git/refs/heads/main -F force=true",
    ]
    allowed = [
        "git push origin main",
        "git push -u origin claude/cloud-move-slice-7",
        "git push origin HEAD:claude/x",
        "git push --dry-run origin main",
        "git push -d origin claude/old",
        "git push origin :claude/old",
        "git status",
        "git log --format=%H -n 1 | xargs echo",
        "grep -rn 'git push --force' docs/",
        'git commit -m "hook blocks git push --force origin main"',
        "git commit -F - <<'EOF'\nfix: guard\n\ngit push --force origin main is blocked now\nEOF\ngit log -1",
        "git commit -F - <<EOF\ngit push -f\nEOF",
        'git commit -m "$(cat <<\'EOF\'\ngit push --force origin main\nEOF\n)"',
        "git push origin x # not --force",
        "rm -f file && git push origin main",
        "gh pr create --title 'no git push --force here'",
        "git push origin main 2>&1 | tail -f",
        "git commit -m 'docs: never `git push -f` by hand'",
        'gh pr create --title "Slice 7" --body "Refuses git push --force; <<EOF bodies skipped.\nmore"',
        "cat > howto.md <<'EOF'\n    git commit -F - <<'EOF'\n    msg\n    EOF\nNever run git push --force\nEOF",
        "git commit -F - <<'COMMIT-MSG'\ndocs: git push -f is off\nCOMMIT-MSG",
        "git commit -F - <<\\EOF\ngit push -f\nEOF",
        'echo "files: ${#files[@]}" && git push origin main',
        "git push --follow-tags origin main",
        "git push --dry-run --porcelain origin main",
        "gh api repos/o/r/git/refs/heads/main",
        "gh api -X DELETE repos/o/r/git/refs/heads/claude/old",
    ]
    fail = 0
    for cmd, want in [(c, True) for c in blocked] + [(c, False) for c in allowed]:
        got = verdict(cmd) is not None
        print(("  ok    " if got == want else "  FAIL  ") + ("block " if want else "allow ") + repr(cmd))
        fail += got != want
    # A long command must be decided well inside the 10 s hook timeout, or it fails open.
    import time
    t = time.time()
    verdict("echo '" + "|" * 99_000 + "' && git push -f origin main")
    dt = time.time() - t
    print(("  ok    " if dt < 1 else "  FAIL  ") + f"99k-char command decided in {dt:.2f}s")
    fail += dt >= 1
    # The stdin path: bad input must not crash the hook open.
    for raw, want in [('{"tool_input":{"command":123}}', False), ('{"tool_input":null}', False),
                      ("", False), ('{"tool_input":{"command":"git push -f', True)]:
        try:
            got = decide(raw) is not None
        except Exception as e:  # noqa: BLE001 - a crash is the failure under test
            got = repr(e)
        print(("  ok    " if got == want else "  FAIL  ") + f"stdin {raw!r} -> {got}")
        fail += got != want
    print("guard-git-push: all checks passed" if not fail else f"guard-git-push: {fail} FAILED")
    return 1 if fail else 0


def decide(raw):
    """The hook's stdin, the tool call as JSON -> why to refuse it, or None."""
    try:
        cmd = (json.loads(raw).get("tool_input") or {}).get("command") or ""
        return verdict(cmd if isinstance(cmd, str) else json.dumps(cmd))
    except Exception as e:  # noqa: BLE001 - a crashed hook fails open: refuse what looks like a push
        if "push" in raw:
            return f"guard-git-push.py could not read this call ({e!r}); refusing it: it mentions push."
        return None


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        sys.exit(selftest())
    why = decide(sys.stdin.read())
    if why:
        print(why, file=sys.stderr)
        sys.exit(2)  # exit 2 = block the tool call; stderr goes back to Claude
