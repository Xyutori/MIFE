import { describe, expect, test } from "bun:test";

import { getClientIp, isBot, visitorKey } from "./visitor";

describe("getClientIp", () => {
	test("X-Forwarded-For pertama menang", () => {
		const headers = new Headers({
			"x-forwarded-for": "203.0.113.7, 70.41.3.18",
			"x-real-ip": "198.51.100.9",
		});
		expect(getClientIp(headers, "192.0.2.1")).toBe("203.0.113.7");
	});

	test("fallback ke X-Real-IP lalu socket", () => {
		expect(getClientIp(new Headers({ "x-real-ip": "198.51.100.9" }))).toBe(
			"198.51.100.9",
		);
		expect(getClientIp(new Headers(), "192.0.2.44")).toBe("192.0.2.44");
	});

	test("strip port IPv4 dan braket IPv6", () => {
		expect(
			getClientIp(new Headers({ "x-forwarded-for": "203.0.113.7:5678" })),
		).toBe("203.0.113.7");
		expect(getClientIp(new Headers(), "[::1]:3000")).toBe("::1");
		expect(getClientIp(new Headers(), "2001:db8::1")).toBe("2001:db8::1");
	});

	test("header tak valid -> unknown", () => {
		expect(getClientIp(new Headers())).toBe("unknown");
		expect(getClientIp(new Headers({ "x-forwarded-for": "not-an-ip" }))).toBe(
			"unknown",
		);
	});
});

describe("visitorKey", () => {
	const monday = new Date("2026-11-02T00:00:00.000Z");
	const tuesday = new Date("2026-11-03T00:00:00.000Z");

	test("deterministik per hari & beda antar hari", () => {
		const input = { ip: "203.0.113.7", ua: "Mozilla/5.0", secret: "s3cret" };
		const a = visitorKey({ ...input, now: monday });
		const b = visitorKey({ ...input, now: new Date("2026-11-02T23:59:59Z") });
		const c = visitorKey({ ...input, now: tuesday });
		expect(a).toBe(b);
		expect(a).not.toBe(c);
		expect(a).toMatch(/^a:[0-9a-f]{12}$/);
	});

	test("userId menang atas IP/UA", () => {
		const withUser = visitorKey({
			userId: "user-123",
			ip: "1.1.1.1",
			ua: "A",
			now: monday,
			secret: "s3cret",
		});
		const otherIp = visitorKey({
			userId: "user-123",
			ip: "9.9.9.9",
			ua: "B",
			now: tuesday,
			secret: "other",
		});
		expect(withUser).toBe("u:user-123");
		expect(otherIp).toBe("u:user-123");
	});
});

describe("isBot", () => {
	test("true untuk crawler & tool", () => {
		for (const ua of [
			"Mozilla/5.0 (compatible; Googlebot/2.1)",
			"curl/8.5.0",
			"Wget/1.21",
			"python-requests/2.31",
			"Scrapy/2.11 (+https://scrapy.org)",
			"HeadlessChrome/120.0",
			"Mediapartners-Google",
			"bingbot/2.0",
			"Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
		]) {
			expect(isBot(ua)).toBe(true);
		}
	});

	test("false untuk browser biasa & kosong", () => {
		expect(
			isBot(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
			),
		).toBe(false);
		expect(isBot("")).toBe(false);
	});
});
