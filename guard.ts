/**
 * longhand — bash command classification.
 *
 * The agent may investigate and execute: build, test, lint, read-only git.
 * It may not write into the project. /tmp and /dev/null stay free so that
 * pipelines and scratch work keep functioning.
 *
 * This is a fence, not a sandbox. `python -c "open('f','w').write(x)"` walks
 * straight through it. It exists to stop the slip, not the adversary.
 */

export type Verdict =
	| { kind: "allow" }
	| { kind: "block"; reason: string }
	| { kind: "ask"; reason: string };

const ALLOW: Verdict = { kind: "allow" };

/** Redirection targets that are not your project. */
const FREE_TARGET =
	/^(?:&\d*|&-|\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)|\/tmp\/\S*|\/var\/tmp\/\S*)$/;

/**
 * A `>` or `>>` that is not an fd duplication (`2>&1`), an arrow (`->`),
 * or a fat arrow (`=>`). Quoted `>` inside a string is a false positive;
 * blocking is the safe direction, and the agent can rephrase.
 */
const REDIRECT = /(?:^|[^<>&0-9=-])(&?>>?)\s*(\S*)/g;

/** Commands whose job is to put bytes into a file. */
const WRITERS: Record<string, string> = {
	tee: "tee writes to a file",
	dd: "dd writes to a file",
	sponge: "sponge writes to a file",
	truncate: "truncate rewrites a file",
	patch: "patch applies a diff to your files",
	install: "install copies files into place",
	shred: "shred destroys a file",
	rm: "rm deletes files",
	rmdir: "rmdir deletes directories",
	mv: "mv moves files",
	cp: "cp copies over files",
	ln: "ln creates links",
	rsync: "rsync writes files",
	chmod: "chmod changes file metadata",
	chown: "chown changes file ownership",
	chgrp: "chgrp changes file group",
	touch: "touch creates files",
	mkdir: "mkdir creates directories",
	ed: "ed edits files in place",
	ex: "ex edits files in place",
	vi: "editors edit files in place",
	vim: "editors edit files in place",
	nvim: "editors edit files in place",
	nano: "editors edit files in place",
	emacs: "editors edit files in place",
};

/** git subcommands that touch the working tree, the index, or history. */
const GIT_WRITE = new Set([
	"apply", "am", "commit", "add", "rm", "mv", "restore", "checkout", "switch",
	"reset", "revert", "stash", "clean", "merge", "rebase", "cherry-pick",
	"push", "pull", "init", "config", "tag",
]);

/** Tools that rewrite source as a side effect — worth one confirmation. */
const REWRITERS = /^(prettier|eslint|biome|black|ruff|isort|gofmt|goimports|rustfmt|clang-format|dprint|standard|autopep8|yapf)$/;
const PKG_MANAGERS = /^(npm|pnpm|yarn|bun|pip|pip3|poetry|uv|cargo|go|gem|composer|mise|brew|apt|pacman|yay)$/;
const PKG_WRITE_VERBS = /^(i|install|add|remove|rm|uninstall|update|upgrade|ci|link|sync|init|new|publish|fmt)$/;

/** Wrappers that delegate to the command after them. */
const PASSTHROUGH = /^(sudo|doas|env|command|nohup|time|nice|ionice|stdbuf|xargs|timeout)$/;

/** Split a command line into the pieces that each run a program. */
function segments(command: string): string[] {
	return command
		.split(/\n|;|\|\||&&|\||&(?!>)/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** First real program in a segment, with its arguments. */
function head(segment: string): { name: string; args: string[] } {
	const parts = segment.split(/\s+/).filter(Boolean);
	let i = 0;
	while (i < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[i])) i++;
	while (i < parts.length && PASSTHROUGH.test(parts[i])) i++;
	const raw = parts[i] ?? "";
	return { name: raw.replace(/^.*\//, ""), args: parts.slice(i + 1) };
}

function hasInPlaceFlag(args: string[]): boolean {
	return args.some((a) => a === "-i" || a === "--in-place" || /^-i\S/.test(a) || /^-[a-zA-Z]*i$/.test(a) && a.length <= 4);
}

/** Classify one bash invocation. */
export function classify(command: string): Verdict {
	// 1. Redirection into anything that is not /dev/null, /tmp, or an fd.
	for (const match of command.matchAll(REDIRECT)) {
		const target = (match[2] ?? "").replace(/[;)]+$/, "");
		if (target === "" || FREE_TARGET.test(target)) continue;
		return {
			kind: "block",
			reason: `redirection writes to ${target}`,
		};
	}

	for (const segment of segments(command)) {
		const { name, args } = head(segment);
		if (!name) continue;

		// 2. Named writers.
		const why = WRITERS[name];
		if (why) return { kind: "block", reason: why };

		// 3. Stream editors invoked in place.
		if (/^(sed|perl|ruby|gawk|awk)$/.test(name) && hasInPlaceFlag(args)) {
			return { kind: "block", reason: `${name} -i rewrites the file in place` };
		}

		// 4. git, but only the half that mutates.
		if (name === "git") {
			const sub = args.find((a) => !a.startsWith("-"));
			if (sub && GIT_WRITE.has(sub)) {
				return { kind: "block", reason: `git ${sub} changes your repository` };
			}
		}

		// 5. Formatters and package managers: real work, but they rewrite files.
		if (REWRITERS.test(name) && args.some((a) => /^(-w|--write|--fix|-i)$/.test(a))) {
			return { kind: "ask", reason: `${name} will rewrite files in place` };
		}
		if (PKG_MANAGERS.test(name)) {
			const sub = args.find((a) => !a.startsWith("-"));
			if (sub && PKG_WRITE_VERBS.test(sub)) {
				return { kind: "ask", reason: `${name} ${sub} changes your dependencies` };
			}
		}
	}

	return ALLOW;
}
