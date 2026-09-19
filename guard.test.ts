/**
 * longhand — what the fence catches and what it lets through.
 *
 *   node --test --experimental-strip-types guard.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";
import { classify } from "./guard.ts";

const cases = {
	block: [
		// redirection, fd forms included
		"echo hi > out.txt",
		"echo hi >> out.txt",
		"make 2> build.log",
		"ls 2>> log.txt",
		"cmd &> out.txt",
		"cmd >& out.txt",
		'echo x > "out file.txt"',
		"cat > f <<EOF\nx\nEOF",
		// writers, however they are wrapped
		"rm x",
		"sudo -u bob rm x",
		"env A=1 rm x",
		"env -u FOO rm x",
		"timeout 10 rm x",
		"nice -n 5 rm x",
		"xargs -I {} rm {}",
		"find . -name '*.bak' | xargs rm",
		"for f in *.bak; do rm \"$f\"; done",
		"if true; then cp a b; fi",
		"(rm x)",
		"{ rm x; }",
		"echo $(rm x)",
		"echo `rm x`",
		'bash -c "rm x"',
		'bash -lc "echo x > f"',
		"sh -c 'git add .'",
		'eval "rm x"',
		"find . -exec rm {} \\;",
		"find . -name '*.tmp' -delete",
		"cat <<EOF\nIt's data\nEOF\nrm x",
		// in place
		"sed -i s/a/b/ f",
		"perl -pi -e 's/x/y/' f",
		// git, the half that mutates
		"git add f",
		"git commit -m 'list'",
		"git -C ../outro add f",
		"git -c user.name=x commit",
		"git stash",
		"git stash pop",
		"git tag v1",
		"git config user.name x",
		"git worktree add ../w",
	],
	ask: [
		"prettier --write .",
		"npx prettier --write .",
		"uvx ruff check --fix .",
		"npm install x",
		"cargo fmt",
		"go get x",
		"npm create vite@latest",
	],
	allow: [
		// free targets and fd duplication
		"ls > /tmp/x",
		"ls 2> /dev/null",
		"cmd 2>&1",
		"cmd >&2",
		"cmd > /dev/null 2>&1",
		// quoted text is text
		'echo "a > b"',
		"awk '$3 > 5' dados",
		"sed 's/>/x/' f",
		'grep ">" f',
		'grep ";" f',
		'git log --grep "rm -rf"',
		"echo a->b",
		// heredoc bodies are data
		"cat <<EOF\nmentions rm; uses > sign\nEOF",
		"python - <<'PY'\nprint(1 > 0)\nPY",
		'bash -c "awk \'$3 > 5\' f"',
		// lookups, builds, reads
		"command -v rm",
		"sudo -u bob ls",
		"FOO=bar ls",
		"diff <(sort a) <(sort b)",
		"git log --oneline",
		"git diff && git status",
		"git stash list",
		"git tag",
		"git tag -l 'v*'",
		"git config --get user.name",
		"git worktree list",
		"npm run build",
		"cargo build",
		"prettier --check .",
		"",
	],
	// Known gaps, kept here so closing one shows up as a failing test.
	gap: [
		'echo "$(rm x)"',
		"python -c \"open('f', 'w')\"",
		"npm run format",
	],
};

for (const [kind, commands] of Object.entries(cases)) {
	const expected = kind === "gap" ? "allow" : kind;
	for (const command of commands) {
		test(`${kind}: ${JSON.stringify(command)}`, () => {
			assert.equal(classify(command).kind, expected);
		});
	}
}
