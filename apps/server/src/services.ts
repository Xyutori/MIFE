import { createAuth } from "@SyMi/auth";
import { createDb } from "@SyMi/db";

import { ENV, desktopOrigins } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db, desktopOrigins);
