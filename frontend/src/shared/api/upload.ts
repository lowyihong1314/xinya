/**
 * 文件上传。
 *
 * 为什么不直接用 http.post(FormData)：上传要**进度条**，而 fetch 没有上传进度
 * （只有下载进度）。这里退回 XMLHttpRequest —— 它是目前唯一能报上传进度的 API。
 *
 * 其余行为与 http 客户端保持一致：同样的 URL 拼接、同样的凭证、
 * 同样抛 ApiError、同样广播 401。
 */
import { apiUrl } from "../config/paths";
import { onUnauthorizedBroadcast } from "./client";
import { ApiError, extractMessage } from "./errors";

export interface UploadOptions {
  /** 额外的表单字段。值会被 String() 化；File/Blob 原样附加。 */
  fields?: Record<string, string | number | boolean | Blob | File>;
  /** 0–1。用来画进度条。 */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Bearer 令牌（APK）。由调用方从 tokenStore 取，保持与 http 客户端一致。 */
  bearerToken?: string | null;
}

export function upload<T = unknown>(
  path: string,
  files: Record<string, File | File[]>,
  options: UploadOptions = {},
): Promise<T> {
  const { fields, onProgress, signal, bearerToken } = options;

  const form = new FormData();
  for (const [name, value] of Object.entries(files)) {
    for (const file of Array.isArray(value) ? value : [value]) {
      // 第三个参数（文件名）必须给：不给的话 Safari 会发 "blob" 作为文件名，
      // 后端 secure_filename 之后就成了 "blob"，一批文件全部同名互相覆盖。
      form.append(name, file, file.name);
    }
  }
  for (const [name, value] of Object.entries(fields ?? {})) {
    form.append(name, value instanceof Blob ? value : String(value));
  }

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl(path));
    // 与 http 客户端一致：网页版靠会话 Cookie，跨域时必须显式带上。
    xhr.withCredentials = true;
    if (bearerToken) xhr.setRequestHeader("Authorization", `Bearer ${bearerToken}`);
    // ★ 绝对不要手工设 Content-Type：FormData 需要浏览器自动带 boundary，
    //   手工设了后端解析不出文件字段（症状是"上传成功但后端说没收到文件"）。

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
    }

    signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    xhr.addEventListener("load", () => {
      let parsed: unknown = null;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        parsed = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as T);
        return;
      }
      if (xhr.status === 401) onUnauthorizedBroadcast();
      reject(new ApiError(extractMessage(parsed, `上传失败（${xhr.status}）`), xhr.status, parsed));
    });

    xhr.addEventListener("error", () => reject(new ApiError("网络连接失败", 0, null)));
    xhr.addEventListener("abort", () => reject(new ApiError("上传已取消", 0, null)));
    xhr.addEventListener("timeout", () => reject(new ApiError("上传超时", 0, null)));

    xhr.send(form);
  });
}
