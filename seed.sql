-- ============================================================
-- seed.sql — Kbeans (Toko Biji Kopi)
-- Data awal: kategori, atribut kopi, dan produk contoh
-- ============================================================

-- ---------- CATEGORIES ----------
INSERT INTO categories (id, name, slug, icon, description) VALUES
('cat-single-origin', 'Single Origin', 'single-origin', 'coffee', 'Biji kopi dari satu daerah/kebun tertentu, dengan karakter rasa khas'),
('cat-blend', 'Blend', 'blend', 'layers', 'Campuran beberapa jenis biji kopi untuk rasa yang seimbang'),
('cat-ground', 'Ground Coffee', 'ground-coffee', 'package', 'Kopi bubuk siap seduh'),
('cat-cold-brew', 'Cold Brew Bag', 'cold-brew', 'droplet', 'Kantong cold brew siap rendam'),
('cat-gift-set', 'Gift Set & Bundle', 'gift-set', 'gift', 'Paket hadiah kopi berisi beberapa varian');

-- ---------- COFFEE ATTRIBUTES ----------
INSERT INTO coffee_attributes (id, name, slug, badge_color) VALUES
('attr-arabica', 'Arabica', 'arabica', 'emerald'),
('attr-robusta', 'Robusta', 'robusta', 'amber'),
('attr-decaf', 'Decaf', 'decaf', 'slate'),
('attr-organic', 'Organic', 'organic', 'green'),
('attr-fair-trade', 'Fair Trade', 'fair-trade', 'blue'),
('attr-light-roast', 'Light Roast', 'light-roast', 'yellow'),
('attr-medium-roast', 'Medium Roast', 'medium-roast', 'orange'),
('attr-dark-roast', 'Dark Roast', 'dark-roast', 'stone');

-- ---------- PRODUCTS ----------
INSERT INTO products (id, name, slug, description, category_id, price, unit, stock_quantity, image_url, origin, roast_level, processing_method, tasting_notes, is_featured, is_bundle) VALUES
('prod-toraja-arabica', 'Toraja Arabica', 'toraja-arabica', 'Kopi arabica premium dari dataran tinggi Toraja dengan body tebal dan keasaman rendah.', 'cat-single-origin', 95000, '250 g', 20, '/images/toraja-arabica.jpg', 'Toraja, Sulawesi Selatan', 'medium', 'Full Wash', 'Cokelat, rempah, sedikit earthy', 1, 0),
('prod-minahasa-arabica', 'Minahasa Arabica', 'minahasa-arabica', 'Kopi arabica lokal dari pegunungan Minahasa, aroma floral dengan after-taste manis.', 'cat-single-origin', 85000, '250 g', 25, '/images/minahasa-arabica.jpg', 'Minahasa, Sulawesi Utara', 'light', 'Natural', 'Bunga, madu, jeruk nipis', 1, 0),
('prod-gayo-arabica', 'Gayo Arabica', 'gayo-arabica', 'Kopi legendaris dari dataran tinggi Gayo, Aceh, dengan body penuh dan keasaman seimbang.', 'cat-single-origin', 98000, '250 g', 15, '/images/gayo-arabica.jpg', 'Gayo, Aceh', 'medium', 'Semi Wash', 'Cokelat pekat, rempah hangat', 0, 0),
('prod-kintamani-arabica', 'Kintamani Arabica', 'kintamani-arabica', 'Kopi arabica Bali yang ditanam berdampingan dengan tanaman jeruk, memberi aroma citrus khas.', 'cat-single-origin', 90000, '250 g', 18, '/images/kintamani-arabica.jpg', 'Kintamani, Bali', 'light', 'Full Wash', 'Jeruk, karamel ringan', 0, 0),
('prod-manado-robusta', 'Manado Robusta', 'manado-robusta', 'Robusta lokal dengan body kuat dan pahit yang seimbang, cocok untuk kopi tubruk.', 'cat-single-origin', 55000, '250 g', 40, '/images/manado-robusta.jpg', 'Tomohon, Sulawesi Utara', 'dark', 'Natural', 'Cokelat pahit, kacang panggang', 0, 0),
('prod-lampung-robusta', 'Lampung Robusta', 'lampung-robusta', 'Robusta klasik dari Lampung, salah satu penghasil robusta terbesar di Indonesia.', 'cat-single-origin', 50000, '250 g', 35, '/images/lampung-robusta.jpg', 'Lampung', 'dark', 'Natural', 'Earthy, cokelat pahit', 0, 0),
('prod-sunrise-blend', 'Sunrise Blend', 'sunrise-blend', 'Perpaduan arabica dan robusta pilihan untuk kopi pagi yang seimbang antara asam dan pahit.', 'cat-blend', 70000, '250 g', 30, '/images/sunrise-blend.jpg', 'Blend Nusantara', 'medium', 'Blend', 'Karamel, kacang, cokelat susu', 1, 0),
('prod-house-blend', 'Kbeans House Blend', 'house-blend', 'Signature blend racikan Kbeans, dirancang untuk espresso maupun manual brew.', 'cat-blend', 75000, '250 g', 30, '/images/house-blend.jpg', 'Blend Nusantara', 'medium', 'Blend', 'Cokelat, karamel, gurih', 1, 0),
('prod-espresso-blend', 'Espresso Dark Blend', 'espresso-dark-blend', 'Blend gelap khusus mesin espresso dengan crema tebal dan rasa yang bold.', 'cat-blend', 78000, '250 g', 22, '/images/espresso-blend.jpg', 'Blend Nusantara', 'dark', 'Blend', 'Cokelat hitam, smoky, pahit kuat', 0, 0),
('prod-ground-toraja', 'Toraja Arabica Bubuk', 'toraja-arabica-bubuk', 'Toraja Arabica yang sudah digiling halus, siap seduh dengan cara tubruk maupun V60.', 'cat-ground', 92000, '250 g', 20, '/images/ground-toraja.jpg', 'Toraja, Sulawesi Selatan', 'medium', 'Full Wash', 'Cokelat, rempah', 0, 0),
('prod-ground-housblend', 'House Blend Bubuk', 'house-blend-bubuk', 'House Blend Kbeans dalam bentuk bubuk, praktis untuk kopi tubruk sehari-hari.', 'cat-ground', 72000, '250 g', 28, '/images/ground-house.jpg', 'Blend Nusantara', 'medium', 'Blend', 'Cokelat, karamel', 0, 0),
('prod-decaf-blend', 'Decaf Gentle Blend', 'decaf-gentle-blend', 'Kopi tanpa kafein untuk kamu yang tetap ingin menikmati kopi tanpa efek begadang.', 'cat-ground', 80000, '250 g', 12, '/images/decaf-blend.jpg', 'Blend Nusantara', 'medium', 'Swiss Water Process', 'Cokelat lembut, sedikit manis', 0, 0),
('prod-coldbrew-minahasa', 'Cold Brew Bag Minahasa', 'cold-brew-bag-minahasa', 'Kantong cold brew berisi Minahasa Arabica, tinggal rendam di air dingin semalaman.', 'cat-cold-brew', 45000, '5 sachet', 25, '/images/coldbrew-minahasa.jpg', 'Minahasa, Sulawesi Utara', 'light', 'Natural', 'Segar, buah, floral', 1, 0),
('prod-coldbrew-toraja', 'Cold Brew Bag Toraja', 'cold-brew-bag-toraja', 'Kantong cold brew berisi Toraja Arabica, praktis untuk kopi dingin di cuaca panas.', 'cat-cold-brew', 47000, '5 sachet', 20, '/images/coldbrew-toraja.jpg', 'Toraja, Sulawesi Selatan', 'medium', 'Full Wash', 'Cokelat, halus', 0, 0),
('prod-nusantara-explorer', 'Nusantara Explorer Set', 'nusantara-explorer-set', 'Paket 4 varian biji kopi single origin Nusantara (Toraja, Minahasa, Gayo, Kintamani) @100g, cocok untuk hadiah atau eksplorasi rasa.', 'cat-gift-set', 180000, '4 x 100 g', 10, '/images/nusantara-explorer.jpg', 'Berbagai daerah, Indonesia', 'medium', 'Campuran', 'Beragam sesuai origin', 1, 1),
('prod-kbeans-starter-kit', 'Kbeans Starter Kit', 'kbeans-starter-kit', 'Paket pemula: House Blend 250g + panduan mini seduh manual di rumah.', 'cat-gift-set', 95000, '1 paket', 15, '/images/starter-kit.jpg', 'Blend Nusantara', 'medium', 'Blend', 'Cokelat, karamel', 0, 1);

-- ---------- PRODUCT ↔ ATTRIBUTE RELATIONS ----------
INSERT INTO product_coffee_attributes (product_id, attribute_id) VALUES
('prod-toraja-arabica', 'attr-arabica'),
('prod-toraja-arabica', 'attr-medium-roast'),
('prod-toraja-arabica', 'attr-fair-trade'),

('prod-minahasa-arabica', 'attr-arabica'),
('prod-minahasa-arabica', 'attr-light-roast'),
('prod-minahasa-arabica', 'attr-organic'),

('prod-gayo-arabica', 'attr-arabica'),
('prod-gayo-arabica', 'attr-medium-roast'),
('prod-gayo-arabica', 'attr-fair-trade'),
('prod-gayo-arabica', 'attr-organic'),

('prod-kintamani-arabica', 'attr-arabica'),
('prod-kintamani-arabica', 'attr-light-roast'),

('prod-manado-robusta', 'attr-robusta'),
('prod-manado-robusta', 'attr-dark-roast'),

('prod-lampung-robusta', 'attr-robusta'),
('prod-lampung-robusta', 'attr-dark-roast'),

('prod-sunrise-blend', 'attr-arabica'),
('prod-sunrise-blend', 'attr-robusta'),
('prod-sunrise-blend', 'attr-medium-roast'),

('prod-house-blend', 'attr-arabica'),
('prod-house-blend', 'attr-robusta'),
('prod-house-blend', 'attr-medium-roast'),

('prod-espresso-blend', 'attr-arabica'),
('prod-espresso-blend', 'attr-robusta'),
('prod-espresso-blend', 'attr-dark-roast'),

('prod-ground-toraja', 'attr-arabica'),
('prod-ground-toraja', 'attr-medium-roast'),

('prod-ground-housblend', 'attr-arabica'),
('prod-ground-housblend', 'attr-robusta'),
('prod-ground-housblend', 'attr-medium-roast'),

('prod-decaf-blend', 'attr-decaf'),
('prod-decaf-blend', 'attr-medium-roast'),

('prod-coldbrew-minahasa', 'attr-arabica'),
('prod-coldbrew-minahasa', 'attr-light-roast'),
('prod-coldbrew-minahasa', 'attr-organic'),

('prod-coldbrew-toraja', 'attr-arabica'),
('prod-coldbrew-toraja', 'attr-medium-roast'),

('prod-nusantara-explorer', 'attr-arabica'),
('prod-nusantara-explorer', 'attr-fair-trade'),

('prod-kbeans-starter-kit', 'attr-arabica'),
('prod-kbeans-starter-kit', 'attr-robusta'),
('prod-kbeans-starter-kit', 'attr-medium-roast');
