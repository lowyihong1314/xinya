ALTER TABLE regis_form
  ADD COLUMN address TINYINT(1) NOT NULL DEFAULT 0 AFTER allergy;

ALTER TABLE regis_member_data
  ADD COLUMN address TEXT NULL AFTER email;
