import type { ClientExtensionAPI } from "@rollforge/extension-api";

export interface ExtensionSource {
  id: string;
  url: string;
}

export interface ExtensionSourcesResponse {
  sources: ExtensionSource[];
}

export interface LoadClientExtensionsResult {
  loaded: string[];
  failed: Array<{ id: string; error: string }>;
}

export type ExtensionClientModule = {
  default?: ((api: ClientExtensionAPI) => void | Promise<void>) | undefined;
  activate?: ((api: ClientExtensionAPI) => void | Promise<void>) | undefined;
};

export type ClientAPIFactory = (extensionId: string) => ClientExtensionAPI;

// Fetches the list of client extensions from /api/extension-sources and dynamically
// imports and activates each one. Errors in individual extensions are captured in
// `failed` without interrupting other extensions (§Paso 17 §3.6).
export async function loadClientExtensions(
  apiOrFactory: ClientExtensionAPI | ClientAPIFactory,
  fetchImpl: typeof fetch = fetch,
  importImpl: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url),
): Promise<LoadClientExtensionsResult> {
  let sources: ExtensionSource[] = [];

  try {
    const res = await fetchImpl("/api/extension-sources", {
      credentials: "same-origin",
    });
    if (!res.ok) {
      return { loaded: [], failed: [{ id: "sources", error: "fetch-failed" }] };
    }
    const data = (await res.json()) as ExtensionSourcesResponse;
    if (data && Array.isArray(data.sources)) {
      sources = data.sources;
    }
  } catch {
    return { loaded: [], failed: [{ id: "sources", error: "fetch-failed" }] };
  }

  const result: LoadClientExtensionsResult = { loaded: [], failed: [] };

  for (const src of sources) {
    try {
      const mod = (await importImpl(src.url)) as ExtensionClientModule;
      const activate = mod.default ?? mod.activate;
      if (typeof activate === "function") {
        const api = typeof apiOrFactory === "function" ? apiOrFactory(src.id) : apiOrFactory;
        await activate(api);
      }
      result.loaded.push(src.id);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      result.failed.push({ id: src.id, error });
      console.warn(`[extensions] client extension "${src.id}" failed to load: ${error}`);
    }
  }

  return result;
}
