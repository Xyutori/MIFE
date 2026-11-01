import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// Tipe pembantu ala shadcn-svelte untuk komponen ui/* hasil installer.
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
	ref?: U | null;
};
export type WithoutChildren<T> = Omit<T, "children">;
export type WithoutChild<T> = Omit<T, "child">;
export type WithoutChildrenOrChild<T> = Omit<T, "children" | "child">;
