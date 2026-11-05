// Animations
//
// Purpose: Prompt lifecycle state hooks and decorative keyframe definitions
//
// Extracted from style.ts to keep the monolithic CSS file focused on layout
// and component selectors. Prompt lifecycle hooks emit no motion: PMD requires
// state changes to be immediate. The remaining keyframes are decorative
// identities owned by components elsewhere and are not part of the prompt
// shell contract.
//
// Contributes to the same injected <style> element as style.ts.

export function buildAnimationsCSS(): string {
	return `\
/* Prompt lifecycle states are immediate per PMD: no enter, exit, or
 * refocus animation. The classes remain as hooks because prompt-manager
 * adds and removes them, but they carry no motion. Geometry never shifts
 * between spawn and steady state, so there is no pre-enter pre-hide to
 * compensate for. */
.beepboxEditor .prompt.entering,
.beepboxEditor .prompt.refocus {
	animation: none;
}

/* Exit keeps the container non-interactive while the manager tears it
 * down on the next frame, so a click cannot land on a closing prompt. */
.beepboxEditor .prompt.exiting {
	animation: none;
	pointer-events: none;
}

@keyframes dash-animation {
  to {
    stroke-dashoffset: -100;
  }
}

@keyframes shiggy-bounce {
	0%, 100% { transform: translateY(0); }
	50% { transform: translateY(-6px); }
}
@keyframes shiggy-rock {
	0%, 100% { transform: rotate(-3deg); }
	50% { transform: rotate(3deg); }
}
@keyframes shiggy-enter {
	0% { transform: scale(0); opacity: 0; }
	60% { transform: scale(1.15); opacity: 1; }
	100% { transform: scale(1); opacity: 1; }
}

.beepboxEditor .dash-move {
	animation: dash-animation 20s infinite linear;
}`;
}
