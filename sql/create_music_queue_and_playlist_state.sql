CREATE TABLE IF NOT EXISTS music_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    queue_json TEXT NOT NULL,
    current_music_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_music_queue_user_id (user_id),
    CONSTRAINT fk_music_queue_user
        FOREIGN KEY (user_id) REFERENCES user_data(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_music_queue_current_music
        FOREIGN KEY (current_music_id) REFERENCES music(id)
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS playlist_state (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    active_playlist_id INT NULL,
    current_music_id INT NULL,
    playback_time DOUBLE NOT NULL DEFAULT 0,
    was_playing TINYINT(1) NOT NULL DEFAULT 0,
    panel_view VARCHAR(20) NULL,
    is_expanded TINYINT(1) NULL,
    state_json TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_playlist_state_user_id (user_id),
    CONSTRAINT fk_playlist_state_user
        FOREIGN KEY (user_id) REFERENCES user_data(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_playlist_state_playlist
        FOREIGN KEY (active_playlist_id) REFERENCES playlist(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_playlist_state_current_music
        FOREIGN KEY (current_music_id) REFERENCES music(id)
        ON DELETE SET NULL ON UPDATE CASCADE
);
