import type { StorageProvider, StorageResult } from "../contracts/storage.ts";
import type { BrowserBus } from "./navigate.ts";
import { EVENT_SOURCE } from "./types.ts";

export interface WrapStorageOptions {
    emitEvent: boolean;
}

export function wrapStorage(inner: StorageProvider, bus: BrowserBus, options: WrapStorageOptions): StorageProvider {
    if (!options.emitEvent) {
        return inner;
    }

    const emit = async (result: StorageResult): Promise<void> => {
        await bus.publish("browser:storage-saved", { key: result.key, size: result.size }, { source: EVENT_SOURCE });
    };

    return {
        async save(key, data, metadata) {
            const result = await inner.save(key, data, metadata);
            await emit(result);
            return result;
        },
        async saveStream(key, data, metadata) {
            const result = await inner.saveStream(key, data, metadata);
            await emit(result);
            return result;
        },
        read: (key) => inner.read(key),
        readStream: (key) => inner.readStream(key),
        head: (key) => inner.head(key),
        exists: (key) => inner.exists(key),
        delete: (key) => inner.delete(key),
        list: (prefix, cursor, limit) => inner.list(prefix, cursor, limit),
    };
}
