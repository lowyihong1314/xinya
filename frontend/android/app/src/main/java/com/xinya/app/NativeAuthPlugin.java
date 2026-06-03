package com.xinya.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "NativeAuth")
public class NativeAuthPlugin extends Plugin {

    private static final String PREFS_NAME = "xinya_native_auth";
    private static final String KEY_IV = "session_iv";
    private static final String KEY_CIPHER_TEXT = "session_cipher_text";
    private static final String KEYSTORE_ALIAS = "xinya_native_auth_key";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final int GCM_TAG_BITS = 128;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs;

    @Override
    public void load() {
        prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
    }

    @PluginMethod
    public void getSession(PluginCall call) {
        executor.execute(() -> {
            try {
                JSONObject session = readSession();
                resolve(call, toPublicSession(session));
            } catch (Exception error) {
                reject(call, error, "getSession failed");
            }
        });
    }

    @PluginMethod
    public void setSession(PluginCall call) {
        String accessToken = call.getString("accessToken", "").trim();
        String refreshToken = call.getString("refreshToken", "").trim();
        String expiresAt = call.getString("expiresAt", "").trim();
        JSObject user = call.getObject("user");

        if (accessToken.isEmpty()) {
            call.reject("accessToken is required");
            return;
        }
        if (refreshToken.isEmpty()) {
            call.reject("refreshToken is required");
            return;
        }
        if (expiresAt.isEmpty()) {
            call.reject("expiresAt is required");
            return;
        }

        executor.execute(() -> {
            try {
                JSONObject session = new JSONObject();
                session.put("accessToken", accessToken);
                session.put("refreshToken", refreshToken);
                session.put("expiresAt", expiresAt);
                if (user != null) {
                    session.put("user", new JSONObject(user.toString()));
                }
                writeSession(session);
                resolve(call);
            } catch (Exception error) {
                reject(call, error, "setSession failed");
            }
        });
    }

    @PluginMethod
    public void refreshSession(PluginCall call) {
        String baseUrl = normalizeBaseUrl(call.getString("baseUrl", ""));
        if (baseUrl.isEmpty()) {
            call.reject("baseUrl is required");
            return;
        }

        executor.execute(() -> {
            try {
                JSONObject session = readSession();
                String refreshToken = session.optString("refreshToken", "").trim();
                if (refreshToken.isEmpty()) {
                    throw new IllegalStateException("refreshToken is not available");
                }

                JSONObject body = new JSONObject();
                body.put("refresh_token", refreshToken);
                JSONObject response = postJson(baseUrl + "/api/mobile/session/refresh", body);

                String nextAccessToken = firstNonEmpty(response, "access_token", "accessToken");
                String nextRefreshToken = firstNonEmpty(response, "refresh_token", "refreshToken");
                String nextExpiresAt = firstNonEmpty(response, "expires_at", "expiresAt");
                if (nextAccessToken.isEmpty() || nextExpiresAt.isEmpty()) {
                    throw new IllegalStateException("refresh response missing access token or expiry");
                }

                session.put("accessToken", nextAccessToken);
                if (!nextRefreshToken.isEmpty()) {
                    session.put("refreshToken", nextRefreshToken);
                }
                session.put("expiresAt", nextExpiresAt);
                JSONObject user = response.optJSONObject("user");
                if (user != null) {
                    session.put("user", user);
                }
                writeSession(session);
                resolve(call, toPublicSession(session));
            } catch (Exception error) {
                reject(call, error, "refreshSession failed");
            }
        });
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        executor.execute(() -> {
            try {
                getPrefs().edit().clear().apply();
                resolve(call);
            } catch (Exception error) {
                reject(call, error, "clearSession failed");
            }
        });
    }

    private JSONObject readSession() throws Exception {
        SharedPreferences preferences = getPrefs();
        String ivText = preferences.getString(KEY_IV, "");
        String cipherText = preferences.getString(KEY_CIPHER_TEXT, "");
        if (ivText == null || ivText.isEmpty() || cipherText == null || cipherText.isEmpty()) {
            return new JSONObject();
        }

        byte[] iv = Base64.decode(ivText, Base64.NO_WRAP);
        byte[] encrypted = Base64.decode(cipherText, Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] plainText = cipher.doFinal(encrypted);
        return new JSONObject(new String(plainText, StandardCharsets.UTF_8));
    }

    private void writeSession(JSONObject session) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(session.toString().getBytes(StandardCharsets.UTF_8));

        getPrefs()
            .edit()
            .putString(KEY_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
            .putString(KEY_CIPHER_TEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .apply();
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEYSTORE_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEYSTORE_ALIAS, null);
        }

        KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        keyGenerator.init(
            new KeyGenParameterSpec.Builder(
                KEYSTORE_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return keyGenerator.generateKey();
    }

    private JSObject toPublicSession(JSONObject session) {
        JSObject result = new JSObject();
        if (session == null || session.length() == 0) {
            return result;
        }
        putIfPresent(result, "accessToken", session.optString("accessToken", ""));
        putIfPresent(result, "expiresAt", session.optString("expiresAt", ""));
        JSONObject user = session.optJSONObject("user");
        if (user != null) {
            result.put("user", toJSObject(user));
        }
        return result;
    }

    private JSObject toJSObject(JSONObject source) {
        JSObject target = new JSObject();
        Iterator<String> keys = source.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            target.put(key, source.opt(key));
        }
        return target;
    }

    private JSONObject postJson(String urlString, JSONObject body) throws Exception {
        HttpURLConnection connection = null;
        InputStream input = null;
        try {
            URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(20000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setRequestProperty("Content-Length", String.valueOf(bytes.length));
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }

            int status = connection.getResponseCode();
            boolean ok = status >= 200 && status < 300;
            input = ok ? connection.getInputStream() : connection.getErrorStream();
            String text = readAll(input);
            if (!ok) {
                throw new IllegalStateException("HTTP " + status + ": " + text);
            }
            return text.trim().isEmpty() ? new JSONObject() : new JSONObject(text);
        } finally {
            if (input != null) {
                try { input.close(); } catch (Exception ignored) {}
            }
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private String readAll(InputStream input) throws Exception {
        if (input == null) {
            return "";
        }
        byte[] buffer = new byte[8192];
        StringBuilder builder = new StringBuilder();
        int read;
        while ((read = input.read(buffer)) != -1) {
            builder.append(new String(buffer, 0, read, StandardCharsets.UTF_8));
        }
        return builder.toString();
    }

    private String firstNonEmpty(JSONObject object, String snakeCaseKey, String camelCaseKey) {
        String snakeCase = object.optString(snakeCaseKey, "").trim();
        if (!snakeCase.isEmpty()) {
            return snakeCase;
        }
        return object.optString(camelCaseKey, "").trim();
    }

    private String normalizeBaseUrl(String value) {
        String normalized = value != null ? value.trim() : "";
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    private void putIfPresent(JSObject object, String key, String value) {
        if (value != null && !value.isEmpty()) {
            object.put(key, value);
        }
    }

    private SharedPreferences getPrefs() {
        if (prefs == null) {
            prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        }
        return prefs;
    }

    private void resolve(PluginCall call) {
        dispatchToMainThread(call::resolve);
    }

    private void resolve(PluginCall call, JSObject data) {
        dispatchToMainThread(() -> call.resolve(data));
    }

    private void reject(PluginCall call, Exception error, String fallback) {
        String message = error.getMessage() != null ? error.getMessage() : fallback;
        dispatchToMainThread(() -> call.reject(message));
    }

    private void dispatchToMainThread(Runnable action) {
        if (getActivity() != null) {
            getActivity().runOnUiThread(action);
            return;
        }
        action.run();
    }
}
