// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

describe("usePrefersReducedMotion", () => {
  it("reads the preference after mount and subscribes to changes", () => {
    let matches = true;
    let listener: (() => void) | undefined;
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      get matches() { return matches; },
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: (_name: string, next: () => void) => { listener = next; },
      removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
    act(() => { matches = false; listener?.(); });
    expect(result.current).toBe(false);
  });
});
