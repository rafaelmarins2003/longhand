import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryServer } from "./delivery.ts";

test("publishes a local page with escaped code and forwards feedback", async () => {
	const feedback: unknown[] = [];
	const server = new DeliveryServer((value) => feedback.push(value));
	const item = {
		title: "Fix <error>",
		diagnosis: "The return value is wrong.",
		path: "src/app.ts",
		location: "Replace the run function.",
		code: "const example = '</script><script>alert(1)</script>';",
		verification: "npm test",
	};
	let url = "";
	try {
		url = await server.publish(item);
		assert.match(url, /^http:\/\/localhost:\d+\/\?session=[a-f0-9]{48}$/);
		const response = await fetch(url);
		assert.equal(response.status, 200);
		const html = await response.text();
		assert.match(html, /Fix &lt;error&gt;/);
		assert.match(html, /&lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
		assert.match(html, /Copy code/);
		assert.equal((await fetch(url.replace(/session=.+$/, "session=wrong"))).status, 404);

		const posted = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: new URL(url).origin },
			body: JSON.stringify({ kind: "adjust", comment: "Explain the condition." }),
		});
		assert.equal(posted.status, 204);
		assert.deepEqual(feedback, [{ kind: "adjust", comment: "Explain the condition.", title: item.title }]);
		assert.equal((await fetch(url, {
			method: "POST",
			headers: { Origin: "http://example.com" },
			body: JSON.stringify({ kind: "understood", comment: "" }),
		})).status, 403);
	} finally {
		await server.close();
	}
	await assert.rejects(fetch(url));
});
