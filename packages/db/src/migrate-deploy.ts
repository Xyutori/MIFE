/**
 * Jalankan migrasi SQL yang pending (idempoten via journal drizzle).
 * Dipakai sebagai langkah startup container prod sebelum server menyala.
 * Sengaja memakai API `migrate()` dari drizzle-orm (bukan drizzle-kit CLI)
 * agar versi runner selalu cocok dengan versi ORM yang terinstal.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL belum diisi");

const db = drizzle(databaseUrl);
await migrate(db, { migrationsFolder: "/app/packages/db/src/migrations" });
console.log("Migrasi database selesai");
process.exit(0);
