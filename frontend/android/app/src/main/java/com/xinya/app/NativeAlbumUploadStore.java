package com.xinya.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

public final class NativeAlbumUploadStore {

    private static final String PREFS_NAME = "xinya_native_album_upload";
    private static final String KEY_LATEST_JOB_ID = "latest_job_id";
    private static final String KEY_JOB_PREFIX = "job:";

    private NativeAlbumUploadStore() {}

    public static synchronized void writeStatus(Context context, JSONObject status) {
        if (context == null || status == null) {
            return;
        }
        String jobId = status.optString("jobId", "").trim();
        if (jobId.isEmpty()) {
            return;
        }
        try {
            status.put("updatedAt", System.currentTimeMillis());
        } catch (Exception ignored) {
        }
        prefs(context)
            .edit()
            .putString(KEY_LATEST_JOB_ID, jobId)
            .putString(KEY_JOB_PREFIX + jobId, status.toString())
            .apply();
    }

    public static synchronized JSONObject readStatus(Context context, String requestedJobId) {
        if (context == null) {
            return idleStatus();
        }
        SharedPreferences prefs = prefs(context);
        String jobId = requestedJobId != null ? requestedJobId.trim() : "";
        if (jobId.isEmpty()) {
            jobId = prefs.getString(KEY_LATEST_JOB_ID, "");
        }
        if (jobId == null || jobId.trim().isEmpty()) {
            return idleStatus();
        }
        String raw = prefs.getString(KEY_JOB_PREFIX + jobId, "");
        if (raw == null || raw.trim().isEmpty()) {
            return idleStatus();
        }
        try {
            return new JSONObject(raw);
        } catch (Exception ignored) {
            return idleStatus();
        }
    }

    public static JSONObject idleStatus() {
        JSONObject status = new JSONObject();
        try {
            status.put("status", "idle");
            status.put("total", 0);
            status.put("completed", 0);
            status.put("failed", 0);
            status.put("currentProgress", 0);
        } catch (Exception ignored) {
        }
        return status;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }
}
