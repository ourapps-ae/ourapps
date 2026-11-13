-- Recipes name slots; a component version records what the fit rule reads. Stored versions have neither, so every
-- version is removed and published again; entries keep their names and owners.
DELETE FROM catalogue_fts;
DROP TABLE recipe_components;
DELETE FROM recipe_versions;
DELETE FROM component_versions;
UPDATE recipes SET latest_version = NULL;
UPDATE components SET latest_version = NULL;

ALTER TABLE component_versions ADD COLUMN settings TEXT NOT NULL DEFAULT '[]';
ALTER TABLE component_versions ADD COLUMN interface_digests TEXT NOT NULL DEFAULT '{}';
ALTER TABLE component_versions ADD COLUMN interface_modules TEXT NOT NULL DEFAULT '{}';

-- Each slot of a recipe version with the component versions that may fill it: the preferred one (preferred = 1) and
-- the job candidates. For "used by" and the deprecation tree.
CREATE TABLE recipe_slots (
  recipe_id TEXT NOT NULL,
  version TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  component_name TEXT NOT NULL,
  component_version TEXT NOT NULL,
  preferred INTEGER NOT NULL CHECK (preferred IN (0, 1)),
  included_when TEXT,
  PRIMARY KEY (recipe_id, version, slot_id, component_name, component_version),
  FOREIGN KEY (recipe_id, version) REFERENCES recipe_versions(recipe_id, version) ON DELETE CASCADE
);
CREATE INDEX recipe_slots_component ON recipe_slots(component_name, component_version);
