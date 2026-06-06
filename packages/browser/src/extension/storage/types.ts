import { type EmitFn, event, type Shape, type WithEvents, type WithProvided } from "@flowrun/core";

import type { StorageProvider } from "../../contracts/storage.ts";

export interface StorageExtensionConfig {
    emitEvent?: boolean;
    provider: StorageProvider;
}

export interface StorageProvidedContext {
    storage: StorageProvider;
}

export const storageEvents = {
    saved: event<{ key: string; size: number }>("storage:saved"),
} as const;

export type StorageEvent = (typeof storageEvents)[keyof typeof storageEvents];

export type StorageEmit = EmitFn<StorageEvent>;

export interface StorageShape extends Shape {
    events: StorageEvent;
    provided: StorageProvidedContext;
}

export type WithStorage<TShape extends Shape = Shape> = WithProvided<
    WithEvents<TShape, StorageEvent>,
    StorageProvidedContext
>;
