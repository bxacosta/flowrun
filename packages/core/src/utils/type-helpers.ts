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
