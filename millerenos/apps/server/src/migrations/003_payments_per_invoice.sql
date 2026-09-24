-- A second transfer/charge can arrive for an invoice that is already paid (double payment, late crypto transfer).
-- It must be recorded and flagged for review, not rejected by a constraint (which would make providers retry forever).
ALTER TABLE payments DROP CONSTRAINT payments_invoice_id_key;
CREATE INDEX payments_invoice_idx ON payments (invoice_id);
