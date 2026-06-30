import { describe, expect, it } from "vitest";
import { bindChannelsToElement } from "./dom";

/** Minimal stub that satisfies the HTMLElement.style.setProperty interface. */
const makeElement = () => {
  const props: Record<string, string> = {};
  const element = {
    style: {
      setProperty(name: string, value: string): void {
        props[name] = value;
      },
      getProperty(name: string): string | undefined {
        return props[name];
      },
    },
    _props: props, // test accessor
  } as unknown as HTMLElement & { _props: Record<string, string> };
  return element;
};

describe("bindChannelsToElement", () => {
  it("writes mapped channels as CSS custom properties", () => {
    const el = makeElement();
    bindChannelsToElement(
      el,
      { beat: 0.75, cta: 0.5 },
      { beat: "--pulse-beat", cta: "--pulse-cta" },
    );
    expect((el as unknown as { _props: Record<string, string> })._props["--pulse-beat"]).toBe("0.7500");
    expect((el as unknown as { _props: Record<string, string> })._props["--pulse-cta"]).toBe("0.5000");
  });

  it("uses default precision of 4", () => {
    const el = makeElement();
    bindChannelsToElement(el, { x: 1 / 3 }, { x: "--x" });
    expect((el as unknown as { _props: Record<string, string> })._props["--x"]).toBe("0.3333");
  });

  it("respects custom precision", () => {
    const el = makeElement();
    bindChannelsToElement(el, { x: 0.123456 }, { x: "--x" }, { precision: 2 });
    expect((el as unknown as { _props: Record<string, string> })._props["--x"]).toBe("0.12");
  });

  it("skips channels not present in values", () => {
    const el = makeElement();
    bindChannelsToElement(
      el,
      { beat: 1 },
      { beat: "--pulse-beat", missing: "--pulse-missing" },
    );
    const props = (el as unknown as { _props: Record<string, string> })._props;
    expect(props["--pulse-beat"]).toBe("1.0000");
    expect(props["--pulse-missing"]).toBeUndefined();
  });

  it("writes 0 and 1 correctly", () => {
    const el = makeElement();
    bindChannelsToElement(el, { a: 0, b: 1 }, { a: "--a", b: "--b" });
    const props = (el as unknown as { _props: Record<string, string> })._props;
    expect(props["--a"]).toBe("0.0000");
    expect(props["--b"]).toBe("1.0000");
  });

  it("handles an empty mapping without errors", () => {
    const el = makeElement();
    expect(() => bindChannelsToElement(el, { beat: 1 }, {})).not.toThrow();
  });

  it("handles an empty values record without errors", () => {
    const el = makeElement();
    expect(() =>
      bindChannelsToElement(el, {}, { beat: "--pulse-beat" }),
    ).not.toThrow();
  });

  it("skips NaN values without writing invalid CSS", () => {
    const el = makeElement();
    bindChannelsToElement(el, { beat: 0.5, bad: NaN }, { beat: "--beat", bad: "--bad" });
    const props = (el as unknown as { _props: Record<string, string> })._props;
    expect(props["--beat"]).toBe("0.5000");
    expect(props["--bad"]).toBeUndefined();
  });

  it("skips Infinity values without writing invalid CSS", () => {
    const el = makeElement();
    bindChannelsToElement(el, { beat: 0.5, bad: Infinity }, { beat: "--beat", bad: "--bad" });
    const props = (el as unknown as { _props: Record<string, string> })._props;
    expect(props["--beat"]).toBe("0.5000");
    expect(props["--bad"]).toBeUndefined();
  });

  it("writes values outside 0–1 range (no clamping)", () => {
    const el = makeElement();
    bindChannelsToElement(el, { scale: 2, neg: -0.5 }, { scale: "--scale", neg: "--neg" });
    const props = (el as unknown as { _props: Record<string, string> })._props;
    expect(props["--scale"]).toBe("2.0000");
    expect(props["--neg"]).toBe("-0.5000");
  });
});
