export type Simplify<TShape> = {
    [TKey in keyof TShape]: TShape[TKey];
};

export type StripIndexSignature<TShape> = {
    [TKey in keyof TShape as string extends TKey
        ? never
        : number extends TKey
          ? never
          : symbol extends TKey
            ? never
            : TKey]: TShape[TKey];
};

// ── Self-referential constraint helpers ─────────────────────────────
// These accept plain interfaces without requiring `extends Record<...>`

export type AnyRecord<T> = { [K in keyof T]: unknown };
export type ObjectRecord<T> = { [K in keyof T]: object };
