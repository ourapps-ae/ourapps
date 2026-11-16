-- A published version records its package foundations: independent classes, platforms, sources, compatibility and
-- maintenance. Stored versions have none, so every version is removed and published again; entries keep their names
-- and owners.
DELETE FROM catalogue_fts;
DELETE FROM recipe_slots;
DELETE FROM recipe_versions;
DELETE FROM component_versions;
UPDATE recipes SET latest_version = NULL;
UPDATE components SET latest_version = NULL;

ALTER TABLE component_versions ADD COLUMN foundations TEXT CHECK (foundations IS NULL OR json_valid(foundations));
ALTER TABLE recipe_versions ADD COLUMN foundations TEXT CHECK (foundations IS NULL OR json_valid(foundations));
