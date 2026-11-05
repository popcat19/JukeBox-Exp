// Prompt
//
// Purpose: Defines the Prompt interface for modal dialog components
//
// This module:
// - Specifies container and cleanup contract for prompts
// - Tracks mouse-up state for prompt dismissal

// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

export interface Prompt {
	name?: string;
	id: number;
	container: HTMLElement;
	cleanUp: () => void;
	discard: () => void;
	buildTitlebar?: (() => void) | undefined;
	whenKeyPressed?: ((event: KeyboardEvent) => void) | undefined;
	gotMouseUp?: boolean | undefined;
	closeWithoutUndo?: (() => void) | undefined;
	closeCallback?: ((prompt: Prompt) => unknown) | undefined;
	openAlongsideCallback?: ((promptName: string) => void) | undefined;
	requestPaneLeave?: (() => boolean) | undefined;
	requestPaneClose?: (() => boolean) | undefined;
}
