ALTER TABLE regis_form
  ADD COLUMN other_remark TINYINT(1) NOT NULL DEFAULT 0 AFTER address;

ALTER TABLE regis_member_data
  ADD COLUMN other_remark TEXT NULL AFTER allergy;
