import type { StorageProvider, StorageResult } from "../../contracts/storage.ts";
import { type StorageEmit, storageEvents } from "./types.ts";

export interface WrapStorageOptions {
    emitEvent: boolean;
}

export function wrapStorage(inner: StorageProvider, emit: StorageEmit, options: WrapStorageOptions): StorageProvider {
    if (!options.emitEvent) {
        return inner;
    }

    const emitSaved = (result: StorageResult): void => {
        emit(storageEvents.saved, { key: result.key, size: result.size });
    };

    return {
        async save(key, data, metadata) {
            const result = await inner.save(key, data, metadata);
            emitSaved(result);
            return result;
        },
        async saveStream(key, data, metadata) {
            const result = await inner.saveStream(key, data, metadata);
            emitSaved(result);
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
