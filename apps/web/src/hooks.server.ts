import { createFsDrain } from "evlog/fs";
import { createEvlogHooks } from "evlog/sveltekit";
import { dev } from "$app/env";

export const { handle, handleError } = createEvlogHooks({
	drain: dev ? createFsDrain() : undefined,
});
