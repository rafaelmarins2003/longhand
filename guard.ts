/**
 * longhand — bash command classification.
 *
 * The agent may investigate and execute: build, test, lint, read-only git.
 * It may not write into the project. /tmp and /dev/null stay free so that
 * pipelines and scratch work keep functioning.
 *
 * This is a fence, not a sandbox. `python -c "open('f','w').write(x)"` walks
 * straight through it, and so does `$(...)` inside double quotes. It exists
 * to stop the slip, not the adversary.
 */

export type Verdict =
	| { kind: "allow" }
	| { kind: "block"; reason: string }
	| { kind: "ask"; reason: string };

const ALLOW: Verdict = { kind: "allow" };

/** Redirection targets that are not your project. */
const FREE_TARGET = /^(?:\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)|\/tmp\/\S*|\/var\/tmp\/\S*)$/;

/**
 * A `>` or `>>`, with or without an fd in front (`2> log`), that is not an
 * arrow (`->`, `=>`). Group 2 marks `>&`, which is a duplication when the
 * target is an fd (`2>&1`) and a write when it is a name. Runs on the masked
 * command, so quoted `>` never matches.
 */
const REDIRECT = /(?:^|[^<>&=-])(&?>>?)(&?)\s*(\S*)/g;

/** Where the shell starts another program. `(` and backticks included. */
const SEPARATOR = /\n|;|\|\||&&|\||&(?!>)|[()`]/g;

/** Commands whose job is to put bytes into a file. */
const WRITERS = new Map([
	["tee", "tee writes to a file"],
	["dd", "dd writes to a file"],
	["sponge", "sponge writes to a file"],
	["truncate", "truncate rewrites a file"],
	["patch", "patch applies a diff to your files"],
	["install", "install copies files into place"],
	["shred", "shred destroys a file"],
	["rm", "rm deletes files"],
	["rmdir", "rmdir deletes directories"],
	["mv", "mv moves files"],
	["cp", "cp copies over files"],
	["ln", "ln creates links"],
	["rsync", "rsync writes files"],
	["chmod", "chmod changes file metadata"],
	["chown", "chown changes file ownership"],
	["chgrp", "chgrp changes file group"],
	["touch", "touch creates files"],
	["mkdir", "mkdir creates directories"],
	["ed", "ed edits files in place"],
	["ex", "ex edits files in place"],
	["vi", "editors edit files in place"],
	["vim", "editors edit files in place"],
	["nvim", "editors edit files in place"],
	["nano", "editors edit files in place"],
	["emacs", "editors edit files in place"],
]);

/** git subcommands that touch the working tree, the index, or history. */
const GIT_WRITE = new Set([
	"apply", "am", "commit", "add", "rm", "mv", "restore", "checkout", "switch",
	"reset", "revert", "stash", "clean", "merge", "rebase", "cherry-pick",
	"push", "pull", "init", "config", "tag", "worktree",
]);

/** git options that take the next word, before the subcommand (`git -C dir add`). */
const GIT_VALUED = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/** Writing subcommands asked only to read: `git stash list`, `git config --get`. */
const GIT_READS = new Map([
	["stash", /^(list|show)$/],
	["tag", /^(-l|--list)$/],
	["config", /^(-l|--list|--get|--get-all|--get-regexp)$/],
	["worktree", /^list$/],
]);

/** Tools that rewrite source as a side effect — worth one confirmation. */
const REWRITERS = /^(prettier|eslint|biome|black|ruff|isort|gofmt|goimports|rustfmt|clang-format|dprint|standard|autopep8|yapf)$/;
const PKG_MANAGERS = /^(npm|pnpm|yarn|bun|pip|pip3|poetry|uv|cargo|go|gem|composer|mise|brew|apt|pacman|yay)$/;
const PKG_WRITE_VERBS = /^(i|install|add|remove|rm|uninstall|update|upgrade|ci|link|sync|init|new|publish|fmt|get|create)$/;

/** Wrappers that run the command after them, with the options that take a value. */
const WRAPPERS = new Map<string, string[]>([
	["sudo", ["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U"]],
	["doas", ["-u", "-C"]],
	["env", ["-u", "-C", "-S"]],
	["command", []],
	["exec", ["-a"]],
	["nohup", []],
	["time", ["-f", "-o"]],
	["nice", ["-n"]],
	["ionice", ["-c", "-n", "-p"]],
	["stdbuf", ["-i", "-o", "-e"]],
	["timeout", ["-k", "-s"]],
	["xargs", ["-a", "-d", "-E", "-I", "-L", "-n", "-P", "-s"]],
	["npx", ["-p", "--package"]],
	["bunx", ["-p", "--package"]],
	["uvx", ["--from", "--with"]],
]);

/** Words that open a construct; the program is the word after them. */
const LEADERS = /^(if|then|else|elif|while|until|do|!|\{)$/;

const SHELLS = /^(bash|sh|zsh|dash|ksh|fish)$/;

/**
 * Blank out what the shell reads as data — quoted strings and heredoc
 * bodies — so `awk '$3 > 5'` stops looking like a redirect and `grep ";"`
 * like two commands. Same length as the input, so a position in one is a
 * position in the other.
 */
function mask(command: string): string {
	const out = command.split("");
	const blank = (from: number, to: number) => {
		for (let k = from; k < to && k < out.length; k++) out[k] = "_";
	};
	let quote = "";
	let heredocs: string[] = [];
	for (let i = 0; i < command.length; i++) {
		const c = command[i];
		if (c === "\\" && quote !== "'") {
			// An escaped character is literal, inside double quotes or out.
			blank(i, i + 2);
			i++;
		} else if (quote) {
			if (c === quote) quote = "";
			else blank(i, i + 1);
		} else if (c === "'" || c === '"') {
			quote = c;
		} else if (c === "<" && command[i + 1] === "<" && command[i + 2] !== "<" && command[i - 1] !== "<") {
			const word = /^<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(command.slice(i));
			if (word) heredocs.push(word[2]);
		} else if (c === "\n" && heredocs.length > 0) {
			// The bodies start on the next line, one after the other.
			let end = i + 1;
			for (const word of heredocs) end = heredocEnd(command, end, word);
			blank(i + 1, end);
			heredocs = [];
			i = end - 1;
		}
	}
	return out.join("");
}

/** Index of the newline after the line that closes a heredoc (or the end). */
function heredocEnd(command: string, from: number, word: string): number {
	let line = from;
	while (line < command.length) {
		const eol = command.indexOf("\n", line);
		const stop = eol === -1 ? command.length : eol;
		if (command.slice(line, stop).trim() === word) return stop;
		line = stop + 1;
	}
	return command.length;
}

/** A word as the program receives it: syntax quotes gone, quoted quotes kept. */
function unquote(word: string): string {
	let out = "";
	let quote = "";
	for (let i = 0; i < word.length; i++) {
		const c = word[i];
		if (c === "\\" && (quote === "" || (quote === '"' && /[$`"\\\n]/.test(word[i + 1] ?? "")))) {
			out += word[++i] ?? "";
		} else if (quote ? c === quote : c === "'" || c === '"') {
			quote = quote ? "" : c;
		} else {
			out += c;
		}
	}
	return out;
}

/** Each program's words: split where the mask has blanks, read from the original. */
function segments(command: string, masked: string): string[][] {
	const out: string[][] = [];
	let from = 0;
	for (const sep of [...masked.matchAll(SEPARATOR), null]) {
		const to = sep?.index ?? masked.length;
		const words: string[] = [];
		for (const m of masked.slice(from, to).matchAll(/\S+/g)) {
			const at = from + m.index;
			words.push(unquote(command.slice(at, at + m[0].length)));
		}
		if (words.length > 0) out.push(words);
		if (sep) from = sep.index + sep[0].length;
	}
	return out;
}

/** First real program in a segment, past assignments, wrappers and their options. */
function head(words: string[]): { name: string; args: string[] } {
	let i = 0;
	while (i < words.length) {
		const w = words[i];
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || LEADERS.test(w)) {
			i++;
			continue;
		}
		const valued = WRAPPERS.get(w);
		// `command -v rm` is a lookup, not a run.
		if (!valued || (w === "command" && words[i + 1]?.startsWith("-"))) break;
		i++;
		while (words[i]?.startsWith("-")) i += valued.includes(words[i]) ? 2 : 1;
		if (w === "timeout") i++; // the duration
	}
	const raw = words[i] ?? "";
	return { name: raw.replace(/^.*\//, ""), args: words.slice(i + 1) };
}

function hasInPlaceFlag(args: string[]): boolean {
	return args.some((a) => a === "-i" || a === "--in-place" || /^-i\S/.test(a) || /^-[a-zA-Z]*i$/.test(a) && a.length <= 4);
}

/** The git subcommand, if it writes. */
function gitWrite(args: string[]): string | undefined {
	let i = 0;
	while (args[i]?.startsWith("-")) i += GIT_VALUED.has(args[i]) ? 2 : 1;
	const sub = args[i];
	if (sub === undefined || !GIT_WRITE.has(sub)) return undefined;
	const next = args[i + 1];
	if (next === undefined) return sub === "tag" ? undefined : sub;
	return GIT_READS.get(sub)?.test(next) ? undefined : sub;
}

/** The command line another command runs for you: `sh -c`, `eval`, `find -exec`. */
function innerCommand(name: string, args: string[]): string | undefined {
	if (SHELLS.test(name)) {
		const flag = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
		return flag === -1 ? undefined : args[flag + 1];
	}
	if (name === "eval") return args.join(" ");
	if (name === "find") {
		const exec = args.findIndex((a) => /^-(exec|execdir|ok|okdir)$/.test(a));
		return exec === -1 ? undefined : args.slice(exec + 1).join(" ");
	}
	return undefined;
}

/** Classify one bash invocation. */
export function classify(command: string): Verdict {
	const masked = mask(command);

	// 1. Redirection into anything that is not /dev/null, /tmp, or an fd.
	for (const match of masked.matchAll(REDIRECT)) {
		const at = match.index + match[0].length - match[3].length;
		const target = unquote(command.slice(at, at + match[3].length)).replace(/[;)]+$/, "");
		if (target === "" || FREE_TARGET.test(target)) continue;
		if (match[2] && /^(\d+|-)$/.test(target)) continue; // 2>&1, >&-
		return { kind: "block", reason: `redirection writes to ${target}` };
	}

	for (const words of segments(command, masked)) {
		const { name, args } = head(words);
		if (!name) continue;

		// 2. Named writers.
		const why = WRITERS.get(name);
		if (why) return { kind: "block", reason: why };
		if (name === "find" && args.includes("-delete")) {
			return { kind: "block", reason: "find -delete deletes files" };
		}

		// 3. Stream editors invoked in place.
		if (/^(sed|perl|ruby|gawk|awk)$/.test(name) && hasInPlaceFlag(args)) {
			return { kind: "block", reason: `${name} -i rewrites the file in place` };
		}

		// 4. git, but only the half that mutates.
		if (name === "git") {
			const sub = gitWrite(args);
			if (sub) return { kind: "block", reason: `git ${sub} changes your repository` };
		}

		// 5. A command handed to another one to run: judge the inner one.
		const inner = innerCommand(name, args);
		if (inner !== undefined) {
			const verdict = classify(inner);
			if (verdict.kind !== "allow") return verdict;
		}

		// 6. Formatters and package managers: real work, but they rewrite files.
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
