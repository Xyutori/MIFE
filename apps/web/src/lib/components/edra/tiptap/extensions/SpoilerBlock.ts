import type { NodeViewProps } from "@tiptap/core";
import { mergeAttributes, Node } from "@tiptap/core";
import type { Component } from "svelte";
import { SvelteNodeViewRenderer } from "../index.ts";

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		spoilerBlock: {
			setSpoilerBlock: () => ReturnType;
		};
	}
}

/**
 * Spoiler block node for comments. Server whitelists node type
 * `spoilerBlock` (block containing `paragraph+`), so this name
 * must stay in sync with the backend contract.
 */
export const SpoilerBlock = (component: Component<NodeViewProps>) =>
	Node.create({
		name: "spoilerBlock",
		content: "paragraph+",
		group: "block",
		defining: true,
		draggable: false,

		addOptions() {
			return {
				HTMLAttributes: {
					class: "spoiler-block",
					"data-type": "spoiler-block",
				},
			};
		},

		parseHTML() {
			return [{ tag: "div[data-type=spoiler-block]" }];
		},

		renderHTML({ HTMLAttributes }) {
			return [
				"div",
				mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
				0,
			];
		},

		addCommands() {
			return {
				setSpoilerBlock:
					() =>
					({ commands }) => {
						return commands.insertContent({
							type: "spoilerBlock",
							content: [{ type: "paragraph" }],
						});
					},
			};
		},

		addNodeView() {
			return SvelteNodeViewRenderer(component);
		},
	});
