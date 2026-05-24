import type { EventMap, PublishableBus, Shape, WithEvents, WithProvided } from "@flowrun/core";

import type { StorageProvider } from "../../contracts/storage.ts";

export const STORAGE_EVENT_SOURCE = "storage";

export interface StorageExtensionConfig {
    emitEvent?: boolean;
    provider: StorageProvider;
}

export interface StorageProvidedContext {
    storage: StorageProvider;
}

export interface StorageEventPayloads {
    "storage:saved": { key: string; size: number };
}

export type StorageBus = PublishableBus<StorageEventPayloads, EventMap>;

export interface StorageShape extends Shape {
    events: StorageEventPayloads;
    provided: StorageProvidedContext;
}

export type WithStorage<TShape extends Shape = Shape> = WithProvided<
    WithEvents<TShape, StorageEventPayloads>,
    StorageProvidedContext
>;
