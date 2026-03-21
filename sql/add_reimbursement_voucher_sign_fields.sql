ALTER TABLE reimbursement_request
    ADD COLUMN voucher_recipient_name VARCHAR(160) NULL,
    ADD COLUMN voucher_recipient_sign_json TEXT NULL,
    ADD COLUMN voucher_signed_at DATETIME NULL;
