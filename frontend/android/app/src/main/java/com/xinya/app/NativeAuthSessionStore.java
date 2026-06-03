package com.xinya.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class NativeAuthSessionStore {

    private static final String PREFS_NAME = "xinya_native_auth";
    private static final String KEY_IV = "session_iv";
    private static final String KEY_CIPHER_TEXT = "session_cipher_text";
    private static final String KEYSTORE_ALIAS = "xinya_native_auth_key";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final int GCM_TAG_BITS = 128;
    private static final long EXPIRY_SKEW_MS = 60_000L;

    private NativeAuthSessionStore() {}

    public static String getAccessToken(Context context) {
        try {
            JSONObject session = readSession(context);
            String accessToken = session.optString("accessToken", "").trim();
            String expiresAt = session.optString("expiresAt", "").trim();
            if (isExpiredOrNearlyExpired(expiresAt)) {
                return null;
            }
            return accessToken.isEmpty() ? null : accessToken;
        } catch (Exception ignored) {
            return null;
        }
    }

    public static String getAuthorizationHeader(Context context) {
        String accessToken = getAccessToken(context);
        return accessToken == null || accessToken.isEmpty() ? null : "Bearer " + accessToken;
    }

    private static JSONObject readSession(Context context) throws Exception {
        if (context == null) {
            return new JSONObject();
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String ivText = prefs.getString(KEY_IV, "");
        String cipherText = prefs.getString(KEY_CIPHER_TEXT, "");
        if (ivText == null || ivText.isEmpty() || cipherText == null || cipherText.isEmpty()) {
            return new JSONObject();
        }

        byte[] iv = Base64.decode(ivText, Base64.NO_WRAP);
        byte[] encrypted = Base64.decode(cipherText, Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] plainText = cipher.doFinal(encrypted);
        return new JSONObject(new String(plainText, StandardCharsets.UTF_8));
    }

    private static SecretKey getKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        if (!keyStore.containsAlias(KEYSTORE_ALIAS)) {
            throw new IllegalStateException("Native auth key is not available");
        }
        return (SecretKey) keyStore.getKey(KEYSTORE_ALIAS, null);
    }

    private static boolean isExpiredOrNearlyExpired(String expiresAt) {
        long expiresAtMs = parseExpiryMillis(expiresAt);
        return expiresAtMs > 0L && expiresAtMs - System.currentTimeMillis() <= EXPIRY_SKEW_MS;
    }

    private static long parseExpiryMillis(String value) {
        if (value == null) {
            return 0L;
        }

        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return 0L;
        }

        try {
            long numeric = Long.parseLong(trimmed);
            return numeric < 100_000_000_000L ? numeric * 1000L : numeric;
        } catch (Exception ignored) {
        }

        String normalized = trimmed;
        if (normalized.endsWith("Z")) {
            normalized = normalized.substring(0, normalized.length() - 1) + "+0000";
        } else if (normalized.matches(".*[+-]\\d{2}:\\d{2}$")) {
            normalized = normalized.substring(0, normalized.length() - 3)
                + normalized.substring(normalized.length() - 2);
        }

        String[] patterns = new String[] {
            "yyyy-MM-dd'T'HH:mm:ss.SSSZ",
            "yyyy-MM-dd'T'HH:mm:ssZ",
            "yyyy-MM-dd'T'HH:mm:ss.SSS",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd HH:mm:ss"
        };

        for (String pattern : patterns) {
            try {
                SimpleDateFormat formatter = new SimpleDateFormat(pattern, Locale.US);
                formatter.setLenient(false);
                formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
                Date parsed = formatter.parse(normalized);
                if (parsed != null) {
                    return parsed.getTime();
                }
            } catch (Exception ignored) {
            }
        }

        return 0L;
    }
}
