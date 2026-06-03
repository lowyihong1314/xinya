package com.xinya.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import java.net.HttpURLConnection;
import java.net.URL;

public final class NativeMusicRepository {

    public static final String DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur";
    private static final String REMOTE_COVER_ROOT = "https://utbabuddha.com/api/music/album_cover";
    private static final int MUSIC_PAGE_SIZE = 200;

    private NativeMusicRepository() {}

    public static String normalizeBaseUrl(String value) {
        if (value == null) return "";
        String normalized = value.trim();
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    public static class AlbumRecord {
        public final int id;
        public final String name;
        public final String coverUrl;
        public final String image;
        public final double albumTotalMinutes;
        public final String description;
        public final String createdAt;

        AlbumRecord(
            int id,
            String name,
            String coverUrl,
            String image,
            double albumTotalMinutes,
            String description,
            String createdAt
        ) {
            this.id = id;
            this.name = name;
            this.coverUrl = coverUrl;
            this.image = image;
            this.albumTotalMinutes = albumTotalMinutes;
            this.description = description;
            this.createdAt = createdAt;
        }

        static AlbumRecord fromJson(String baseUrl, JSONObject data) {
            String rawImage = nullableString(data.optString("image", ""));
            String rawCover = nullableString(data.optString("cover_url", ""));
            String normalizedCover = normalizeCoverUrl(baseUrl, rawCover, rawImage);
            String normalizedImage = normalizeRemoteCoverUrl(rawImage, rawCover);
            return new AlbumRecord(
                data.optInt("id", 0),
                data.optString("name", ""),
                normalizedCover,
                normalizedImage,
                optDouble(data, "album_total_minutes"),
                nullableString(data.optString("description", "")),
                nullableString(data.optString("created_at", ""))
            );
        }

        JSObject toJSObject() {
            JSObject obj = new JSObject();
            obj.put("id", id);
            obj.put("name", name);
            obj.put("cover_url", coverUrl);
            obj.put("image", image);
            obj.put("album_total_minutes", albumTotalMinutes);
            obj.put("description", description);
            obj.put("created_at", createdAt);
            return obj;
        }
    }

    public static class MusicRecord {
        public final int id;
        public final String title;
        public final Integer albumId;
        public final Integer artistId;
        public final String fileName;
        public final String fileType;
        public final Long fileSize;
        public final Integer duration;
        public final String coverUrl;
        public final double playMinutes;
        public final String createdAt;
        public final AlbumRecord album;

        MusicRecord(
            int id,
            String title,
            Integer albumId,
            Integer artistId,
            String fileName,
            String fileType,
            Long fileSize,
            Integer duration,
            String coverUrl,
            double playMinutes,
            String createdAt,
            AlbumRecord album
        ) {
            this.id = id;
            this.title = title;
            this.albumId = albumId;
            this.artistId = artistId;
            this.fileName = fileName;
            this.fileType = fileType;
            this.fileSize = fileSize;
            this.duration = duration;
            this.coverUrl = coverUrl;
            this.playMinutes = playMinutes;
            this.createdAt = createdAt;
            this.album = album;
        }

        static MusicRecord fromJson(String baseUrl, JSONObject data, Map<Integer, AlbumRecord> albumById) {
            JSONObject albumData = data.optJSONObject("album");
            AlbumRecord album = null;
            if (albumData != null) {
                album = AlbumRecord.fromJson(baseUrl, albumData);
            }
            Integer albumId = optNullableInt(data, "album_id");
            if (album == null && albumId != null) {
                album = albumById.get(albumId);
            }
            return new MusicRecord(
                data.optInt("id", 0),
                data.optString("title", ""),
                albumId,
                optNullableInt(data, "artist_id"),
                nullableString(data.optString("file_name", "")),
                nullableString(data.optString("file_type", "")),
                optNullableLong(data, "file_size"),
                optNullableInt(data, "duration"),
                normalizeCoverUrl(baseUrl, data.optString("cover_url", "")),
                optDouble(data, "play_minutes"),
                nullableString(data.optString("created_at", "")),
                album
            );
        }

        JSObject toJSObject() {
            JSObject obj = new JSObject();
            obj.put("id", id);
            obj.put("title", title);
            obj.put("album_id", albumId);
            obj.put("artist_id", artistId);
            obj.put("file_name", fileName);
            obj.put("file_type", fileType);
            obj.put("file_size", fileSize);
            obj.put("duration", duration);
            obj.put("cover_url", coverUrl);
            obj.put("play_minutes", playMinutes);
            obj.put("created_at", createdAt);
            obj.put("album", album != null ? album.toJSObject() : null);
            return obj;
        }
    }

    public static class ListeningSessionRecord {
        public final String key;
        public final Integer musicUserPlayMinuteId;
        public final Integer musicId;
        public final String musicTitle;
        public final Integer userId;
        public final String username;
        public final String displayName;
        public String startAt;
        public String endAt;
        public int minuteCount;

        ListeningSessionRecord(
            String key,
            Integer musicUserPlayMinuteId,
            Integer musicId,
            String musicTitle,
            Integer userId,
            String username,
            String displayName,
            String startAt,
            String endAt,
            int minuteCount
        ) {
            this.key = key;
            this.musicUserPlayMinuteId = musicUserPlayMinuteId;
            this.musicId = musicId;
            this.musicTitle = musicTitle;
            this.userId = userId;
            this.username = username;
            this.displayName = displayName;
            this.startAt = startAt;
            this.endAt = endAt;
            this.minuteCount = minuteCount;
        }

        JSObject toJSObject() {
            JSObject obj = new JSObject();
            obj.put("key", key);
            obj.put("music_user_play_minute_id", musicUserPlayMinuteId);
            obj.put("music_id", musicId);
            obj.put("music_title", musicTitle);
            obj.put("user_id", userId);
            obj.put("username", username);
            obj.put("display_name", displayName);
            obj.put("start_at", startAt);
            obj.put("end_at", endAt);
            obj.put("minute_count", minuteCount);
            return obj;
        }
    }

    public static class LibraryPayload {
        public final List<AlbumRecord> albums = new ArrayList<>();
        public final List<MusicRecord> musics = new ArrayList<>();
        public final List<ListeningSessionRecord> listeningSessions = new ArrayList<>();
        public String listeningTimezone = DEFAULT_TIMEZONE;
        public int listeningTotalMinutes = 0;
        public int listeningUniqueListeners = 0;
    }

    public static class QueuePayload {
        public final List<Integer> queueIds = new ArrayList<>();
        public Integer currentMusicId = null;
    }

    private static class MinuteLogRecord {
        public final int id;
        public final String createdAt;
        public final Integer musicUserPlayMinuteId;
        public final Integer musicId;
        public final String musicTitle;
        public final Integer userId;
        public final String username;
        public final String displayName;

        MinuteLogRecord(JSONObject data) {
            this.id = data.optInt("id", 0);
            this.createdAt = nullableString(data.optString("created_at", ""));
            this.musicUserPlayMinuteId = optNullableInt(data, "music_user_play_minute_id");
            this.musicId = optNullableInt(data, "music_id");
            this.musicTitle = nullableString(data.optString("music_title", ""));
            this.userId = optNullableInt(data, "user_id");
            this.username = nullableString(data.optString("username", ""));
            this.displayName = nullableString(data.optString("display_name", ""));
        }
    }

    public static LibraryPayload loadLibrary(String baseUrl, String cookie, boolean includeListening) throws Exception {
        return loadLibrary(baseUrl, cookie, null, includeListening);
    }

    public static LibraryPayload loadLibrary(
        String baseUrl,
        String cookie,
        String authorizationHeader,
        boolean includeListening
    ) throws Exception {
        String normalizedBaseUrl = normalizeBaseUrl(baseUrl);
        LibraryPayload payload = new LibraryPayload();

        JSONArray albumArray = readArray(normalizedBaseUrl + "/api/music/albums", cookie, authorizationHeader);
        Map<Integer, AlbumRecord> albumById = new HashMap<>();
        for (int i = 0; i < albumArray.length(); i++) {
            AlbumRecord album = AlbumRecord.fromJson(normalizedBaseUrl, albumArray.getJSONObject(i));
            payload.albums.add(album);
            albumById.put(album.id, album);
        }

        JSONObject firstPage = readObject(
            normalizedBaseUrl + "/api/music/list?per_page=" + MUSIC_PAGE_SIZE + "&page=1",
            cookie,
            authorizationHeader
        );
        appendMusicPage(payload.musics, normalizedBaseUrl, firstPage.optJSONArray("musics"), albumById);
        int totalPages = Math.max(1, firstPage.optInt("total_pages", 1));
        for (int page = 2; page <= totalPages; page += 1) {
            JSONObject nextPage = readObject(
                normalizedBaseUrl + "/api/music/list?per_page=" + MUSIC_PAGE_SIZE + "&page=" + page,
                cookie,
                authorizationHeader
            );
            appendMusicPage(payload.musics, normalizedBaseUrl, nextPage.optJSONArray("musics"), albumById);
        }

        if (includeListening) {
            try {
                JSONObject listeningPayload = readObject(
                    normalizedBaseUrl + "/api/music/minute_logs?per_page=240",
                    cookie,
                    authorizationHeader
                );
                payload.listeningTimezone = nullableString(
                    listeningPayload.optString("timezone", DEFAULT_TIMEZONE)
                );
                payload.listeningSessions.addAll(
                    groupMinuteLogs(listeningPayload.optJSONArray("items"))
                );
                payload.listeningTotalMinutes = sumSessionMinutes(payload.listeningSessions);
                payload.listeningUniqueListeners = countUniqueListeners(payload.listeningSessions);
            } catch (Exception ignored) {
                payload.listeningTimezone = DEFAULT_TIMEZONE;
            }
        }

        return payload;
    }

    public static List<MusicRecord> sortAllSongsByListOrder(List<MusicRecord> musics) {
        List<MusicRecord> sortedMusics = new ArrayList<>(
            musics != null ? musics : Collections.<MusicRecord>emptyList()
        );
        Collections.sort(
            sortedMusics,
            (left, right) -> Double.compare(right.playMinutes, left.playMinutes)
        );
        return sortedMusics;
    }

    public static QueuePayload loadQueueState(String baseUrl, String cookie, List<MusicRecord> musics) {
        return loadQueueState(baseUrl, cookie, null, musics);
    }

    public static QueuePayload loadQueueState(
        String baseUrl,
        String cookie,
        String authorizationHeader,
        List<MusicRecord> musics
    ) {
        QueuePayload payload = new QueuePayload();
        Set<Integer> existingIds = new HashSet<>();
        for (MusicRecord music : musics) {
            existingIds.add(music.id);
        }

        try {
            JSONObject queueResponse = readObject(
                normalizeBaseUrl(baseUrl) + "/api/music/queue",
                cookie,
                authorizationHeader
            );
            JSONObject queue = queueResponse.optJSONObject("queue");
            if (queue != null) {
                JSONArray queueIds = queue.optJSONArray("queue_ids");
                if (queueIds != null) {
                    for (int i = 0; i < queueIds.length(); i++) {
                        int musicId = queueIds.optInt(i, -1);
                        if (existingIds.contains(musicId)) {
                            payload.queueIds.add(musicId);
                        }
                    }
                }
                Integer currentMusicId = optNullableInt(queue, "current_music_id");
                if (currentMusicId != null && existingIds.contains(currentMusicId)) {
                    payload.currentMusicId = currentMusicId;
                } else if (!payload.queueIds.isEmpty()) {
                    payload.currentMusicId = payload.queueIds.get(0);
                }
                return payload;
            }
        } catch (Exception ignored) {
        }

        try {
            JSONObject lastPlayedResponse = readObject(
                normalizeBaseUrl(baseUrl) + "/api/music/last_played",
                cookie,
                authorizationHeader
            );
            JSONObject lastPlayed = lastPlayedResponse.optJSONObject("last_played");
            Integer musicId = lastPlayed != null ? optNullableInt(lastPlayed, "music_id") : null;
            if (musicId != null && existingIds.contains(musicId)) {
                List<MusicRecord> sortedMusics = new ArrayList<>(musics);
                Collections.sort(
                    sortedMusics,
                    Comparator
                        .comparingDouble((MusicRecord music) -> music.playMinutes)
                        .reversed()
                        .thenComparing(music -> music.title != null ? music.title : "")
                );
                for (MusicRecord music : sortedMusics) {
                    payload.queueIds.add(music.id);
                }
                payload.currentMusicId = musicId;
            }
        } catch (Exception ignored) {
        }

        return payload;
    }

    public static void saveQueueState(String baseUrl, String cookie, List<Integer> queueIds, Integer currentMusicId) throws Exception {
        saveQueueState(baseUrl, cookie, null, queueIds, currentMusicId);
    }

    public static void saveQueueState(
        String baseUrl,
        String cookie,
        String authorizationHeader,
        List<Integer> queueIds,
        Integer currentMusicId
    ) throws Exception {
        JSONObject body = new JSONObject();
        JSONArray ids = new JSONArray();
        for (Integer queueId : queueIds) {
            ids.put(queueId);
        }
        body.put("queue_ids", ids);
        if (currentMusicId != null) {
            body.put("current_music_id", currentMusicId);
        } else {
            body.put("current_music_id", JSONObject.NULL);
        }
        sendJson(normalizeBaseUrl(baseUrl) + "/api/music/queue", cookie, authorizationHeader, "POST", body);
    }

    public static void addOneMinute(String baseUrl, String cookie, int musicId) throws Exception {
        addOneMinute(baseUrl, cookie, null, musicId);
    }

    public static void addOneMinute(String baseUrl, String cookie, String authorizationHeader, int musicId) throws Exception {
        sendJson(
            normalizeBaseUrl(baseUrl) + "/api/music/add_one_minute/" + musicId,
            cookie,
            authorizationHeader,
            "POST",
            null
        );
    }

    private static void appendMusicPage(
        List<MusicRecord> target,
        String baseUrl,
        JSONArray pageItems,
        Map<Integer, AlbumRecord> albumById
    ) throws Exception {
        if (pageItems == null) return;
        for (int i = 0; i < pageItems.length(); i++) {
            target.add(MusicRecord.fromJson(baseUrl, pageItems.getJSONObject(i), albumById));
        }
    }

    private static List<ListeningSessionRecord> groupMinuteLogs(JSONArray items) throws Exception {
        List<MinuteLogRecord> logs = new ArrayList<>();
        if (items != null) {
            for (int i = 0; i < items.length(); i++) {
                logs.add(new MinuteLogRecord(items.getJSONObject(i)));
            }
        }

        Collections.sort(logs, (left, right) -> {
            String leftTime = left.createdAt != null ? left.createdAt : "";
            String rightTime = right.createdAt != null ? right.createdAt : "";
            int timeCompare = leftTime.compareTo(rightTime);
            if (timeCompare != 0) return timeCompare;
            return Integer.compare(left.id, right.id);
        });

        List<ListeningSessionRecord> sessions = new ArrayList<>();
        ListeningSessionRecord currentSession = null;
        MinuteLogRecord currentLog = null;
        Long currentMinuteIndex = null;

        for (MinuteLogRecord log : logs) {
            Long minuteIndex = toMinuteIndex(log.createdAt);
            if (minuteIndex == null || log.createdAt == null) {
                continue;
            }

            if (
                currentSession != null &&
                currentLog != null &&
                currentMinuteIndex != null &&
                isSameListeningStream(currentLog, log) &&
                minuteIndex - currentMinuteIndex <= 1
            ) {
                currentSession.endAt = log.createdAt;
                currentSession.minuteCount += 1;
                currentLog = log;
                currentMinuteIndex = minuteIndex;
                continue;
            }

            currentSession = new ListeningSessionRecord(
                (log.musicUserPlayMinuteId != null ? log.musicUserPlayMinuteId : (log.musicId != null ? log.musicId : "music"))
                    + ":" + log.createdAt + ":" + log.id,
                log.musicUserPlayMinuteId,
                log.musicId,
                log.musicTitle,
                log.userId,
                log.username,
                log.displayName,
                log.createdAt,
                log.createdAt,
                1
            );
            sessions.add(currentSession);
            currentLog = log;
            currentMinuteIndex = minuteIndex;
        }

        sessions.sort((left, right) -> right.endAt.compareTo(left.endAt));
        return sessions;
    }

    private static boolean isSameListeningStream(MinuteLogRecord current, MinuteLogRecord next) {
        if (current.musicUserPlayMinuteId != null && next.musicUserPlayMinuteId != null) {
            return current.musicUserPlayMinuteId.equals(next.musicUserPlayMinuteId);
        }
        return equalsNullable(current.musicId, next.musicId)
            && equalsNullable(current.userId, next.userId)
            && equalsNullable(current.username, next.username)
            && equalsNullable(current.displayName, next.displayName);
    }

    private static <T> boolean equalsNullable(T left, T right) {
        if (left == null) return right == null;
        return left.equals(right);
    }

    private static Long toMinuteIndex(String value) {
        ParsedNaiveDate parsed = parseNaiveIso(value);
        if (parsed == null) return null;
        long totalMinutes = (((parsed.year * 12L + parsed.month) * 31L + parsed.day) * 24L + parsed.hour) * 60L + parsed.minute;
        return totalMinutes;
    }

    private static ParsedNaiveDate parseNaiveIso(String value) {
        if (value == null || value.isEmpty()) return null;
        try {
            String[] dateTime = value.split("T");
            if (dateTime.length != 2) return null;
            String[] date = dateTime[0].split("-");
            String timePart = stripIsoTimeZone(dateTime[1]);
            String[] time = timePart.split(":");
            if (date.length != 3 || time.length < 2) return null;
            ParsedNaiveDate parsed = new ParsedNaiveDate();
            parsed.year = Integer.parseInt(date[0]);
            parsed.month = Integer.parseInt(date[1]);
            parsed.day = Integer.parseInt(date[2]);
            parsed.hour = Integer.parseInt(time[0]);
            parsed.minute = Integer.parseInt(time[1]);
            parsed.second = time.length > 2 ? Integer.parseInt(stripFractionalSecond(time[2])) : 0;
            return parsed;
        } catch (Exception e) {
            return null;
        }
    }

    private static String stripIsoTimeZone(String value) {
        int zIndex = value.indexOf('Z');
        int plusIndex = value.indexOf('+');
        int minusIndex = value.indexOf('-', 1);
        int cutoff = -1;
        if (zIndex >= 0) cutoff = zIndex;
        if (plusIndex >= 0) cutoff = cutoff < 0 ? plusIndex : Math.min(cutoff, plusIndex);
        if (minusIndex >= 0) cutoff = cutoff < 0 ? minusIndex : Math.min(cutoff, minusIndex);
        return cutoff >= 0 ? value.substring(0, cutoff) : value;
    }

    private static String stripFractionalSecond(String value) {
        int dotIndex = value.indexOf('.');
        return dotIndex >= 0 ? value.substring(0, dotIndex) : value;
    }

    private static int sumSessionMinutes(List<ListeningSessionRecord> sessions) {
        int total = 0;
        for (ListeningSessionRecord session : sessions) {
            total += Math.max(0, session.minuteCount);
        }
        return total;
    }

    private static int countUniqueListeners(List<ListeningSessionRecord> sessions) {
        Set<String> seen = new LinkedHashSet<>();
        for (ListeningSessionRecord session : sessions) {
            seen.add(
                (session.userId != null ? session.userId : "")
                    + ":" + (session.username != null ? session.username : "")
                    + ":" + (session.displayName != null ? session.displayName : "")
            );
        }
        return seen.size();
    }

    private static class ParsedNaiveDate {
        int year;
        int month;
        int day;
        int hour;
        int minute;
        int second;
    }

    private static JSONArray readArray(String url, String cookie, String authorizationHeader) throws Exception {
        return new JSONArray(readText(url, cookie, authorizationHeader, "GET", null));
    }

    private static JSONObject readObject(String url, String cookie, String authorizationHeader) throws Exception {
        return new JSONObject(readText(url, cookie, authorizationHeader, "GET", null));
    }

    private static JSONObject sendJson(
        String url,
        String cookie,
        String authorizationHeader,
        String method,
        JSONObject body
    ) throws Exception {
        String text = readText(url, cookie, authorizationHeader, method, body != null ? body.toString() : "");
        if (text == null || text.trim().isEmpty()) {
            return new JSONObject();
        }
        return new JSONObject(text);
    }

    private static String readText(
        String urlString,
        String cookie,
        String authorizationHeader,
        String method,
        String body
    ) throws Exception {
        HttpURLConnection connection = null;
        InputStream input = null;
        try {
            URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(8_000);
            connection.setReadTimeout(20_000);
            connection.setRequestProperty("Accept", "application/json");
            if (authorizationHeader != null && !authorizationHeader.isEmpty()) {
                connection.setRequestProperty("Authorization", authorizationHeader);
            } else if (cookie != null && !cookie.isEmpty()) {
                connection.setRequestProperty("Cookie", cookie);
            }
            if (body != null && ("POST".equals(method) || "PUT".equals(method))) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Content-Length", String.valueOf(bytes.length));
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }
            }
            int status = connection.getResponseCode();
            boolean ok = status >= 200 && status < 300;
            input = ok ? connection.getInputStream() : connection.getErrorStream();
            String text = readAll(input);
            if (!ok) {
                throw new IOException("HTTP " + status + " for " + urlString + ": " + text);
            }
            return text;
        } finally {
            if (input != null) {
                try { input.close(); } catch (IOException ignored) {}
            }
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String readAll(InputStream input) throws IOException {
        if (input == null) return "";
        BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
        StringBuilder builder = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            builder.append(line);
        }
        return builder.toString();
    }

    private static double optDouble(JSONObject data, String key) {
        try {
            return data.has(key) && !data.isNull(key) ? data.getDouble(key) : 0.0;
        } catch (Exception ignored) {
            return 0.0;
        }
    }

    private static Integer optNullableInt(JSONObject data, String key) {
        try {
            return data.has(key) && !data.isNull(key) ? data.getInt(key) : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static Long optNullableLong(JSONObject data, String key) {
        try {
            return data.has(key) && !data.isNull(key) ? data.getLong(key) : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String nullableString(String value) {
        return value == null || value.isEmpty() ? null : value;
    }

    private static String normalizeRemoteCoverUrl(String preferredUrl, String fallbackUrl) {
        String directPreferred = nullableString(preferredUrl);
        if (directPreferred != null && (directPreferred.startsWith("http://") || directPreferred.startsWith("https://"))) {
            return directPreferred;
        }

        String filename = extractCoverFilename(directPreferred);
        if (filename == null) {
            filename = extractCoverFilename(fallbackUrl);
        }
        if (filename != null) {
            return REMOTE_COVER_ROOT + "/" + filename;
        }

        return REMOTE_COVER_ROOT + "/defult.jpeg";
    }

    private static String extractCoverFilename(String coverUrl) {
        String raw = nullableString(coverUrl);
        if (raw == null) {
            return null;
        }
        String sanitized = raw.split("#")[0].split("\\?")[0];
        String[] parts = sanitized.split("/");
        if (parts.length == 0) {
            return null;
        }
        String filename = parts[parts.length - 1];
        return filename == null || filename.isEmpty() ? null : filename;
    }

    private static String normalizeCoverUrl(String baseUrl, String coverUrl) {
        return normalizeCoverUrl(baseUrl, coverUrl, null);
    }

    private static String normalizeCoverUrl(String baseUrl, String coverUrl, String fallbackUrl) {
        if (coverUrl == null || coverUrl.trim().isEmpty()) {
            String filename = extractCoverFilename(fallbackUrl);
            if (filename != null) {
                return normalizeBaseUrl(baseUrl) + "/api/music/album_cover/" + filename;
            }
            return normalizeBaseUrl(baseUrl) + "/api/music/album_cover/defult.jpeg";
        }
        if (coverUrl.startsWith("http://") || coverUrl.startsWith("https://")) {
            return coverUrl;
        }
        if (coverUrl.startsWith("/")) {
            return normalizeBaseUrl(baseUrl) + coverUrl;
        }
        String[] parts = coverUrl.split("/");
        String filename = parts.length > 0 ? parts[parts.length - 1] : coverUrl;
        return normalizeBaseUrl(baseUrl) + "/api/music/album_cover/" + filename;
    }
}
