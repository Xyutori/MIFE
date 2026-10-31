import { dev } from "$app/env";
import { createFsDrain } from "evlog/fs";
import { createEvlogHooks } from "evlog/sveltekit";

export const { handle, handleError } = createEvlogHooks({
  drain: dev ? createFsDrain() : undefined,
});
