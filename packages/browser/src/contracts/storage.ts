export type StorageLocationKind = "file" | "uri" | "url";

export interface StorageLocation {
    kind: StorageLocationKind;
    value: string;
}

export interface StorageObjectInfo {
    key: string;
    metadata?: Record<string, string>;
    modifiedAt: Date;
    size: number;
}

export interface StorageResult {
    key: string;
    location: StorageLocation;
    metadata?: Record<string, string>;
    size: number;
}

export interface StorageListPage {
    keys: string[];
    nextCursor?: string;
}

export interface StorageProvider {
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    head(key: string): Promise<StorageObjectInfo>;
    list(prefix?: string, cursor?: string, limit?: number): Promise<StorageListPage>;
    read(key: string): Promise<Uint8Array>;
    readStream(key: string): Promise<ReadableStream<Uint8Array>>;
    save(key: string, data: Uint8Array, metadata?: Record<string, string>): Promise<StorageResult>;
    saveStream(
        key: string,
        data: ReadableStream<Uint8Array>,
        metadata?: Record<string, string>
    ): Promise<StorageResult>;
}
