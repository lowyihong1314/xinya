import { resolveNativePlugin } from "./capacitor";

export type NativeAlbumUploadStatus = {
  jobId?: string;
  eventId?: number;
  status?: "idle" | "queued" | "running" | "success" | "partial" | "error" | "canceled";
  total?: number;
  completed?: number;
  failed?: number;
  currentFile?: string;
  currentProgress?: number;
  error?: string;
  startedAt?: number;
  updatedAt?: number;
};

export interface NativeAlbumUploadPlugin {
  pickAndUpload(options: {
    eventId: number;
    baseUrl: string;
  }): Promise<NativeAlbumUploadStatus>;

  getStatus(options?: {
    jobId?: string;
  }): Promise<NativeAlbumUploadStatus>;

  cancel(options?: {
    jobId?: string;
  }): Promise<NativeAlbumUploadStatus>;
}

function createUnavailablePlugin(): NativeAlbumUploadPlugin {
  const missing = async () => {
    throw new Error("NativeAlbumUpload plugin is unavailable in this runtime");
  };
  return {
    pickAndUpload: missing,
    getStatus: async () => ({ status: "idle" }),
    cancel: async () => ({ status: "idle" }),
  };
}

function isNativeAlbumUploadPlugin(value: unknown): value is NativeAlbumUploadPlugin {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as NativeAlbumUploadPlugin).pickAndUpload === "function" &&
      typeof (value as NativeAlbumUploadPlugin).getStatus === "function" &&
      typeof (value as NativeAlbumUploadPlugin).cancel === "function",
  );
}

export const NativeAlbumUploadPluginBridge = resolveNativePlugin<NativeAlbumUploadPlugin>(
  "NativeAlbumUpload",
  isNativeAlbumUploadPlugin,
  createUnavailablePlugin,
);
