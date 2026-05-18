import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve, sep } from "node:path";
import { Readable, Writable } from "node:stream";

import type { StorageListPage, StorageObjectInfo, StorageProvider, StorageResult } from "../contracts/storage.ts";
import { StorageError } from "../errors.ts";

const KEY_SEPARATOR = "/";

export class FileStorageProvider implements StorageProvider {
    private readonly basePath: string;

    constructor(basePath: string) {
        this.basePath = resolve(basePath);
    }

    async save(key: string, data: Uint8Array, metadata?: Record<string, string>): Promise<StorageResult> {
        const absolute = this.absolutePath(key);
        try {
            await mkdir(dirname(absolute), { recursive: true });
            await writeFile(absolute, data);
        } catch (error) {
            throw new StorageError("save", key, undefined, error);
        }
        return {
            key,
            location: { kind: "file", value: absolute },
            size: data.byteLength,
            metadata,
        };
    }

    async saveStream(
        key: string,
        data: ReadableStream<Uint8Array>,
        metadata?: Record<string, string>
    ): Promise<StorageResult> {
        const absolute = this.absolutePath(key);
        try {
            await mkdir(dirname(absolute), { recursive: true });
            const writable = Writable.toWeb(createWriteStream(absolute));
            await data.pipeTo(writable);
            const info = await stat(absolute);
            return {
                key,
                location: { kind: "file", value: absolute },
                size: info.size,
                metadata,
            };
        } catch (error) {
            throw new StorageError("saveStream", key, undefined, error);
        }
    }

    async read(key: string): Promise<Uint8Array> {
        const absolute = this.absolutePath(key);
        try {
            return await readFile(absolute);
        } catch (error) {
            throw new StorageError("read", key, undefined, error);
        }
    }

    async readStream(key: string): Promise<ReadableStream<Uint8Array>> {
        const absolute = this.absolutePath(key);
        try {
            await stat(absolute);
        } catch (error) {
            throw new StorageError("readStream", key, undefined, error);
        }
        return Readable.toWeb(createReadStream(absolute)) as ReadableStream<Uint8Array>;
    }

    async head(key: string): Promise<StorageObjectInfo> {
        const absolute = this.absolutePath(key);
        try {
            const info = await stat(absolute);
            return {
                key,
                size: info.size,
                modifiedAt: info.mtime,
            };
        } catch (error) {
            throw new StorageError("head", key, undefined, error);
        }
    }

    async exists(key: string): Promise<boolean> {
        try {
            await stat(this.absolutePath(key));
            return true;
        } catch {
            return false;
        }
    }

    async delete(key: string): Promise<void> {
        try {
            await rm(this.absolutePath(key), { force: true });
        } catch (error) {
            throw new StorageError("delete", key, undefined, error);
        }
    }

    async list(prefix?: string, cursor?: string, limit?: number): Promise<StorageListPage> {
        try {
            const all = await this.walk(this.basePath, "");
            all.sort();
            const filtered = prefix ? all.filter((key) => key.startsWith(prefix)) : all;
            const startIndex = cursor ? bisectRight(filtered, cursor) : 0;
            const effectiveLimit = limit && limit > 0 ? limit : filtered.length - startIndex;
            const slice = filtered.slice(startIndex, startIndex + effectiveLimit);
            const last = slice.at(-1);
            const hasMore = startIndex + slice.length < filtered.length;
            return {
                keys: slice,
                nextCursor: hasMore && last !== undefined ? last : undefined,
            };
        } catch (error) {
            throw new StorageError("list", prefix ?? "", undefined, error);
        }
    }

    private absolutePath(key: string): string {
        const normalized = key.split(KEY_SEPARATOR).join(sep);
        return join(this.basePath, normalized);
    }

    private async walk(directory: string, relative: string): Promise<string[]> {
        const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
            if (isFileNotFound(error)) {
                return [];
            }
            throw error;
        });
        const keys: string[] = [];
        for (const entry of entries) {
            const childRelative = relative ? posix.join(relative, entry.name) : entry.name;
            const childAbsolute = join(directory, entry.name);
            if (entry.isDirectory()) {
                keys.push(...(await this.walk(childAbsolute, childRelative)));
            } else if (entry.isFile()) {
                keys.push(childRelative);
            }
        }
        return keys;
    }
}

function isFileNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

function bisectRight(sorted: readonly string[], value: string): number {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        const current = sorted[mid];
        if (current !== undefined && current <= value) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}
