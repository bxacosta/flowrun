export type Simplify<T> = {
    [K in keyof T]: T[K];
};

export type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer R) => void
    ? R
    : never;

export type CollapseIntersection<T> = [T] extends [never] ? {} : Simplify<UnionToIntersection<T>>;

export type StripIndexSignature<T> = {
    [K in keyof T as string extends K ? never : number extends K ? never : symbol extends K ? never : K]: T[K];
};
