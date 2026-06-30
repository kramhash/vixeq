export type BindChannelsOptions = {
  /** Number of decimal places for CSS value strings. Default 4. */
  precision?: number;
};

/**
 * Write a set of 0–1 channel values as CSS custom properties on a DOM element.
 *
 * @param element  - Target element (e.g. the root of your animated section).
 * @param values   - Record of channelKey → 0–1 number (e.g. from useAnimatedChannels).
 * @param mapping  - Maps each channelKey to a CSS custom property name.
 * @param options  - Optional precision (default 4 decimal places).
 *
 * @example
 * bindChannelsToElement(rootEl, values, {
 *   kick:  "--pulse-beat",
 *   bass:  "--pulse-cta",
 *   eq:    "--pulse-eq",
 *   mood:  "--pulse-mood",
 * });
 */
export function bindChannelsToElement(
  element: HTMLElement,
  values: Record<string, number>,
  mapping: Record<string, string>,
  options?: BindChannelsOptions,
): void {
  const precision = options?.precision ?? 4;
  for (const channelKey of Object.keys(mapping)) {
    const cssVar = mapping[channelKey];
    const value = values[channelKey];
    if (value !== undefined && cssVar !== undefined && Number.isFinite(value)) {
      element.style.setProperty(cssVar, value.toFixed(precision));
    }
  }
}
