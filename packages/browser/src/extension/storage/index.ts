import { type ExtensionDefinition, extension } from "@flowrun/core";

import { type StorageExtensionConfig, type StorageProvidedContext, storageEvents } from "./types.ts";
import { wrapStorage } from "./wrap.ts";

export const STORAGE_EXTENSION_NAME = "storage";

export type StorageExtensionDefinition = ExtensionDefinition<object, StorageProvidedContext>;

export function createStorageExtension(config: StorageExtensionConfig): StorageExtensionDefinition {
    const emitEvent = config.emitEvent ?? true;

    return extension({
        name: STORAGE_EXTENSION_NAME,
        events: [storageEvents.saved],
        setup: ({ emit }) => ({
            provided: {
                storage: wrapStorage(config.provider, emit, { emitEvent }),
            },
        }),
    });
}
