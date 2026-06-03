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

export type NativeAlbumCameraInfo = {
  id?: string;
  facing?: "back" | "front" | "external" | "unknown" | "";
  hardwareLevel?: "legacy" | "limited" | "full" | "level_3" | "unknown" | "";
  hasFlash?: boolean;
  hasOpticalStabilization?: boolean;
  hasVideoStabilization?: boolean;
  supportsHighSpeedVideo?: boolean;
  maxPhotoWidth?: number;
  maxPhotoHeight?: number;
  maxVideoWidth?: number;
  maxVideoHeight?: number;
  fpsRanges?: Array<{ min?: number; max?: number }>;
};

export type NativeAlbumCameraProfile = {
  manufacturer?: string;
  brand?: string;
  model?: string;
  sdkInt?: number;
  isSamsung?: boolean;
  isEmulator?: boolean;
  hasCamera?: boolean;
  hasBackCamera?: boolean;
  hasFrontCamera?: boolean;
  supportsCamera2?: boolean;
  backCameraCount?: number;
  frontCameraCount?: number;
  externalCameraCount?: number;
  hasFlash?: boolean;
  hasOpticalStabilization?: boolean;
  hasVideoStabilization?: boolean;
  supportsHighSpeedVideo?: boolean;
  maxPhotoWidth?: number;
  maxPhotoHeight?: number;
  maxVideoWidth?: number;
  maxVideoHeight?: number;
  recommendedPhotoMaxWidth?: number;
  recommendedPhotoQuality?: number;
  recommendedVideoWidth?: number;
  recommendedVideoHeight?: number;
  recommendedFrameRate?: number;
  samsungEnhancedMode?: boolean;
  hardwareLevels?: string[];
  cameras?: NativeAlbumCameraInfo[];
};

export interface NativeAlbumUploadPlugin {
  pickAndUpload(options: {
    eventId: number;
    baseUrl: string;
  }): Promise<NativeAlbumUploadStatus>;

  captureAndUpload(options: {
    eventId: number;
    baseUrl: string;
    mediaType: "image" | "video";
  }): Promise<NativeAlbumUploadStatus>;

  getStatus(options?: {
    jobId?: string;
  }): Promise<NativeAlbumUploadStatus>;

  cancel(options?: {
    jobId?: string;
  }): Promise<NativeAlbumUploadStatus>;

  getCameraProfile(): Promise<NativeAlbumCameraProfile>;
}

function createUnavailablePlugin(): NativeAlbumUploadPlugin {
  const missing = async () => {
    throw new Error("NativeAlbumUpload plugin is unavailable in this runtime");
  };
  return {
    pickAndUpload: missing,
    captureAndUpload: missing,
    getStatus: async () => ({ status: "idle" }),
    cancel: async () => ({ status: "idle" }),
    getCameraProfile: async () => ({ hasCamera: false, samsungEnhancedMode: false }),
  };
}

function isNativeAlbumUploadPlugin(value: unknown): value is NativeAlbumUploadPlugin {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as NativeAlbumUploadPlugin).pickAndUpload === "function" &&
      typeof (value as NativeAlbumUploadPlugin).captureAndUpload === "function" &&
      typeof (value as NativeAlbumUploadPlugin).getStatus === "function" &&
      typeof (value as NativeAlbumUploadPlugin).cancel === "function" &&
      typeof (value as NativeAlbumUploadPlugin).getCameraProfile === "function",
  );
}

export const NativeAlbumUploadPluginBridge = resolveNativePlugin<NativeAlbumUploadPlugin>(
  "NativeAlbumUpload",
  isNativeAlbumUploadPlugin,
  createUnavailablePlugin,
);
