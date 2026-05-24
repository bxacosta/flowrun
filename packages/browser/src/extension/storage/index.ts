import { type ExtensionDefinition, eventPublic, extension } from "@flowrun/core";

import type { StorageBus, StorageEventPayloads, StorageExtensionConfig, StorageProvidedContext } from "./types.ts";
import { wrapStorage } from "./wrap.ts";

export const STORAGE_EXTENSION_NAME = "storage";

export type StorageExtensionDefinition = ExtensionDefinition<
    object,
    StorageProvidedContext,
    object,
    StorageEventPayloads
>;

export function createStorageExtension(config: StorageExtensionConfig): StorageExtensionDefinition {
    const emitEvent = config.emitEvent ?? true;

    return extension({
        name: STORAGE_EXTENSION_NAME,
        events: {
            "storage:saved": eventPublic<StorageEventPayloads["storage:saved"]>(),
        },
        provide: ({ bus }) => {
            const storageBus: StorageBus = bus;
            return {
                provided: {
                    storage: wrapStorage(config.provider, storageBus, { emitEvent }),
                },
            };
        },
    });
}
