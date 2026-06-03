import { resolveNativePlugin } from "./capacitor";

export type NativeFileShareResult = {
  uri?: string;
  filename?: string;
};

export interface NativeFileSharePlugin {
  shareBase64File(options: {
    base64Data: string;
    filename: string;
    mimeType?: string;
    title?: string;
    text?: string;
    dialogTitle?: string;
  }): Promise<NativeFileShareResult>;
}

function createUnavailablePlugin(): NativeFileSharePlugin {
  return {
    shareBase64File: async () => {
      throw new Error("NativeFileShare plugin is unavailable in this runtime");
    },
  };
}

function isNativeFileSharePlugin(value: unknown): value is NativeFileSharePlugin {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as NativeFileSharePlugin).shareBase64File === "function",
  );
}

export const NativeFileSharePluginBridge = resolveNativePlugin<NativeFileSharePlugin>(
  "NativeFileShare",
  isNativeFileSharePlugin,
  createUnavailablePlugin,
);
