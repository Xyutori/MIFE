import { createHash } from "node:crypto";
import {
	CreateBucketCommand,
	GetObjectCommand,
	HeadBucketCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

import { ENV } from "../env.server";

// Bucket mengikuti konvensi XyMI (`xymi-images`): satu bucket dev bersama
// di MinIO eksternal (127.0.0.1:9000). Key layout fase scraper nanti mengikuti
// XyMI `storage/object-keys.ts`: `comics/<series>/.../chapters/<chapter>/pages/<page>-<sha256>.<ext>`.
// Produksi sebaiknya memakai bucket dedicated (mis. `symi-images`).
const client = new S3Client({
	region: ENV.S3_REGION,
	endpoint: ENV.S3_ENDPOINT,
	forcePathStyle: true,
	credentials: {
		accessKeyId: ENV.S3_ACCESS_KEY,
		secretAccessKey: ENV.S3_SECRET_KEY,
	},
});

export const bucket = ENV.S3_BUCKET;

export async function ensureBucketExists() {
	try {
		await client.send(new HeadBucketCommand({ Bucket: bucket }));
		return;
	} catch (error) {
		const status = (error as { $metadata?: { httpStatusCode?: number } })
			?.$metadata?.httpStatusCode;
		const name = error instanceof Error ? error.name : "";
		if (status !== 404 && name !== "NotFound" && name !== "NoSuchBucket")
			throw error;
	}
	await client.send(new CreateBucketCommand({ Bucket: bucket }));
}

export async function putObject(
	key: string,
	body: Uint8Array,
	contentType: string,
) {
	await client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: key,
			Body: body,
			ContentType: contentType,
			ChecksumSHA256: createHash("sha256").update(body).digest("base64"),
		}),
	);
}

export function getObjectUrl(key: string) {
	return `${ENV.S3_ENDPOINT.replace(/\/$/, "")}/${bucket}/${key}`;
}

export async function getObjectBytes(key: string) {
	const object = await client.send(
		new GetObjectCommand({ Bucket: bucket, Key: key }),
	);
	if (!object.Body) throw new Error(`Object S3 tidak memiliki body: ${key}`);
	return new Uint8Array(await object.Body.transformToByteArray());
}

export async function objectExists(key: string) {
	try {
		await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
		return true;
	} catch (error) {
		const status = (error as { $metadata?: { httpStatusCode?: number } })
			?.$metadata?.httpStatusCode;
		const name = error instanceof Error ? error.name : "";
		if (status === 404 || name === "NotFound" || name === "NoSuchKey")
			return false;
		throw error;
	}
}
