import { describe, expect, it } from "vitest";
import { presets } from "./presets";
import { setStepValue } from "./project";
import { SequencerEngine } from "./SequencerEngine";

describe("presets", () => {
  it("are deeply frozen, so mutating one throws instead of changing engine output", () => {
    expect(Object.isFrozen(presets)).toBe(true);
    for (const preset of Object.values(presets)) {
      expect(Object.isFrozen(preset)).toBe(true);
      for (const track of preset.tracks) {
        expect(Object.isFrozen(track)).toBe(true);
        expect(Object.isFrozen(track.steps)).toBe(true);
      }
    }

    expect(() => {
      presets.pulse.tracks[0].steps[0] = 7;
    }).toThrow(TypeError);
    expect(() => {
      presets.extra = presets.pulse;
    }).toThrow(TypeError);
    expect(presets.pulse.tracks[0].steps[0]).toBe(1);
  });

  it("still seed engines and the immutable editing helpers", () => {
    const engine = new SequencerEngine(presets.pulse);
    const edited = setStepValue(presets.pulse, presets.pulse.tracks[0].id, 1, 0.5);

    expect(engine.sampleChannelsAt(0)["kick-energy"]).toBe(1);
    expect(edited.tracks[0].steps[1]).toBe(0.5);
    expect(presets.pulse.tracks[0].steps[1]).toBe(0);
    engine.dispose();
  });
});
