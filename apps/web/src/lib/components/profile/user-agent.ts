/**
 * Parser user-agent ringan tanpa dependensi baru.
 * Dipakai untuk label daftar sesi perangkat di tab Account.
 * Bila UA kosong/tak dikenal → fallback "Perangkat tak dikenal".
 */

export interface ParsedUserAgent {
	/** mis. "Redmi 10A", "iPhone", "Windows", "Perangkat tak dikenal" */
	device: string;
	/** mis. "android", "ios", "windows", "macos", "linux" */
	os: string;
	/** mis. "Chrome 131", "Firefox", "Safari", "Edge", "Aplikasi" */
	browser: string;
}

const FALLBACK: ParsedUserAgent = {
	device: "Perangkat tak dikenal",
	os: "tak dikenal",
	browser: "Aplikasi",
};

function parseBrowser(ua: string): string | null {
	const edge = ua.match(/\bEdg(?:A|iOS)?\/(\d+)/i);
	if (edge) return `Edge ${edge[1]}`;
	const samsung = ua.match(/\bSamsungBrowser\/(\d+)/i);
	if (samsung) return `Samsung ${samsung[1]}`;
	const opera = ua.match(/\b(?:OPR|Opera)\/(\d+)/i);
	if (opera) return `Opera ${opera[1]}`;
	const firefox = ua.match(/\b(?:Firefox|FxiOS)\/(\d+)/i);
	if (firefox) return `Firefox ${firefox[1]}`;
	const chrome = ua.match(/\b(?:Chrome|CriOS)\/(\d+)/i);
	if (chrome && !/\bOPR\//.test(ua)) return `Chrome ${chrome[1]}`;
	const safariVersion = ua.match(/\bVersion\/(\d+).*Safari\//i);
	if (safariVersion && /Safari\//i.test(ua))
		return `Safari ${safariVersion[1]}`;
	return null;
}

function parseDeviceOs(ua: string): { device: string; os: string } | null {
	const androidModel = ua.match(/Android\s[\d.]+;\s([^;)]+?)(?:\s+Build|\))/i);
	if (/Android/i.test(ua)) {
		const raw = androidModel?.[1]?.trim();
		return {
			device: raw && raw.length > 0 ? raw : "Perangkat Android",
			os: "android",
		};
	}
	if (/\biPhone\b/i.test(ua)) return { device: "iPhone", os: "ios" };
	if (/\biPad\b/i.test(ua)) return { device: "iPad", os: "ios" };
	if (/\bWindows\b/i.test(ua)) return { device: "Windows", os: "windows" };
	if (/\bMacintosh\b/i.test(ua)) return { device: "Mac", os: "macos" };
	if (/\bLinux\b/i.test(ua)) return { device: "Linux", os: "linux" };
	return null;
}

export function parseUserAgent(
	userAgent: string | null | undefined,
): ParsedUserAgent {
	if (!userAgent?.trim()) return { ...FALLBACK };
	const ua = userAgent.trim();
	const deviceOs = parseDeviceOs(ua);
	const browser = parseBrowser(ua);
	if (!deviceOs && !browser) return { ...FALLBACK };
	return {
		device: deviceOs?.device ?? "Perangkat tak dikenal",
		os: deviceOs?.os ?? "tak dikenal",
		browser: browser ?? "Aplikasi",
	};
}
