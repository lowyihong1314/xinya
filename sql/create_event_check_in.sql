CREATE TABLE IF NOT EXISTS `event_check_in` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `event_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `check_in_date` DATE NOT NULL,
  `check_in_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `valid_user_id` INT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_check_in_event_user_date` (`event_id`, `user_id`, `check_in_date`),
  KEY `ix_event_check_in_event_id` (`event_id`),
  KEY `ix_event_check_in_user_id` (`user_id`),
  KEY `ix_event_check_in_check_in_date` (`check_in_date`),
  KEY `ix_event_check_in_check_in_time` (`check_in_time`),
  KEY `ix_event_check_in_valid_user_id` (`valid_user_id`),
  CONSTRAINT `fk_event_check_in_event_id`
    FOREIGN KEY (`event_id`) REFERENCES `event_data` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_event_check_in_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `user_data` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_event_check_in_valid_user_id`
    FOREIGN KEY (`valid_user_id`) REFERENCES `user_data` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
);
