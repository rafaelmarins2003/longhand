/** A short-lived, local page for a change the user will apply. */

import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

export interface Delivery {
	title: string;
	diagnosis: string;
	path: string;
	location: string;
	code: string;
	verification: string;
}

type Feedback = { kind: "understood" | "adjust"; comment: string; title: string };

const MAX_BODY = 8_192;
const MAX_PAGES = 20;

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => ({
		"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
	})[c] ?? c);
}

function page(item: Delivery): string {
	const title = escapeHtml(item.title);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · longhand</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.5; }
body { max-width: 860px; margin: 0 auto; padding: 2rem 1.25rem 5rem; }
header { border-bottom: 1px solid #8885; margin-bottom: 2rem; }
.brand, .muted { color: #777; }
.brand { font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
section { margin: 2rem 0; }
h1 { line-height: 1.15; }
h2 { font-size: 1.15rem; }
p { white-space: pre-wrap; }
.location { padding: 1rem; background: #8882; border-radius: .5rem; }
.location strong { display: block; overflow-wrap: anywhere; }
.code-head { display: flex; justify-content: space-between; gap: 1rem; align-items: center; }
pre { overflow-x: auto; padding: 1.25rem; border-radius: .5rem; background: #111; color: #f4f4f4; tab-size: 4; }
button { cursor: pointer; padding: .55rem .9rem; border: 1px solid #8888; border-radius: .4rem; background: #8882; color: inherit; }
button:hover { background: #8884; }
.actions { display: flex; flex-wrap: wrap; gap: .6rem; margin-top: 1rem; }
textarea { display: block; box-sizing: border-box; width: 100%; min-height: 6rem; padding: .7rem; font: inherit; }
#status { min-height: 1.5rem; }
</style>
</head>
<body>
<header><span class="brand">✍ longhand</span><h1>${title}</h1><p class="muted">A proposal for you to apply. This page has not modified any files.</p></header>
<main>
<section><h2>What is happening and why</h2><p>${escapeHtml(item.diagnosis)}</p></section>
<section><h2>Where to change it</h2><div class="location"><strong>${escapeHtml(item.path)}</strong><span>${escapeHtml(item.location)}</span></div></section>
<section><div class="code-head"><h2>Code to paste</h2><button id="copy" type="button">Copy code</button></div><pre><code id="code">${escapeHtml(item.code)}</code></pre></section>
<section><h2>How to verify</h2><p>${escapeHtml(item.verification)}</p></section>
<section><h2>Feedback</h2><p>Confirm that the proposal makes sense or request a change. Your feedback will appear in the Pi conversation.</p><label for="comment">Comment (optional)</label><textarea id="comment" placeholder="What would you like to change or clarify?"></textarea><div class="actions"><button data-kind="understood" type="button">Makes sense</button><button data-kind="adjust" type="button">Request a change</button></div><p id="status" role="status" aria-live="polite"></p></section>
</main>
<script>
const status = document.getElementById('status');
document.getElementById('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(document.getElementById('code').textContent); status.textContent = 'Code copied.'; }
  catch { status.textContent = 'Could not copy automatically. Select the code block instead.'; }
});
for (const button of document.querySelectorAll('[data-kind]')) button.addEventListener('click', async () => {
  const comment = document.getElementById('comment').value.trim();
  if (button.dataset.kind === 'adjust' && !comment) { status.textContent = 'Describe the change you want.'; return; }
  button.disabled = true;
  try {
    const response = await fetch(location.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: button.dataset.kind, comment }) });
    if (!response.ok) throw new Error();
    status.textContent = 'Feedback sent to Pi.';
  } catch { status.textContent = 'Could not send feedback. Check that the Pi session is still open.'; }
  finally { button.disabled = false; }
});
</script>
</body>
</html>`;
}

export class DeliveryServer {
	private server: Server | undefined;
	private pages = new Map<string, Delivery>();
	private readonly onFeedback: (feedback: Feedback) => void;

	constructor(onFeedback: (feedback: Feedback) => void) {
		this.onFeedback = onFeedback;
	}

	async publish(item: Delivery): Promise<string> {
		if (!this.server) {
			const server = createServer(async (req, res) => {
				const url = new URL(req.url ?? "/", "http://localhost");
				const token = url.searchParams.get("session") ?? "";
				const entry = this.pages.get(token);
				res.setHeader("Cache-Control", "no-store");
				res.setHeader("X-Content-Type-Options", "nosniff");
				if (url.pathname !== "/" || !entry) {
					res.writeHead(404).end("Page unavailable");
					return;
				}
				if (req.method === "GET") {
					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'" }).end(page(entry));
					return;
				}
				if (req.method !== "POST") {
					res.writeHead(405).end();
					return;
				}
				if (req.headers.origin && req.headers.origin !== `http://localhost:${(server.address() as AddressInfo).port}` && req.headers.origin !== `http://127.0.0.1:${(server.address() as AddressInfo).port}`) {
					res.writeHead(403).end();
					return;
				}
				let body = "";
				for await (const chunk of req) {
					body += chunk;
					if (body.length > MAX_BODY) { res.writeHead(413).end(); return; }
				}
				try {
					const input = JSON.parse(body);
					if ((input.kind !== "understood" && input.kind !== "adjust") || typeof input.comment !== "string" || input.comment.length > 4_000 || (input.kind === "adjust" && !input.comment.trim())) throw new Error();
					this.onFeedback({ kind: input.kind, comment: input.comment.trim(), title: entry.title });
					res.writeHead(204).end();
				} catch {
					res.writeHead(400).end("Invalid feedback");
				}
			});
			try {
				await new Promise<void>((resolve, reject) => {
					server.once("error", reject);
					server.listen(0, "127.0.0.1", resolve);
				});
				this.server = server;
			} catch (err) {
				server.close();
				throw err;
			}
		}
		const token = randomBytes(24).toString("hex");
		this.pages.set(token, item);
		if (this.pages.size > MAX_PAGES) this.pages.delete(this.pages.keys().next().value!);
		return `http://localhost:${(this.server.address() as AddressInfo).port}/?session=${token}`;
	}

	async close(): Promise<void> {
		this.pages.clear();
		const server = this.server;
		this.server = undefined;
		if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}
