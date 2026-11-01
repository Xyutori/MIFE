import { AsyncLocalStorage } from "node:async_hooks";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import {
	clearRetryNotice,
	RunStoppedError,
	registerRunRequest,
	reportNetworkRetry,
	waitForRunResume,
} from "../jobs/control";
import { hasRetryBudget, maxRetriesFor } from "./retry";
import type { SourceConfig } from "./types";

const IMAGE_REQUEST_CONCURRENCY = 8;
type SourceRetryBudget = { retriesUsed: number; maxRetries: number };
const sourceRetryBudgets = new AsyncLocalStorage<
	Map<string, SourceRetryBudget>
>();
const gates = new Map<
	string,
	{
		nextAt: number;
		tail: Promise<void>;
		activeImages: number;
		imageWaiters: Array<() => void>;
	}
>();

function getGate(source: SourceConfig, lane: "api" | "image") {
	const key = `${source.id}:${lane}`;
	let gate = gates.get(key);
	if (!gate) {
		gate = {
			nextAt: 0,
			tail: Promise.resolve(),
			activeImages: 0,
			imageWaiters: [],
		};
		gates.set(key, gate);
	}
	return gate;
}

async function waitForRequestSlot(
	source: SourceConfig,
	lane: "api" | "image",
	intervalMs?: number,
) {
	const gate = getGate(source, lane);
	if (lane === "image") {
		let reservedSlot = false;
		if (gate.activeImages >= IMAGE_REQUEST_CONCURRENCY) {
			await new Promise<void>((resolve) =>
				gate.imageWaiters.push(() => {
					reservedSlot = true;
					resolve();
				}),
			);
		}
		if (!reservedSlot) gate.activeImages += 1;

		let releaseStart!: () => void;
		const previous = gate.tail;
		gate.tail = new Promise<void>((resolve) => {
			releaseStart = resolve;
		});
		await previous;
		const delay = Math.max(0, gate.nextAt - Date.now());
		if (delay > 0) await Bun.sleep(delay);
		gate.nextAt = Date.now() + Math.max(25, intervalMs ?? 25);
		releaseStart();
		return () => {
			const nextWaiter = gate.imageWaiters.shift();
			if (nextWaiter) nextWaiter();
			else gate.activeImages = Math.max(0, gate.activeImages - 1);
		};
	}

	let release!: () => void;
	const previous = gate.tail;
	gate.tail = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previous;
	const delay = Math.max(0, gate.nextAt - Date.now());
	if (delay > 0) await Bun.sleep(delay);

	return () => {
		gate.nextAt =
			Date.now() + Math.max(250, intervalMs ?? source.requestDelayMs);
		release();
	};
}

export function sourceUrl(
	source: SourceConfig,
	path: string,
	query?: URLSearchParams,
) {
	const base = new URL(source.baseUrl);
	const basePath = base.pathname.replace(/^\/+|\/+$/g, "");
	const prefix = source.prefix.trim().replace(/^\/+|\/+$/g, "");
	const endpointUrl = new URL(path, `${base.origin}/`);
	const endpoint = endpointUrl.pathname.replace(/^\/+/, "");
	const configuredPath = [basePath, prefix].filter(Boolean).join("/");
	const normalizedEndpoint =
		endpoint === configuredPath ||
		(configuredPath && endpoint.startsWith(`${configuredPath}/`))
			? endpoint.slice(configuredPath.length).replace(/^\/+/, "")
			: endpoint;
	const url = new URL(
		[configuredPath, normalizedEndpoint].filter(Boolean).join("/"),
		`${base.origin}/`,
	);
	url.search = query?.toString() ?? endpointUrl.search;
	return url;
}

export class SourceResponseValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SourceResponseValidationError";
	}
}

export class SourceHttpError extends Error {
	constructor(
		readonly status: number,
		sourceKey: string,
	) {
		super(`Source ${sourceKey} returned HTTP ${status}`);
		this.name = "SourceHttpError";
	}
}

function contentTypeMatches(accept: string, contentType: string) {
	const actual = contentType.split(";")[0]?.trim().toLowerCase();
	if (!actual) return false;
	return accept
		.split(",")
		.map((value) => value.split(";")[0]?.trim().toLowerCase())
		.filter(Boolean)
		.some((expected) => {
			if (expected === "*/*") return true;
			if (expected?.endsWith("/*"))
				return actual.startsWith(expected.slice(0, -1));
			return expected === actual;
		});
}

export async function readSourceText(response: Response, sourceName: string) {
	const text = await response.text();
	if (!text.trim())
		throw new SourceResponseValidationError(
			`${sourceName} mengembalikan respons kosong`,
		);
	return text;
}

export async function readSourceJson<T>(
	response: Response,
	sourceName: string,
) {
	const text = await readSourceText(response, sourceName);
	try {
		return JSON.parse(text) as T;
	} catch (error) {
		if (
			error instanceof SyntaxError &&
			/unexpected (?:end|eof)|unexpected eof|unterminated|incomplete json|end of json/i.test(
				error.message,
			)
		)
			throw error;
		if (error instanceof SyntaxError)
			throw new SourceResponseValidationError(
				`${sourceName} mengembalikan JSON tidak valid`,
			);
		throw error;
	}
}

function isCertificateValidationError(error: Error, depth = 0): boolean {
	const details = error as Error & { code?: string; cause?: unknown };
	const description = [error.name, error.message, details.code]
		.filter(Boolean)
		.join(" ");
	if (
		/ERR_TLS_CERT_ALTNAME_INVALID|ERR_TLS_CERT_VERIFY_FAILED|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|CERT_SIGNATURE_FAILURE|certificate verification|certificate verify failed|unable to verify (?:the )?(?:first )?certificate|self.signed certificate|certificate has expired|hostname\/ip does not match/i.test(
			description,
		)
	)
		return true;
	return (
		depth < 3 &&
		details.cause instanceof Error &&
		isCertificateValidationError(details.cause, depth + 1)
	);
}

const CERTIFICATE_VALIDATION_CODES = new Set([
	"ERR_TLS_CERT_ALTNAME_INVALID",
	"ERR_TLS_CERT_VERIFY_FAILED",
	"CERT_HAS_EXPIRED",
	"CERT_NOT_YET_VALID",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"SELF_SIGNED_CERT_IN_CHAIN",
	"CERT_SIGNATURE_FAILURE",
]);

function certificateValidationCode(error: unknown, depth = 0): string | null {
	if (!(error instanceof Error) || depth > 3) return null;
	const details = error as Error & { code?: unknown; cause?: unknown };
	if (
		typeof details.code === "string" &&
		CERTIFICATE_VALIDATION_CODES.has(details.code)
	)
		return details.code;
	const description = `${error.name} ${error.message}`;
	const matchedCode = [...CERTIFICATE_VALIDATION_CODES].find((code) =>
		description.includes(code),
	);
	if (matchedCode) return matchedCode;
	return certificateValidationCode(details.cause, depth + 1);
}

/**
 * Summarize source and media errors without persisting nested TLS messages,
 * signed URLs, or credentials. Certificate details are limited to known codes.
 */
export function safeSourceErrorMessage(
	error: unknown,
	fallback = "Kesalahan sumber tidak diketahui",
): string {
	if (error instanceof Error && isCertificateValidationError(error)) {
		const code = certificateValidationCode(error);
		return code
			? `certificate verification failed (${code})`
			: "certificate verification failed";
	}
	if (!(error instanceof Error)) return fallback;
	return error.message
		.replace(/https?:\/\/\S+/gi, "[source URL]")
		.replace(
			/\b(authorization|proxy-authorization|cookie|set-cookie|token|access_token|refresh_token|api[_-]?key|password|passwd|secret)\b\s*[:=]\s*(?:(?:bearer|basic)\s+)?("[^"]*"|'[^']*'|[^\s,;]+)/gi,
			"$1=[redacted]",
		)
		.slice(0, 800);
}

export function isRetryableNetworkError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	if (error.name === "RunCancelledError" || error.name === "RunStoppedError")
		return false;
	// Certificate trust/hostname failures are configuration/source errors, not
	// transient transport failures. Never retry them as generic `fetch failed`.
	if (isCertificateValidationError(error)) return false;
	if (error.name === "SyntaxError")
		return /unexpected (?:end|eof)|unexpected eof|unterminated|incomplete json|end of json/i.test(
			error.message,
		);
	// HTTP retryable yang dilempar fetchSource mode nested (tanpa budget
	// sendiri) harus dikenali agar wrapper luar bisa me-retry-nya.
	if (error instanceof SourceHttpError)
		return (
			error.status === 408 ||
			error.status === 425 ||
			error.status === 429 ||
			error.status >= 500
		);
	const serviceError = error as Error & {
		$metadata?: { httpStatusCode?: number };
		code?: string;
		cause?: unknown;
	};
	const status = serviceError.$metadata?.httpStatusCode;
	if (status === 429 || (status !== undefined && status >= 500)) return true;
	if (
		serviceError.code &&
		/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|UND_ERR/i.test(
			serviceError.code,
		)
	)
		return true;
	if (error.name === "TimeoutError" || error.name === "AbortError") return true;
	if (
		/fetch failed|network|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|UND_ERR|terminated|connection reset/i.test(
			error.message,
		)
	)
		return true;
	return Boolean(
		serviceError.cause &&
			serviceError.cause !== error &&
			isRetryableNetworkError(serviceError.cause),
	);
}

function retryDelay(attempt: number, retryAfter?: string | null) {
	const seconds = retryAfter?.trim() ? Number(retryAfter) : Number.NaN;
	if (Number.isFinite(seconds) && seconds >= 0)
		return Math.min(seconds * 1_000, 60_000);
	const retryAt = retryAfter ? Date.parse(retryAfter) : Number.NaN;
	if (Number.isFinite(retryAt))
		return Math.min(Math.max(0, retryAt - Date.now()), 60_000);
	return Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));
}

async function waitForRetry(
	source: SourceConfig,
	attempt: number,
	delayMs: number,
	error?: unknown,
) {
	if (source.runId) {
		await waitForRunResume(source.runId, source.workerToken);
		try {
			await reportNetworkRetry(
				source.runId,
				source.name,
				attempt,
				delayMs,
				maxRetriesFor(source),
				error ? networkErrorDetails(error) : undefined,
			);
		} catch (reportError) {
			// Pelaporan progres tidak boleh menggagalkan retry, tapi error DB
			// tidak boleh ditelan diam-diam (bug #6): catat via console.
			console.warn("Network retry progress report failed", {
				runId: source.runId,
				source: source.name,
				error: safeSourceErrorMessage(reportError).slice(0, 500),
			});
		}
		const deadline = Date.now() + delayMs;
		while (Date.now() < deadline) {
			await waitForRunResume(source.runId, source.workerToken);
			await Bun.sleep(Math.min(1_000, deadline - Date.now()));
		}
		return;
	}
	await Bun.sleep(delayMs);
}

function networkErrorDetails(error: unknown, depth = 0): string {
	if (!(error instanceof Error)) return "unknown error";
	if (isCertificateValidationError(error)) return safeSourceErrorMessage(error);
	const details = error as Error & {
		$metadata?: { httpStatusCode?: number };
		code?: string;
		cause?: unknown;
	};
	const parts = [
		`${details.name || "Error"}${error.message.trim() ? `: ${safeSourceErrorMessage(error).trim()}` : ""}`,
	];
	if (
		typeof details.code === "string" &&
		(CERTIFICATE_VALIDATION_CODES.has(details.code) ||
			/^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|UND_ERR_[A-Z0-9_]+)$/.test(
				details.code,
			))
	)
		parts.push(`code ${details.code}`);
	if (details.$metadata?.httpStatusCode)
		parts.push(`HTTP ${details.$metadata.httpStatusCode}`);
	if (depth < 2 && details.cause && details.cause !== error) {
		const cause = networkErrorDetails(details.cause, depth + 1);
		if (cause) parts.push(`caused by ${cause}`);
	}
	return parts.join(" · ").slice(0, 800);
}

class SourceRetryLimitError extends Error {
	constructor(source: SourceConfig, error: unknown, retries: number) {
		const reason = networkErrorDetails(error);
		super(
			`${source.name} gagal setelah ${retries + 1} percobaan jaringan: ${reason}`,
			{ cause: error },
		);
		this.name = "SourceRetryLimitError";
	}
}

function controlledResponse(
	response: Response,
	request: ReturnType<typeof registerRunRequest> | undefined,
	onDone: (() => void) | undefined,
	maxBytes: number,
) {
	if (!response.body) {
		request?.release();
		onDone?.();
		return response;
	}

	const reader = response.body.getReader();
	let released = false;
	let abortReason: unknown;
	let bytesRead = 0;
	const release = () => {
		if (released) return;
		released = true;
		request?.release();
		onDone?.();
	};
	if (request) {
		const controller = request.controller;
		controller.signal.addEventListener(
			"abort",
			() => {
				abortReason =
					controller.signal.reason ?? new Error("Scrape dihentikan");
				void reader.cancel(abortReason).catch(() => {});
			},
			{ once: true },
		);
	}

	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const chunk = await reader.read();
				// Abort karena jeda/batal harus menghentikan worker, bukan jadi
				// error item yang ditelan lalu lanjut ke item berikutnya:
				// lempar control error agar dikenali isRunControlError.
				if (abortReason)
					throw new RunStoppedError(
						abortReason instanceof Error ? abortReason.message : "dibatalkan",
					);
				if (chunk.done) {
					controller.close();
					release();
					return;
				}
				bytesRead += chunk.value.byteLength;
				if (bytesRead > maxBytes) {
					const error = new SourceResponseValidationError(
						`Source response exceeded the ${maxBytes}-byte limit`,
					);
					await reader.cancel(error).catch(() => undefined);
					controller.error(error);
					release();
					return;
				}
				controller.enqueue(chunk.value);
			} catch (error) {
				controller.error(error);
				release();
			}
		},
		async cancel(reason) {
			try {
				await reader.cancel(reason);
			} finally {
				release();
			}
		},
	});

	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

function isPrivateIpv4(address: string) {
	const octets = address.split(".").map(Number);
	if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255))
		return true;
	const [a, b, c] = octets as [number, number, number, number];
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0 && c === 0) ||
		(a === 192 && b === 0 && c === 2) ||
		(a === 192 && b === 88 && c === 99) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
		a >= 224
	);
}

export function isPublicMediaAddress(address: string) {
	const version = isIP(address);
	if (version === 4) return !isPrivateIpv4(address);
	if (version !== 6) return false;
	const normalized = address.toLowerCase();
	// Only global-unicast IPv6 is considered. Reject special-use, documentation,
	// 6to4, and transition prefixes, including IPv4-mapped addresses.
	return (
		/^2[0-9a-f]{3}:/.test(normalized) &&
		!normalized.startsWith("2001:") &&
		!normalized.startsWith("2002:")
	);
}

type ResolvedAddress = { address: string; family: number };

export async function resolvePublicMediaAddresses(
	hostname: string,
	resolve: typeof lookup = lookup,
): Promise<ResolvedAddress[]> {
	const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
	if (
		!host ||
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal")
	)
		throw new SourceResponseValidationError("Source media host is not public");
	const literalFamily = isIP(host);
	const addresses = literalFamily
		? [{ address: host, family: literalFamily }]
		: await resolve(host, { all: true, verbatim: true });
	if (
		addresses.length === 0 ||
		addresses.some(({ address }) => !isPublicMediaAddress(address))
	)
		throw new SourceResponseValidationError(
			"Source media host resolved to a non-public address",
		);
	return addresses;
}

export function isAllowedMediaRedirectUrl(
	url: URL,
	allowedHosts: ReadonlySet<string>,
) {
	return (
		url.protocol === "https:" &&
		!url.username &&
		!url.password &&
		(url.port === "" || url.port === "443") &&
		allowedHosts.has(url.hostname.toLowerCase())
	);
}

function requestPinnedHttps(
	url: URL,
	init: RequestInit,
	addresses: ResolvedAddress[],
) {
	return new Promise<Response>((resolve, reject) => {
		const address = addresses[0];
		if (!address) {
			reject(
				new SourceResponseValidationError("Source media host has no address"),
			);
			return;
		}
		const headers = Object.fromEntries(new Headers(init.headers).entries());
		const request = httpsRequest(
			url,
			{
				method: init.method,
				headers,
				lookup: (_hostname, options, callback) => {
					if (
						options &&
						typeof options === "object" &&
						"all" in options &&
						options.all
					)
						callback(null, [address]);
					else callback(null, address.address, address.family);
				},
			},
			(incoming) => {
				const responseHeaders = new Headers();
				for (const [name, value] of Object.entries(incoming.headers)) {
					if (Array.isArray(value))
						for (const item of value) responseHeaders.append(name, item);
					else if (value !== undefined) responseHeaders.set(name, value);
				}
				const hasNoBody = [204, 205, 304].includes(incoming.statusCode ?? 0);
				const body = hasNoBody
					? null
					: (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
				resolve(
					new Response(body, {
						status: incoming.statusCode ?? 502,
						statusText: incoming.statusMessage,
						headers: responseHeaders,
					}),
				);
			},
		);
		const signal = init.signal;
		const onAbort = () => {
			const reason = signal?.reason;
			request.destroy(
				reason instanceof Error
					? reason
					: new Error("Source media request aborted"),
			);
		};
		if (signal?.aborted) onAbort();
		else signal?.addEventListener("abort", onAbort, { once: true });
		request.once("error", (error) => {
			signal?.removeEventListener("abort", onAbort);
			reject(error);
		});
		request.once("close", () => signal?.removeEventListener("abort", onAbort));
		if (init.body) request.write(init.body as string);
		request.end();
	});
}

async function fetchWithAllowedRedirects(
	url: URL,
	init: RequestInit,
	allowedRedirectHosts: readonly string[],
) {
	const allowedHosts = new Set(
		allowedRedirectHosts.map((host) => host.toLowerCase()),
	);
	let current = url;
	if (!isAllowedMediaRedirectUrl(current, allowedHosts))
		throw new SourceResponseValidationError(
			"Source media URL host is not allowed",
		);

	for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
		const addresses = await resolvePublicMediaAddresses(current.hostname);
		const response = await requestPinnedHttps(current, init, addresses);
		if (response.status < 300 || response.status >= 400) return response;

		const location = response.headers.get("location");
		await response.body?.cancel().catch(() => undefined);
		if (!location || redirectCount === 5)
			throw new SourceResponseValidationError(
				"Source media returned an invalid or excessive redirect chain",
			);

		let target: URL;
		try {
			target = new URL(location, current);
		} catch {
			throw new SourceResponseValidationError(
				"Source media returned an invalid redirect target",
			);
		}
		if (!isAllowedMediaRedirectUrl(target, allowedHosts))
			throw new SourceResponseValidationError(
				"Source media redirect host is not allowed",
			);
		current = target;
	}

	throw new SourceResponseValidationError(
		"Source media returned an excessive redirect chain",
	);
}

export async function withSourceNetworkRetry<T>(
	source: SourceConfig,
	action: () => Promise<T>,
): Promise<T> {
	const maxRetries = maxRetriesFor(source);
	const budgets = new Map(sourceRetryBudgets.getStore() ?? []);
	const budget = budgets.get(source.id) ?? { retriesUsed: 0, maxRetries };
	budgets.set(source.id, budget);
	return sourceRetryBudgets.run(budgets, async () => {
		while (true) {
			if (source.runId)
				await waitForRunResume(source.runId, source.workerToken);
			try {
				const value = await action();
				if (source.runId)
					await waitForRunResume(source.runId, source.workerToken);
				if (source.runId) clearRetryNotice(source.runId, source.name);
				return value;
			} catch (error) {
				// Fetch attempts and body-read retries share one operation-level budget.
				if (error instanceof SourceRetryLimitError) throw error;
				if (!isRetryableNetworkError(error)) throw error;
				if (!hasRetryBudget(budget.retriesUsed, budget.maxRetries))
					throw new SourceRetryLimitError(source, error, budget.maxRetries);
				budget.retriesUsed += 1;
				await waitForRetry(
					source,
					budget.retriesUsed,
					retryDelay(budget.retriesUsed - 1),
					error,
				);
			}
		}
	});
}

export async function fetchSource(
	source: SourceConfig,
	url: URL,
	accept: string,
	options: {
		timeoutMs?: number;
		lane?: "api" | "image";
		intervalMs?: number;
		maxResponseBytes?: number;
		allowedRedirectHosts?: readonly string[];
		method?: "GET" | "POST";
		body?: string;
		headers?: Record<string, string>;
	} = {},
) {
	const lane = options.lane ?? "api";
	const maxResponseBytes =
		options.maxResponseBytes ??
		(lane === "image" ? 80 * 1024 * 1024 : 8 * 1024 * 1024);
	let attempt = 0;
	const sharedBudget = sourceRetryBudgets.getStore()?.get(source.id);
	// Mode nested: fetchSource dipanggil di dalam withSourceNetworkRetry untuk
	// source yang sama (bug #5). Budget hanya dikonsumsi SATU kali di wrapper
	// luar — di sini lakukan satu percobaan per panggilan dan lempar error
	// retryable mentah agar wrapper luar yang me-retry + backoff + lapor.
	// Mode standalone (tanpa shared budget): loop retry internal seperti dulu.
	const nested = sharedBudget !== undefined;
	const maxRetries = sharedBudget?.maxRetries ?? maxRetriesFor(source);
	const retriesUsed = () => sharedBudget?.retriesUsed ?? attempt;
	const consumeRetry = () => {
		if (sharedBudget) sharedBudget.retriesUsed += 1;
		else attempt += 1;
	};
	while (true) {
		if (source.runId) await waitForRunResume(source.runId, source.workerToken);
		const release = await waitForRequestSlot(source, lane, options.intervalMs);
		const runRequest = source.runId
			? registerRunRequest(source.runId)
			: undefined;
		let pauseInterruptedRequest = false;
		let waitMs = 0;
		let keepRequestRegistered = false;
		let keepImageSlot = false;
		try {
			if (source.runId)
				await waitForRunResume(source.runId, source.workerToken);
			const requestOptions: RequestInit = {
				method: options.method ?? "GET",
				body: options.body,
				headers: {
					Accept: accept,
					"User-Agent": "MIFE/0.1 (personal comic library)",
					...options.headers,
				},
				signal: runRequest
					? AbortSignal.any([
							runRequest.controller.signal,
							AbortSignal.timeout(options.timeoutMs ?? 25_000),
						])
					: AbortSignal.timeout(options.timeoutMs ?? 25_000),
			};
			const response = options.allowedRedirectHosts
				? await fetchWithAllowedRedirects(
						url,
						requestOptions,
						options.allowedRedirectHosts,
					)
				: await fetch(url, { ...requestOptions, redirect: "follow" });

			if (response.ok) {
				const contentType = response.headers.get("content-type") ?? "";
				if (!contentTypeMatches(accept, contentType)) {
					await response.body?.cancel().catch(() => undefined);
					throw new SourceResponseValidationError(
						`${source.name} mengembalikan MIME ${contentType || "tanpa content-type"}; diharapkan ${accept}`,
					);
				}
				const contentLength = Number(response.headers.get("content-length"));
				if (
					Number.isFinite(contentLength) &&
					contentLength > maxResponseBytes
				) {
					await response.body?.cancel().catch(() => undefined);
					throw new SourceResponseValidationError(
						`${source.name} mengembalikan ${contentLength} byte, melewati batas ${maxResponseBytes}`,
					);
				}
				if (source.runId) clearRetryNotice(source.runId, source.name);
				if (runRequest) {
					keepRequestRegistered = true;
					if (lane === "image") {
						keepImageSlot = true;
						return controlledResponse(
							response,
							runRequest,
							release,
							maxResponseBytes,
						);
					}
					return controlledResponse(
						response,
						runRequest,
						undefined,
						maxResponseBytes,
					);
				}
				if (lane === "image") {
					keepImageSlot = true;
					return controlledResponse(
						response,
						undefined,
						release,
						maxResponseBytes,
					);
				}
				return controlledResponse(
					response,
					undefined,
					undefined,
					maxResponseBytes,
				);
			}

			const retryable =
				response.status === 408 ||
				response.status === 425 ||
				response.status === 429 ||
				response.status >= 500;
			const retryAfter = response.headers.get("retry-after");
			await response.body?.cancel();
			const error = new SourceHttpError(response.status, source.key);
			const used = retriesUsed();
			if (!retryable || !hasRetryBudget(used, maxRetries)) {
				if (source.runId && retryable)
					throw new SourceRetryLimitError(source, error, maxRetries);
				throw error;
			}
			// Nested: jangan konsumsi budget / sleep di sini; wrapper luar
			// yang memiliki budget akan menangani retry-nya.
			if (nested) throw error;
			waitMs = retryDelay(used, retryAfter);
		} catch (error) {
			if (error instanceof SourceRetryLimitError) throw error;
			if (runRequest?.controller.signal.aborted) {
				pauseInterruptedRequest = true;
			} else {
				const retryableError = isRetryableNetworkError(error);
				// Nested: lempar mentah agar satu kegagalan hanya makan satu
				// slot budget di wrapper luar.
				if (nested) throw error;
				if (!retryableError || !hasRetryBudget(retriesUsed(), maxRetries)) {
					if (source.runId && retryableError)
						throw new SourceRetryLimitError(source, error, maxRetries);
					throw error;
				}
				waitMs = retryDelay(retriesUsed());
			}
		} finally {
			if (!keepImageSlot) release();
			if (runRequest && !keepRequestRegistered) runRequest.release();
		}

		if (pauseInterruptedRequest && source.runId) {
			await waitForRunResume(source.runId, source.workerToken);
			continue;
		}
		consumeRetry();
		await waitForRetry(source, retriesUsed(), waitMs);
	}
}

export function absoluteSourceUrl(
	source: SourceConfig,
	value: string | null | undefined,
) {
	if (!value) return null;
	try {
		const url = new URL(value, `${source.baseUrl.replace(/\/+$/, "")}/`);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.toString()
			: null;
	} catch {
		return null;
	}
}

export function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function asString(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return null;
}

export function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}
