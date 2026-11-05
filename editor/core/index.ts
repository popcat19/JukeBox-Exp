// Core - Index
//
// Purpose: Barrel re-export of editor core modules
//
// This module:
// - Re-exports state management, logic, and animation modules

export { Change, ChangeGroup, ChangeSequence, UndoableChange } from "./change";
export { ChangeDispatcher } from "./change-dispatcher";
export { ChangeNotifier } from "./change-notifier";
export {
	activate as devInspectorActivate,
	isActive as devInspectorIsActive,
} from "./dev-inspector";
export { DrumsetSetup, DrumsetSetupHost } from "./drumset-setup";
export { EventListenerSetup, EventListenerSetupHost } from "./event-listener-setup";
export { FmOperatorSetup, FmOperatorSetupHost } from "./fm-operator-setup";
export { FrameScheduler, frameScheduler } from "./frame-scheduler";
export { KeyboardHandler } from "./keyboard-handler";
export { MenuHandler, MenuHandlerHost } from "./menu-handler";
export { ModSliderRegistry } from "./mod-slider-registry";
export { ModulatorSetup, ModulatorSetupHost } from "./modulator-setup";
export { PlayerAnimator } from "./player-animator";
export { Preferences } from "./preferences";
export { PromptFocusController } from "./prompt-focus-controller";
export { PromptEditorRefs, PromptHost, PromptManager } from "./prompt-manager";
export { Selection } from "./selection";
export { SongPerformance } from "./song-performance";
export { TagAutocomplete, type TagAutocompleteHost } from "./tag-autocomplete";
