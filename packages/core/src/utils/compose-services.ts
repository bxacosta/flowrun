import type { ServiceFactory } from "../core/types.ts";

export const composeServices = <T1 extends object, T2 extends object>(
    s1: ServiceFactory<T1>,
    s2: ServiceFactory<T2>
): ServiceFactory<T1 & T2> => ({
    create: async (api) => {
        const [ctx1, ctx2] = await Promise.all([s1.create(api), s2.create(api)]);
        return { ...ctx1, ...ctx2 } as T1 & T2;
    },
    dispose: async (ext, api) => {
        // Dispose in reverse order
        if (s2.dispose !== undefined) {
            await s2.dispose(ext as unknown as T2, api);
        }
        if (s1.dispose !== undefined) {
            await s1.dispose(ext as unknown as T1, api);
        }
    },
});
