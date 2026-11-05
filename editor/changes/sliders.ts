// Changes - Sliders
//
// Purpose: Implements undoable changes for continuous instrument slider values
//
// This module:
// - Provides change classes for volume, pan, effects, and operator sliders
// - Handles incremental and absolute slider value changes

// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import type { Instrument } from "../../synth";
import { Config } from "../../synth/synth-config";
import { Change } from "../core/change";
import type { SongDocument } from "../song-document";

export { ChangeFieldValue } from "./field-value";

export class ChangeInstrumentSlider extends Change {
	protected _instrument: Instrument;
	constructor(private _doc: SongDocument) {
		super();
		this._instrument = this._doc.getCurrentInstrumentObj();
	}

	public commit(): void {
		if (!this.isNoop()) {
			this._instrument.preset = this._instrument.type;
			this._doc.notifier.changed();
		}
	}
}

// for envelope mod recording
export class IndexableChange extends ChangeInstrumentSlider {
	constructor(index: number, _doc: SongDocument) {
		super(_doc);
		this.index = index;
	}

	private index: number = 0;

	public getIndex(): number {
		return this.index;
	}
}

export class ChangePulseWidth extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.pulseWidth = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary["pulse width"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeDecimalOffset extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.decimalOffset = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary["decimal offset"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeSupersawDynamism extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.supersawDynamism = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary.dynamism.index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}
export class ChangeSupersawSpread extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.supersawSpread = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary.spread.index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}
export class ChangeSupersawShape extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.supersawShape = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary["saw shape"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangePitchShift extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.pitchShift = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeDetune extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.detune = newValue + Config.detuneCenter;
		doc.notifier.changed();
		doc.synth.unsetMod(
			Config.modulators.dictionary.detune.index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeRingMod extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.ringModulation = newValue;
		doc.notifier.changed();
		doc.synth.unsetMod(
			Config.modulators.dictionary["ring modulation"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeRingModHz extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.ringModulationHz = newValue;
		doc.notifier.changed();
		doc.synth.unsetMod(
			Config.modulators.dictionary["ring mod hertz"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeRingModPulseWidth extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.ringModPulseWidth = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeUpperLimit extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.upperNoteLimit = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeLowerLimit extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.lowerNoteLimit = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeGranular extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.granular = newValue;
		doc.notifier.changed();
		doc.synth.unsetMod(
			Config.modulators.dictionary.granular.index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeGrainSize extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.grainSize = newValue;
		doc.notifier.changed();
		doc.synth.unsetMod(
			Config.modulators.dictionary["grain size"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeGrainAmounts extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.grainAmounts = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeGrainRange extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.grainRange = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeDistortion extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.distortion = newValue;
		doc.notifier.changed();
		doc.synth.unsetMod(
			Config.modulators.dictionary.distortion.index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeBitcrusherFreq extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.bitcrusherFreq = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary["bit crush"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeBitcrusherQuantization extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		doc.synth.unsetMod(
			Config.modulators.dictionary["freq crush"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		this._instrument.bitcrusherQuantization = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangePhaserMix extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.phaserMix = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangePhaserFreq extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.phaserFreq = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangePhaserFeedback extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.phaserFeedback = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangePhaserStages extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.phaserStages = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeCompressorThreshold extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.compressorThreshold = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeCompressorRatio extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.compressorRatio = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeCompressorAttack extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.compressorAttack = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeCompressorRelease extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.compressorRelease = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeCompressorSync extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.compressorSync = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeCombDelay extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.combDelay = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeCombFeedback extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.combFeedback = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeCombMix extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.combMix = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeCombRate extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.combRate = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeCombDepth extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.combDepth = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeStringSustain extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.stringSustain = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary.sustain.index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeEQFilterSimpleCut extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.eqFilterSimpleCut = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary["eq filt cut"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeEQFilterSimplePeak extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.eqFilterSimplePeak = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary["eq filt peak"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeNoteFilterSimpleCut extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.noteFilterSimpleCut = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary["note filt cut"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeNoteFilterSimplePeak extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.noteFilterSimplePeak = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary["note filt peak"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeEchoDelay extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.echoDelay = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary["echo delay"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeEchoSustain extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.echoSustain = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary.echo.index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeChorus extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.chorus = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary.chorus.index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeReverb extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.reverb = newValue;
		doc.synth.unsetMod(
			Config.modulators.dictionary.reverb.index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeOperatorAmplitude extends ChangeInstrumentSlider {
	public operatorIndex: number = 0;
	constructor(doc: SongDocument, operatorIndex: number, oldValue: number, newValue: number) {
		super(doc);
		this.operatorIndex = operatorIndex;
		this._instrument.operators[operatorIndex].amplitude = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangeFeedbackAmplitude extends ChangeInstrumentSlider {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc);
		this._instrument.feedbackAmplitude = newValue;
		doc.notifier.changed();
		if (oldValue !== newValue) this._didSomething();
	}
}

export class ChangePerEnvelopeSpeed extends IndexableChange {
	constructor(doc: SongDocument, oldSpeed: number, speed: number, index: number) {
		super(index, doc);
		this._instrument.envelopes[index].perEnvelopeSpeed = speed;
		doc.synth.unsetMod(
			Config.modulators.dictionary["individual envelope speed"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldSpeed !== speed) this._didSomething();
	}
}

export class ChangeEnvelopeLowerBound extends IndexableChange {
	constructor(doc: SongDocument, oldBound: number, bound: number, index: number) {
		super(index, doc);
		bound =
			bound > Config.perEnvelopeBoundMax
				? Config.perEnvelopeBoundMax
				: bound < Config.perEnvelopeBoundMin
					? Config.perEnvelopeBoundMin
					: Math.round(bound * 10) !== bound * 10
						? Config.perEnvelopeBoundMin
						: bound;
		this._instrument.envelopes[index].perEnvelopeLowerBound = bound;
		doc.synth.unsetMod(
			Config.modulators.dictionary["individual envelope lower bound"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldBound !== bound) this._didSomething();
	}
}

export class ChangeEnvelopeUpperBound extends IndexableChange {
	constructor(doc: SongDocument, oldBound: number, bound: number, index: number) {
		super(index, doc);
		bound =
			bound > Config.perEnvelopeBoundMax
				? Config.perEnvelopeBoundMax
				: bound < Config.perEnvelopeBoundMin
					? Config.perEnvelopeBoundMin
					: Math.round(bound * 10) !== bound * 10
						? Config.perEnvelopeBoundMin
						: bound;
		this._instrument.envelopes[index].perEnvelopeUpperBound = bound;
		doc.synth.unsetMod(
			Config.modulators.dictionary["individual envelope upper bound"].index,
			doc.channel,
			doc.getCurrentInstrument(),
		);
		doc.notifier.changed();
		if (oldBound !== bound) this._didSomething();
	}
}
