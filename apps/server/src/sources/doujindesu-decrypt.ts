const KEY_SALT =
	"doujindesu-scrapers-cannot-read-this-super-secret-salt-2026-v2";
const HOUR_MS = 60 * 60 * 1_000;
const UINT32_RANGE = 0x1_0000_0000;

export type DoujindesuDecryptionOptions = {
	nowMs?: number;
	salt?: string;
};

/**
 * Derive the 32-character key used by the current frontend bundle for an epoch hour.
 */
export function deriveDoujindesuKey(hour: number, salt = KEY_SALT): string {
	if (!Number.isSafeInteger(hour))
		throw new TypeError("Doujindesu key hour must be a safe integer");

	let hash = 0;
	for (const character of `${salt}_${hour}`)
		hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;

	let state = Math.abs(hash) || 123_456_789;
	let key = "";
	for (let index = 0; index < 32; index += 1) {
		state = (state * 1_664_525 + 1_013_904_223) % UINT32_RANGE;
		key += String.fromCharCode(33 + (state % 93));
	}
	return key;
}

function decryptWithKey(encryptedHex: string, key: string): string {
	let encodedText = "";
	let rollingValue = 42;
	for (let index = 0; index < encryptedHex.length / 2; index += 1) {
		const byte = Number.parseInt(
			encryptedHex.slice(index * 2, index * 2 + 2),
			16,
		);
		const decodedByte =
			(byte ^
				key.charCodeAt(index % key.length) ^
				(index * 13) ^
				rollingValue) &
			0xff;
		encodedText += String.fromCharCode(decodedByte);
		rollingValue = (rollingValue + byte) % 256;
	}
	return decodeURIComponent(encodedText);
}

/** Decrypt and JSON-parse the hex payload, trying keys for this hour and its neighbors. */
export function decryptDoujindesuPayload(
	encryptedHex: string,
	options: DoujindesuDecryptionOptions = {},
): unknown {
	if (!/^(?:[\da-f]{2})+$/i.test(encryptedHex))
		throw new TypeError("Doujindesu encrypted payload must be even-length hex");

	const nowMs = options.nowMs ?? Date.now();
	if (!Number.isFinite(nowMs))
		throw new TypeError("Doujindesu decryption time must be finite");
	const currentHour = Math.floor(nowMs / HOUR_MS);
	let lastError: unknown;
	for (const hour of [currentHour, currentHour - 1, currentHour + 1]) {
		try {
			const plaintext = decryptWithKey(
				encryptedHex,
				deriveDoujindesuKey(hour, options.salt),
			);
			return JSON.parse(plaintext) as unknown;
		} catch (error) {
			lastError = error;
		}
	}

	const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
	throw new Error(
		`Doujindesu payload could not be decrypted with the current or adjacent hour keys${detail}`,
	);
}

/** Unwrap the encrypted JSON envelope returned by the site's API. */
export function decryptDoujindesuResponse(
	response: unknown,
	options: DoujindesuDecryptionOptions = {},
): unknown {
	if (!response || typeof response !== "object" || Array.isArray(response))
		throw new TypeError("Doujindesu API response must be an object envelope");

	const encryptedHex = (response as Record<string, unknown>)._enc_resp_;
	if (typeof encryptedHex !== "string")
		throw new TypeError("Doujindesu API response is missing _enc_resp_");
	return decryptDoujindesuPayload(encryptedHex, options);
}
