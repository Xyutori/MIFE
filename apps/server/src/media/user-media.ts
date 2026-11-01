import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { ENV } from "../env.server";
import { bucket } from "../storage/s3";

// Client hapus terpisah karena instance S3 di `storage/s3.ts` tidak
// diekspor (modul itu hanya menyediakan put/get). Konfigurasi disamakan
// agar menunjuk bucket yang sama. Kegagalan hapus tidak pernah melempar:
// blob lama yang tertinggal lebih baik daripada upload yang gagal.
const deleteClient = new S3Client({
	region: ENV.S3_REGION,
	endpoint: ENV.S3_ENDPOINT,
	forcePathStyle: true,
	credentials: {
		accessKeyId: ENV.S3_ACCESS_KEY,
		secretAccessKey: ENV.S3_SECRET_KEY,
	},
});

/** Hapus blob user media lama (mis. avatar PNG diganti JPEG). Best-effort. */
export async function deleteUserMediaBlob(objectKey: string): Promise<void> {
	try {
		await deleteClient.send(
			new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
		);
	} catch (error) {
		console.warn("Gagal menghapus blob user media lama", {
			objectKey,
			reason: error instanceof Error ? error.message : "unknown",
		});
	}
}
