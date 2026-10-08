#!/usr/bin/env python3
"""PreToolUse hook: refuse a force-push, any deletion of main, merging a PR that touches the locks and
editing or deleting a GitHub ruleset, from Claude's shell tools; gate the GitHub MCP merge.

core.hooksPath does not travel to cloud sessions and most repos have no .githooks/pre-push,
so this is the gate that goes wherever .claude/ goes. It stops accidents, not a determined
push: aliases, scripts, eval, `... | sh`, `git -c remote.*.push=+...`, `git submodule foreach`,
`rebase --exec`, `watch`, empty expansions ("${X}:main"), bash's $'...' quoting and GraphQL
mutations slip past it.

The rulesets on GitHub reject a direct push to main, but the agents act with Dmitry's own token:
GitHub cannot tell them from him. So an agent merges its own PR only when the PR's files, read from
GitHub right here, miss the locks: .github/workflows/, .claude/hooks/, .claude/settings.json and, in
the kit, the check every copy's CI runs at the kit's main: action.yml, tools/studio-copy.py and the
workflow template it writes, templates/studio-kit.yml. A PR
that touches them, a PR whose files cannot be read in time, --auto (GitHub later merges a head the
hook never saw) and --admin are Dmitry's. A push to the PR between this check and the merge is not
seen. Loosening a ruleset is refused; creating one is allowed.

The MCP merge gate (S6 of the studio's tools/studio-map/feed-spec.md; Dmitry, 2026-10-08: agents merge
through MCP only through it). settings.json sends every `mcp__<server>__merge_pull_request` and
`..._enable_pr_auto_merge` here (matcher) and denies no merge_pull_request by name. Auto-merge is refused.
A merge passes only with merge_method "merge", expectedHeadSha (GitHub then refuses it if the head
moved: no race), a commit_message carrying «Ревизор: ok · <its sha7>» (a tripwire, not proof), a clone
of owner/repo at $CLAUDE_PROJECT_DIR or beside it (`../<repo>`, origin matching), `git fetch origin
refs/pull/<N>/head main` landing on that sha, and the files from merge-base to it missing the locks.
Any failure or timeout refuses. The fetch overwrites the clone's FETCH_HEAD and adds objects, nothing else.

The copy exception (decision 13, amended 2026-10-08, Dmitry: «копии — мои»), on both paths: outside
the kit, a PR that touches a lock passes when every lock file at its pinned head equals its source on
kit@main byte for byte (git blob ids: a hook at the same path; studio-kit.yml as templates/studio-kit.yml
renders it, with either set's flags) and every other file is a copy too (.claude/rules/studio.md, a
file of a .claude/skills/ dir that kit@main has). `gh pr merge` pins with `--match-head-commit <sha>`,
`gh api .../merge` with `-f sha=<sha>`. A lock edit in the kit itself, a lock with no source on kit@main
(.claude/settings.json, any other workflow), a lock gone at the head, a truncated tree or a failed
read of kit@main (through `gh api`) stay Dmitry's.

Force-push is refused on every branch, not only main: the target of a bare `git push -f`
cannot be read from the command line, and the studio rule is "no push --force" anyway.
To replace your own branch, push it under a new name.

Source: Dmitry-Wide/studio-kit .claude/hooks/guard-git-push.py. Edit there; its tools/studio-copy.py
copies it to each repo.
Self-test: python3 .claude/hooks/guard-git-push.py --selftest
"""
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time

# One budget for every `gh` call a command needs: past the hook's 10 s timeout it would fail open.
DEADLINE = time.monotonic() + 7
LOCKS = re.compile(r"(^|/)(\.github/workflows|\.claude/hooks)/|(^|/)\.claude/settings\.json$"
                   r"|^(action\.yml|tools/studio-copy\.py|templates/studio-kit\.yml)$")  # the kit's check: every copy runs it at main
KIT = "dmitry-wide/studio-kit"  # lower case: GitHub names are case-insensitive
WORKFLOW = ".github/workflows/studio-kit.yml"  # the kit's tools/studio-copy.py writes it from TEMPLATE
TEMPLATE = "templates/studio-kit.yml"  # its flags as {flags}: "" (the core set) or "--skills"
COPIES = re.compile(r"^\.claude/(rules/studio\.md|skills/[^/]+/.+)$")  # the other files a copy writes
MCP_MERGE = re.compile(r"mcp__.+__merge_pull_request")
MCP_AUTO = re.compile(r"mcp__.+__enable_pr_auto_merge")
FIELD_OPTS = ("-f", "-F", "--field", "--raw-field")
MERGE_OPTS_WITH_ARG = ("-R", "--repo", "-A", "--author-email", "-b", "--body", "-F", "--body-file",
                       "-t", "--subject", "--match-head-commit")
PROTECTED = ("main", "heads/main", "refs/heads/main")
FORCE_OPTS = ("--force", "--force-with-lease", "--force-if-includes", "--mirror")
SHELLS = ("sh", "bash", "zsh")
GIT_OPTS_WITH_ARG = ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env",
                     "--attr-source")
HEREDOC = re.compile(r"(?<!<)<<(-?)\s*(\\?)(['\"]?)([A-Za-z_][\w.-]*)\3")
REDIRECT = re.compile(r"[<>]+&?|&>+")
SHELL_READS_HEREDOC = re.compile(r"(?:^|[;&|(])\s*(?:[^\s;&|(]*/)?(?:ba|z)?sh\b[^;&|<]*<<")

FORCE = ("Blocked by .claude/hooks/guard-git-push.py: force-push is off for agents "
         "(--force, --force-with-lease, -f, +refspec, --mirror). main is never rewritten: "
         "if the push was rejected, run `git pull --rebase` and push again. To replace your "
         "own branch, push it under a new name. Only Dmitry can override, by hand.")
DELETE = ("Blocked by .claude/hooks/guard-git-push.py: deleting main on the remote is off "
          "for agents (--delete/-d main, :main, --prune). Ask Dmitry.")
API = ("Blocked by .claude/hooks/guard-git-push.py: moving or deleting refs/heads/main "
       "through the GitHub API is off for agents. Ask Dmitry.")
NAME_PR = ("Blocked by .claude/hooks/guard-git-push.py: name the pull request by number and repo, "
           "`gh pr merge <N> -R <owner>/<repo>` or `gh api -X PUT repos/<owner>/<repo>/pulls/<N>/merge`: "
           "the hook reads its files before an agent merges it.")
LOCKED = ("Blocked by .claude/hooks/guard-git-push.py: {} touches {}. A PR that touches the checks and "
          "locks (.github/workflows/, .claude/hooks/, .claude/settings.json; in the kit, action.yml, "
          "tools/studio-copy.py, templates/studio-kit.yml) is Dmitry's to merge: give him the PR link.")
COPY = ("Blocked by .claude/hooks/guard-git-push.py: {} touches {} and is no kit copy an agent may merge "
        "({}). A PR that touches the locks is Dmitry's to merge, unless outside the kit every lock in it "
        "equals kit@main byte for byte and the merge pins the head: give him the PR link.")
NOPIN = "the merge pins no head: add `--match-head-commit <sha>` (gh api: `-f sha=<sha>`)"
GATE = ("Blocked by .claude/hooks/guard-git-push.py, the MCP merge gate: замок или нет вердикта — ссылку "
        "Дмитрию. {}.")
UNKNOWN = ("Blocked by .claude/hooks/guard-git-push.py: could not read the files of {} from GitHub ({}), "
           "so it may touch the locks. Retry, or give Dmitry the PR link.")
AUTO = ("Blocked by .claude/hooks/guard-git-push.py: --auto and --admin are off for agents. Wait for the "
        "required check (`gh pr checks <N> -R <owner>/<repo> --watch`), then merge.")
RULESET = ("Blocked by .claude/hooks/guard-git-push.py: editing or deleting a GitHub ruleset is off "
           "for agents (creating one is allowed). Ask Dmitry.")


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
    """Simple commands. A redirection goes, with its target and the fd before it: it does not end
    the command (`gh pr merge -R o/r 2>&1 16` runs PR 16, `git push origin x > log -f` forces).
    ponytail: `16>log` (an fd) and `16 >log` (an argument) tokenize alike, so a PR number right
    before a redirection is dropped too: a refusal, not a pass."""
    seg, target = [], False
    for t in toks:
        if target:
            target = False
        elif REDIRECT.fullmatch(t):
            if seg and seg[-1].isdigit():
                seg.pop()
            target = True
        elif t and all(c in ";&|()<>" for c in t):
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
    # The REST route to the same moves: PATCH (force) or DELETE on git/refs/heads/main; PUT on
    # pulls/N/merge; PUT, PATCH or DELETE on a ruleset. `gh api` without a method is GET or POST.
    methods = {m.group(2).upper() for a in args for m in [re.fullmatch(r"(-X=?|--method=?)?(DELETE|PATCH|PUT)", a, re.I)] if m}
    if any(a.endswith("git/refs/heads/main") for a in args) and methods & {"DELETE", "PATCH"}:
        return API
    if methods and any(re.search(r"pulls/[^/]+/merge\b", a) for a in args):
        pr = next(filter(None, (re.search(r"(?:^|/)repos/([\w.-]+)/([\w.-]+)/pulls/(\d+)/merge$", a)
                                for a in args)), None)
        return check_files(*pr.groups(), api_pin(args)) if pr else NAME_PR
    if methods and any(re.search(r"(^|/)rulesets(/|$)", a) for a in args):
        return RULESET
    return None


def api_pin(args):
    """The `sha` field of `gh api ... pulls/N/merge` (GitHub merges only that head), or ""."""
    for k, a in enumerate(args):
        if a in FIELD_OPTS:
            a = args[k + 1] if k + 1 < len(args) else ""
        elif re.match(r"-[fF].|--(raw-)?field=", a):
            a = re.sub(r"^(-[fF]|--(raw-)?field=)", "", a)
        else:
            continue
        if a.startswith("sha="):
            return a[4:]
    return ""


def check_pr(args):
    """`gh pr ARGS`: cobra takes -R before the subcommand too (`gh pr -R o/r merge 5`)."""
    k = 0
    while k < len(args) and args[k].startswith("-"):
        k += 2 if args[k] in ("-R", "--repo") else 1
    return check_merge(args[:k] + args[k + 1:]) if args[k:k + 1] == ["merge"] else None


def check_merge(args):
    """`gh pr merge ARGS`: why not, or None for a PR named by number and -R whose files miss the locks.

    gh takes the repo of the current folder and the PR of the current branch, but the hook sees the
    text, not the folder (`cd ../x && gh pr merge 5`): so the PR is named in full. -R also keeps gh's
    -d from deleting the local branch with `git branch -D`.
    """
    repo, pin, picks, it = "", "", [], iter(args)
    for a in it:
        opt, eq, val = a.partition("=")
        if a in ("-h", "--help"):
            return None  # gh prints the help and merges nothing
        if opt in ("--auto", "--admin"):
            return AUTO
        if opt in MERGE_OPTS_WITH_ARG:
            val = val if eq else next(it, "")
            repo = val if opt in ("-R", "--repo") else repo
            pin = val if opt == "--match-head-commit" else pin
        elif not a.startswith("-"):
            picks.append(a)
    m = re.fullmatch(r"(?:github\.com/)?([\w.-]+)/([\w.-]+)", repo)
    if not (m and picks and picks[0].isdigit()):
        return NAME_PR
    return check_files(m[1], m[2], picks[0], pin)


def check_files(owner, repo, number, pin=""):
    pr = f"{owner}/{repo}#{number}"
    files, why = pr_files(owner, repo, number)
    if why:
        return UNKNOWN.format(pr, why)
    hit = next((f for f in files if LOCKS.search(f)), None)
    if not hit:
        return None
    if f"{owner}/{repo}".lower() == KIT:
        return LOCKED.format(pr, hit)
    why = NOPIN if not pin else head_is(owner, repo, number, pin)
    if not why:
        have, why = api_blobs(owner, repo, pin.lower())
        why = why or copy_equal(files, have)
    return COPY.format(pr, hit, why) if why else None


def head_is(owner, repo, number, pin):
    """None when the PR's head is the pinned sha, else why not."""
    out, why = gh_api(f"repos/{owner}/{repo}/pulls/{number}", jq=".head.sha")
    if why:
        return f"its head: {why}"
    head = out.decode(errors="replace").strip()
    return None if head == pin.lower() else f"the pinned {pin[:12]} is not its head {head[:12]}"


def copy_equal(files, have):
    """None when every file is a kit copy and every lock among them, at the head whose {path: blob id} is
    `have`, equals its source on kit@main; else why not."""
    kit, why = api_blobs(*KIT.split("/"), "main")
    if why:
        return why
    for f in files:
        if not LOCKS.search(f):
            if not (COPIES.match(f) and f in kit):
                return f"{f} is not a kit copy"
            continue
        if f == WORKFLOW:
            text, why = gh_api(f"repos/{KIT}/contents/{TEMPLATE}?ref=main", raw=True)
            if why:
                return f"{TEMPLATE} on kit@main: {why}"
            want = {blob_id(text.replace(b"{flags}", flags)) for flags in (b"", b"--skills")}
        elif f.startswith(".claude/hooks/") and f in kit:
            want = {kit[f]}
        else:
            return f"{f} has no source on kit@main"
        if have.get(f) not in want:
            return f"{f} differs from kit@main" if f in have else f"{f} is gone at the head"
    return None


def blob_id(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def api_blobs(owner, repo, ref):
    """({path: git blob id} of the tree at ref, None) or (None, why)."""
    where = f"the tree of {owner}/{repo}@{ref[:12]}"
    out, why = gh_api(f"repos/{owner}/{repo}/git/trees/{ref}?recursive=1",
                      jq='.truncated, (.tree[] | select(.type == "blob") | [.path, .sha])')
    if why:
        return None, f"{where}: {why}"
    try:
        lines = out.decode().splitlines()
        tree = dict(json.loads(line) for line in lines[1:])
    except (ValueError, TypeError):  # bad JSON, a row that is no pair
        return None, f"{where}: unexpected gh output"
    if lines[:1] != ["false"]:
        return None, f"{where}: truncated"
    return tree, None


def gh_api(path, jq=None, raw=False):
    """(stdout bytes, None) or (None, why GitHub did not say), inside the one DEADLINE."""
    cmd = (["gh", "api", path] + (["--jq", jq] if jq else [])
           + (["-H", "Accept: application/vnd.github.raw"] if raw else []))
    return run_tool(cmd)


def run_tool(cmd, cwd=None):
    try:
        run = subprocess.run(cmd, cwd=cwd, stdin=subprocess.DEVNULL, capture_output=True,
                             env=dict(os.environ, GIT_TERMINAL_PROMPT="0"),
                             timeout=max(DEADLINE - time.monotonic(), 0.01))
    except (OSError, subprocess.TimeoutExpired) as e:
        return None, type(e).__name__
    if run.returncode:
        return None, (run.stderr.decode(errors="replace").strip() or f"exit {run.returncode}")[:200]
    return run.stdout, None


def check_mcp_merge(inp):
    """The MCP merge gate: why not, or None (see the docstring at the top)."""
    owner, repo, number = (str(inp.get(k, "")) for k in ("owner", "repo", "pullNumber"))
    head = str(inp.get("expectedHeadSha") or "").lower()
    if not (re.fullmatch(r"[\w.-]+", owner) and re.fullmatch(r"[\w.-]+", repo) and number.isdigit()):
        return GATE.format("Name the PR by owner, repo and pullNumber")
    if inp.get("merge_method") != "merge":
        return GATE.format('merge_method must be "merge": a merge commit')
    if not re.fullmatch(r"[0-9a-f]{40}", head):
        return GATE.format("expectedHeadSha must be the full sha of the head the reviewer read")
    if f"Ревизор: ok · {head[:7]}" not in str(inp.get("commit_message") or ""):
        return GATE.format(f"commit_message lacks the verdict line «Ревизор: ok · {head[:7]}»")
    clone = find_clone(owner, repo)
    if not clone:
        return GATE.format(f"No clone of {owner}/{repo} at $CLAUDE_PROJECT_DIR or beside it")
    files, why = pr_diff(clone, number, head)
    if why:
        return GATE.format(why)
    hit = next((f for f in files if LOCKS.search(f)), None)
    if not hit:
        return None
    if f"{owner}/{repo}".lower() == KIT:
        return GATE.format(f"It touches {hit}: in the kit every lock is Dmitry's")
    have, why = git_blobs(clone, head)
    why = why or copy_equal(files, have)
    return GATE.format(f"It touches {hit} and is no kit copy equal to kit@main: {why}") if why else None


def find_clone(owner, repo):
    """$CLAUDE_PROJECT_DIR or its sibling `<repo>`, whichever is a clone whose origin is owner/repo."""
    base = os.path.abspath(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    for d in (base, os.path.join(os.path.dirname(base), repo)):
        out, why = run_tool(["git", "-C", d, "remote", "get-url", "origin"]) if os.path.isdir(d) else (None, "-")
        url = "" if why else re.sub(r"(\.git)?/*$", "", out.decode(errors="replace").strip())
        if re.split(r"[/:]", url.lower())[-2:] == [owner.lower(), repo.lower()]:
            return d
    return None


def pr_diff(clone, number, head):
    """(the files the PR head changes since its merge-base with main, None) or (None, why)."""
    _, why = run_tool(["git", "-C", clone, "fetch", "--no-tags", "--quiet", "origin",
                       f"refs/pull/{number}/head", "refs/heads/main"])
    if why:
        return None, f"git fetch of PR {number} and main: {why}"
    path, why = run_tool(["git", "-C", clone, "rev-parse", "--git-path", "FETCH_HEAD"])
    try:  # relative to the clone; one line per refspec, in their order
        path = os.path.join(clone, path.decode().strip())
        fetched = [line.split("\t", 1)[0] for line in open(path, encoding="utf-8").read().splitlines()]
    except (OSError, AttributeError, UnicodeDecodeError) as e:
        return None, f"FETCH_HEAD: {why or type(e).__name__}"
    if len(fetched) != 2:
        return None, "FETCH_HEAD: not the PR head and main"
    if fetched[0] != head:
        return None, f"The head moved: PR {number} is at {fetched[0][:12]}, expectedHeadSha {head[:12]}"
    base, why = run_tool(["git", "-C", clone, "merge-base", fetched[1], head])
    if why:
        return None, f"git merge-base with main: {why}"
    out, why = run_tool(["git", "-C", clone, "diff", "--name-only", "--no-renames", "-z",
                         base.decode().strip(), head])
    if why:
        return None, f"git diff: {why}"
    return [f for f in out.decode(errors="replace").split("\0") if f], None


def git_blobs(clone, ref):
    """({path: git blob id} of the tree at ref, None) or (None, why), from the clone."""
    out, why = run_tool(["git", "-C", clone, "ls-tree", "-r", "-z", "--full-tree", ref])
    if why:
        return None, f"git ls-tree: {why}"
    tree = {}
    for row in out.decode(errors="replace").split("\0"):
        meta, _, path = row.partition("\t")
        if meta.split(" ")[1:2] == ["blob"]:
            tree[path] = meta.split(" ")[2]
    return tree, None


def pr_files(owner, repo, number):
    """(every path the PR touches, both names of a rename, None) or (None, why GitHub did not say)."""
    try:
        run = subprocess.run(
            ["gh", "api", "--paginate", f"repos/{owner}/{repo}/pulls/{number}/files?per_page=100",
             "--jq", ".[] | [.filename, .previous_filename]"],
            stdin=subprocess.DEVNULL, capture_output=True, text=True,
            timeout=max(DEADLINE - time.monotonic(), 0.01))
        if run.returncode:
            return None, (run.stderr.strip() or f"gh exit {run.returncode}")[:200]
        rows = [json.loads(line) for line in run.stdout.splitlines()]
    except (OSError, ValueError, subprocess.TimeoutExpired) as e:
        return None, type(e).__name__
    if not all(isinstance(r, list) for r in rows):
        return None, "unexpected gh output"
    if len(rows) >= 3000:  # the REST API lists at most 3000 files and drops the rest silently
        return None, "3000 files or more"
    return [f for r in rows for f in r if isinstance(f, str)], None


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
            elif name == "gh" and seg[i + 1:i + 2] == ["pr"]:
                why = check_pr(seg[i + 2:])
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
    global pr_files, gh_api, DEADLINE
    real_pr_files = pr_files  # no network in the checks below: a PR's files come from this table
    fake = {"10": ["docs/a.md"], "11": ["docs/a.md", ".github/workflows/studio-kit.yml"],
            "12": [".claude/hooks/guard-git-push.py"], "13": [".claude/settings.json"],
            "14": ["docs/guard.py", ".claude/hooks/guard.py"],  # moved out of the hooks folder
            "15": ["site/.claude/settings.json"], "16": ["action.yml"], "17": ["tools/studio-copy.py"],
            "18": ["site/action.yml", "tools/studio-copy.py.md"],  # the kit's check is locked at its own paths only
            "19": ["templates/studio-kit.yml"]}  # the workflow every copy runs, as studio-copy writes it
    pr_files = lambda o, r, n: (fake[n], None) if (o, r) == ("o", "r") and n in fake else (None, "HTTP 404")
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
        # a ruleset is loosened only by hand
        "gh api -X PUT repos/o/r/rulesets/1 -f enforcement=disabled",
        "gh api -XDELETE repos/o/r/rulesets/1",
        "gh api --method PATCH repos/o/r/rulesets/7",
        "gh api -X=DELETE repos/o/r/rulesets/1",
        "gh api -X=DELETE repos/o/r/git/refs/heads/main",
        # a redirection does not end the command: -f after it still forces
        "git push origin main > log -f",
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
        "gh pr view 10 --json state,mergeStateStatus",
        "gh pr create --title 'gh pr merge is off for agents'",
        "gh api repos/o/r/pulls/10/merge",
        "gh api repos/o/r/rulesets",
        "gh api -X POST repos/o/r/rulesets --input main.json",
        "gh api repos/o/r/rules/branches/main",
        "gh help pr merge",
        "gh pr create --title merge --body x",
        "git push origin main > /tmp/push.log 2>&1",
    ]
    fail = 0
    for cmd, want in [(c, True) for c in blocked] + [(c, False) for c in allowed]:
        got = verdict(cmd) is not None
        print(("  ok    " if got == want else "  FAIL  ") + ("block " if want else "allow ") + repr(cmd))
        fail += got != want
    # An agent merges a PR named in full whose files miss the locks; the reason must be the right one.
    lock = lambda n, f: COPY.format(f"o/r#{n}", f, NOPIN)  # outside the kit; no pin, so no copy
    merges = [
        ("gh pr merge 10 -R o/r --merge", None),
        ("gh pr merge 10 --repo github.com/o/r -m -t 'docs: 11' -b 'x -R y/z'", None),
        ("gh pr merge 10 --repo=o/r -d 2>&1 | tail -3", None),
        ("gh api -X PUT repos/o/r/pulls/10/merge -f merge_method=merge", None),
        ("gh api --method=PUT /repos/o/r/pulls/10/merge", None),
        ("gh pr merge --help", None),
        ("gh pr merge 11 -R o/r --merge", lock(11, ".github/workflows/studio-kit.yml")),
        ("gh pr merge 12 -R o/r", lock(12, ".claude/hooks/guard-git-push.py")),
        ("gh pr merge -s 13 -R o/r", lock(13, ".claude/settings.json")),
        ("gh pr merge 14 -R o/r", lock(14, ".claude/hooks/guard.py")),
        ("gh pr merge 15 -R o/r", lock(15, "site/.claude/settings.json")),
        ("gh pr merge 16 -R o/r", lock(16, "action.yml")),
        ("gh pr merge 17 -R o/r", lock(17, "tools/studio-copy.py")),
        ("gh pr merge 19 -R o/r", lock(19, "templates/studio-kit.yml")),
        ("gh pr merge 18 -R o/r", None),
        ("gh api -X PUT repos/o/r/pulls/11/merge", lock(11, ".github/workflows/studio-kit.yml")),
        ("gh pr merge 10 -R o/r && gh pr merge 12 -R o/r", lock(12, ".claude/hooks/guard-git-push.py")),
        ("gh pr merge -R o/r --merge 2>&1 12", lock(12, ".claude/hooks/guard-git-push.py")),
        ("gh pr merge -R o/r 2>/dev/null 12 --merge", lock(12, ".claude/hooks/guard-git-push.py")),
        ("gh api -X=PUT repos/o/r/pulls/11/merge", lock(11, ".github/workflows/studio-kit.yml")),
        ("gh pr -R o/r merge 12", lock(12, ".claude/hooks/guard-git-push.py")),
        ("gh pr --repo=o/r merge 10 --merge", None),
        ("gh pr -Ro/r merge 12", NAME_PR),
        ("gh pr merge 10 -R Dmitry-Wide/studio --merge", UNKNOWN.format("Dmitry-Wide/studio#10", "HTTP 404")),
        ("gh pr merge 10", NAME_PR),
        ("cd ../x && gh pr merge 10 --merge", NAME_PR),
        ("gh pr merge -R o/r", NAME_PR),
        ("gh pr merge https://github.com/o/r/pull/10", NAME_PR),
        ("gh pr merge 10 -R ghe.example.com/o/r", NAME_PR),
        ("gh api -X PUT 'repos/{owner}/{repo}/pulls/10/merge'", NAME_PR),
        ("cd x && gh pr merge --auto --squash", AUTO),
        ("gh pr merge 10 -R o/r --auto", AUTO),
        ("gh pr merge 10 -R o/r --admin", AUTO),
    ]
    for cmd, want in merges:
        got = verdict(cmd)
        print(("  ok    " if got == want else "  FAIL  ") + f"merge {cmd!r} -> {(got or 'allow')[:90]}")
        fail += got != want

    # The copy exception. kit@main and each PR head come from these tables: a head is its number in hex.
    real_gh_api, hook_path, skill = gh_api, ".claude/hooks/guard-git-push.py", ".claude/skills/nodes/SKILL.md"
    hook, tpl = b"#!/usr/bin/env python3\n# guard\n", b'flags: "{flags}"\n'
    sha = lambda n: f"{int(n):040x}"
    kit = {hook_path: blob_id(hook), skill: "1" * 40, TEMPLATE: blob_id(tpl), ".claude/settings.json": "2" * 40}
    equal = {hook_path: blob_id(hook), WORKFLOW: blob_id(b'flags: "--skills"\n'), skill: "3" * 40, "docs/a.md": "4" * 40}
    heads = {"20": equal, "21": dict(equal, **{hook_path: blob_id(hook.replace(b"guard", b"guarD"))}),
             "22": dict(equal, **{".claude/settings.json": "5" * 40}), "23": equal,
             "24": dict(equal, **{WORKFLOW: blob_id(b'flags: "--skills"\n# edited\n')}),
             "25": {k: v for k, v in equal.items() if k != hook_path}, "26": equal}
    fake.update({"20": [hook_path, WORKFLOW, skill], "21": [hook_path], "22": [".claude/settings.json"],
                 "23": [hook_path, "docs/a.md"], "24": [WORKFLOW], "25": [hook_path],
                 "26": [".github/workflows/other.yml"]})
    kit_state = {"tree": "false\n", "up": True}

    def fake_gh_api(path, jq=None, raw=False):
        rows = lambda t: "".join(json.dumps([p, h]) + "\n" for p, h in t.items())
        m = re.fullmatch(r"repos/(?:o/r|Dmitry-Wide/studio-kit)/pulls/(\d+)", path)
        if m and m[1] in heads:
            return (sha(m[1]) + "\n").encode(), None
        m = re.fullmatch(r"repos/o/r/git/trees/([0-9a-f]{40})\?recursive=1", path)
        if m and str(int(m[1], 16)) in heads:
            return ("false\n" + rows(heads[str(int(m[1], 16))])).encode(), None
        if kit_state["up"] and path == f"repos/{KIT}/git/trees/main?recursive=1":
            return (kit_state["tree"] + rows(kit)).encode(), None
        if kit_state["up"] and path == f"repos/{KIT}/contents/{TEMPLATE}?ref=main" and raw:
            return tpl, None
        return None, "HTTP 404"
    gh_api = fake_gh_api
    pr_files = lambda o, r, n: (fake[n], None) if r in ("r", "studio-kit") and n in fake else (None, "HTTP 404")
    pin = lambda n: f" --match-head-commit {sha(n)}"
    copies = [
        ("gh pr merge 20 -R o/r --merge" + pin(20), None),
        (f"gh api -X PUT repos/o/r/pulls/20/merge -f merge_method=merge -f sha={sha(20)}", None),
        (f"gh api -X PUT repos/o/r/pulls/20/merge --raw-field=sha={sha(20)}", None),
        ("gh pr merge 20 -R o/r --merge", NOPIN),
        ("gh api -X PUT repos/o/r/pulls/20/merge -f merge_method=merge", NOPIN),
        ("gh pr merge 20 -R o/r --match-head-commit " + "c" * 40, "is not its head"),
        ("gh pr merge 21 -R o/r" + pin(21), f"{hook_path} differs from kit@main"),
        ("gh pr merge 22 -R o/r" + pin(22), ".claude/settings.json has no source on kit@main"),
        ("gh pr merge 23 -R o/r" + pin(23), "docs/a.md is not a kit copy"),
        ("gh pr merge 24 -R o/r" + pin(24), f"{WORKFLOW} differs from kit@main"),
        ("gh pr merge 25 -R o/r" + pin(25), f"{hook_path} is gone at the head"),
        ("gh pr merge 26 -R o/r" + pin(26), ".github/workflows/other.yml has no source on kit@main"),
        ("gh pr merge 20 -R Dmitry-Wide/studio-kit" + pin(20), LOCKED.format("Dmitry-Wide/studio-kit#20", hook_path)),
        ("gh pr merge 19 -R Dmitry-Wide/studio-kit" + pin(20),
         LOCKED.format("Dmitry-Wide/studio-kit#19", "templates/studio-kit.yml")),
        ("gh pr merge 20 -R o/r" + pin(20), "kit down: HTTP 404"),
        ("gh pr merge 20 -R o/r" + pin(20), "kit truncated: truncated"),
    ]
    for cmd, want in copies:
        kit_state.update(up="kit down" not in str(want), tree="true\n" if "truncated" in str(want) else "false\n")
        want = want.split(": ", 1)[1] if want and want.startswith("kit ") else want
        got = verdict(cmd)
        ok = got is None if want is None else got is not None and (got == want or want in got)
        print(("  ok    " if ok else "  FAIL  ") + f"copy {cmd[:70]!r} -> {(got or 'allow')[:110]}")
        fail += not ok
    kit_state.update(up=True, tree="false\n")

    # The MCP merge gate, on real git: a bare origin with refs/pull/<N>/head, a clone of it, kit@main as above.
    import tempfile
    saved = {k: os.environ.get(k) for k in ("CLAUDE_PROJECT_DIR", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM")}
    os.environ.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
    with tempfile.TemporaryDirectory() as d:
        def g(cwd, *a):
            return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false",
                                   *a], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()

        def put(work, files):
            for p, body in files.items():
                os.makedirs(os.path.dirname(os.path.join(work, p)) or work, exist_ok=True)
                open(os.path.join(work, p), "wb").write(body)
            g(work, "add", "-A")
            g(work, "commit", "-qm", "x")

        remote, work, other = (os.path.join(d, *p) for p in (("o", "r.git"), ("w", "r"), ("w", "other")))
        for p in (work, other):
            os.makedirs(p)
            g(p, "init", "-q")
        g(d, "init", "-q", "--bare", remote)
        g(work, "remote", "add", "origin", remote)
        g(other, "remote", "add", "origin", os.path.join(d, "o", "other.git"))
        put(work, {"docs/a.md": b"a\n", ".claude/hooks/x.py": b"x\n"})
        g(work, "branch", "-M", "main")
        g(work, "push", "-q", "origin", "main")
        prs = {}
        for n, change in [(5, {"docs/b.md": b"b\n"}), (6, {hook_path: hook}),
                          (7, {hook_path: hook.replace(b"guard", b"guarD")})]:
            g(work, "checkout", "-q", "-b", f"pr{n}", "main")
            put(work, change)
            prs[n] = g(work, "rev-parse", "HEAD")
            g(work, "push", "-q", "origin", f"HEAD:refs/pull/{n}/head")
            g(work, "checkout", "-q", "main")
        g(work, "checkout", "-q", "-b", "pr8", "main")
        g(work, "mv", ".claude/hooks/x.py", "docs/x.py")  # a move out of the hooks folder
        g(work, "commit", "-qm", "x")
        prs[8] = g(work, "rev-parse", "HEAD")
        g(work, "push", "-q", "origin", "HEAD:refs/pull/8/head")
        g(work, "checkout", "-q", "main")
        put(work, {".github/workflows/ci.yml": b"on: push\n"})  # main moves on, with a lock: not the PR's
        g(work, "push", "-q", "origin", "main")
        kit_remote, kit_work = os.path.join(d, "Dmitry-Wide", "studio-kit.git"), os.path.join(d, "k", "studio-kit")
        g(d, "clone", "-q", "--mirror", remote, kit_remote)
        g(d, "clone", "-q", kit_remote, kit_work)

        def call(n=5, name="mcp__github__merge_pull_request", at=None, **kw):
            head = at or prs[n]
            inp = dict(owner="o", repo="r", pullNumber=n, merge_method="merge", expectedHeadSha=head,
                       commit_message=f"Ревизор: ok · {head[:7]} · https://claude.ai/code/x")
            inp.update(kw)
            return json.dumps({"tool_name": name, "tool_input": {k: v for k, v in inp.items() if v is not None}})
        gate = [
            (work, call(), None),
            (work, call(name="mcp__claude_ai_GitHub__merge_pull_request"), None),
            (other, call(), None),  # the sibling ../r of the project dir
            (work, call(6), None),  # a kit copy: the hook equals kit@main
            (work, call(expectedHeadSha=None), "expectedHeadSha must be"),
            (work, call(merge_method="squash"), "merge_method must be"),
            (work, call(merge_method=None), "merge_method must be"),
            (work, call(commit_message="merge"), "lacks the verdict line"),
            (work, call(commit_message=f"Ревизор: ok · {prs[6][:7]}"), "lacks the verdict line"),
            (work, call(5, at=prs[6]), "The head moved"),
            (work, call(9, at="9" * 40), "git fetch of PR 9"),
            (other, call(repo="zzz"), "No clone of o/zzz"),
            (work, call(7), f"{hook_path} differs from kit@main"),
            (work, call(8), "is no kit copy"),
            (kit_work, call(6, owner="Dmitry-Wide", repo="studio-kit"), "in the kit every lock is Dmitry's"),
            (work, call(pullNumber="5; x"), "Name the PR"),
            (work, call(name="mcp__github__enable_pr_auto_merge"), AUTO),
            (work, '{"tool_name": "mcp__github__merge_pull_request", "tool_input": "x"}', "could not read this call"),
        ]
        for cwd, raw, want in gate:
            os.environ["CLAUDE_PROJECT_DIR"] = cwd
            DEADLINE = time.monotonic() + 7
            got = decide(raw)
            ok = got is None if want is None else got is not None and want in got
            print(("  ok    " if ok else "  FAIL  ") + f"gate {raw[:80]!r} -> {(got or 'allow')[:110]}")
            fail += not ok
    for k, v in saved.items():
        os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
    gh_api = real_gh_api

    # The real lookup, with a fake gh alone on PATH: every way GitHub may not answer is a refusal.
    pr_files, path = real_pr_files, os.environ.get("PATH", "")
    args = "api --paginate repos/o/r/pulls/1/files?per_page=100 --jq .[] | [.filename, .previous_filename]"
    with tempfile.TemporaryDirectory() as d:
        gh, os.environ["PATH"] = os.path.join(d, "gh"), d
        for body, want in [
            (f'[ "$*" = "{args}" ] || exit 3\necho \'["docs/a.md",null]\'; echo \'["b.md",".claude/hooks/x.py"]\'',
             (["docs/a.md", "b.md", ".claude/hooks/x.py"], None)),
            ("echo 'HTTP 404: Not Found' >&2; exit 1", (None, "HTTP 404: Not Found")),
            ("echo 'not json'", (None, "JSONDecodeError")),
            ("echo '{\"a\": 1}'", (None, "unexpected gh output")),
            ("i=0; while [ $i -lt 3000 ]; do echo '[\"f\",null]'; i=$((i+1)); done", (None, "3000 files or more")),
            ("exec /bin/sleep 5", (None, "TimeoutExpired")),
            (None, (None, "FileNotFoundError")),
        ]:
            if body is None:
                os.remove(gh)
            else:
                open(gh, "w").write("#!/bin/sh\n" + body + "\n")
                os.chmod(gh, 0o755)
            DEADLINE = time.monotonic() + 1.5
            got = pr_files("o", "r", "1")
            print(("  ok    " if got == want else "  FAIL  ") + f"gh {(body or 'missing')[:40]!r} -> {got}")
            fail += got != want
    os.environ["PATH"] = path
    # A long command must be decided well inside the 10 s hook timeout, or it fails open.
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
        call = json.loads(raw)
        name, args = str(call.get("tool_name") or ""), call.get("tool_input") or {}
        if MCP_AUTO.fullmatch(name):
            return AUTO
        if MCP_MERGE.fullmatch(name):
            return check_mcp_merge(args)
        cmd = args.get("command") or ""
        return verdict(cmd if isinstance(cmd, str) else json.dumps(cmd))
    except Exception as e:  # noqa: BLE001 - a crashed hook fails open: refuse what looks like a push
        if re.search(r"push|merge|rulesets", raw):
            return (f"guard-git-push.py could not read this call ({e!r}); refusing it: it mentions "
                    "push, merge or rulesets.")
        return None


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        sys.exit(selftest())
    why = decide(sys.stdin.read())
    if why:
        print(why, file=sys.stderr)
        sys.exit(2)  # exit 2 = block the tool call; stderr goes back to Claude
