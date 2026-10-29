-- Furniture, bags and gaming were folded into Home, Fashion and Electronics.
UPDATE products SET category = 'home' WHERE category = 'furniture';
UPDATE products SET category = 'fashion' WHERE category = 'bags';
UPDATE products SET category = 'electronics' WHERE category = 'gaming';
UPDATE shops SET category = 'home' WHERE category = 'furniture';
UPDATE shops SET category = 'fashion' WHERE category = 'bags';
UPDATE shops SET category = 'electronics' WHERE category = 'gaming';
UPDATE buying_requests SET category = 'home' WHERE category = 'furniture';
UPDATE buying_requests SET category = 'fashion' WHERE category = 'bags';
UPDATE buying_requests SET category = 'electronics' WHERE category = 'gaming';

-- New, refurbished or used (second-hand).
ALTER TABLE products ADD COLUMN condition TEXT NOT NULL DEFAULT 'new' CHECK (condition IN ('new', 'refurbished', 'used'));

-- When the buyer was asked to confirm a parcel that is about to be marked delivered automatically (once).
ALTER TABLE shipments ADD COLUMN receipt_reminded_at TIMESTAMPTZ;
