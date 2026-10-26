/**
 * A ref that a hook hands out for reading. The hook updates `current` itself,
 * without a re-render; assigning to it is a type error. Unlike React's
 * `RefObject`, `current` is typed exactly as `T` under both React 18 and 19.
 */
export type ReadonlyRef<T> = { readonly current: T };
