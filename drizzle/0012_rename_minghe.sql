-- 夜明河 is officially 明河 (src/data/endfield-operators.json); players who picked it keep it.
-- Declarations keep the name as it was said.
UPDATE "users" SET "fav_endfield" = array_replace("fav_endfield", '夜明河', '明河') WHERE '夜明河' = ANY("fav_endfield");
