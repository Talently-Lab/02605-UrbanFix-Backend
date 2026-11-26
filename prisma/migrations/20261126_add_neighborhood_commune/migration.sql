BEGIN;

-- Add commune as a temporarily nullable column.
ALTER TABLE "Neighborhood"
ADD COLUMN "comuna" INTEGER;

-- Backfill existing neighborhoods using the official catalog.
UPDATE "Neighborhood" AS n
SET "comuna" = catalog.comuna
FROM (
  VALUES
    ('Agronomía', 15),
    ('Almagro', 5),
    ('Balvanera', 3),
    ('Barracas', 4),
    ('Belgrano', 13),
    ('Boedo', 5),
    ('Caballito', 6),
    ('Chacarita', 15),
    ('Coghlan', 12),
    ('Colegiales', 13),
    ('Constitución', 1),
    ('Flores', 7),
    ('Floresta', 10),
    ('La Boca', 4),
    ('La Paternal', 15),
    ('Liniers', 9),
    ('Mataderos', 9),
    ('Monserrat', 1),
    ('Monte Castro', 10),
    ('Nueva Pompeya', 4),
    ('Núñez', 13),
    ('Palermo', 14),
    ('Parque Avellaneda', 9),
    ('Parque Chacabuco', 7),
    ('Parque Chas', 15),
    ('Parque Patricios', 4),
    ('Puerto Madero', 1),
    ('Recoleta', 2),
    ('Retiro', 1),
    ('Saavedra', 12),
    ('San Cristóbal', 3),
    ('San Nicolás', 1),
    ('San Telmo', 1),
    ('Vélez Sarsfield', 10),
    ('Versalles', 10),
    ('Villa Crespo', 15),
    ('Villa del Parque', 11),
    ('Villa Devoto', 11),
    ('Villa General Mitre', 11),
    ('Villa Lugano', 8),
    ('Villa Luro', 10),
    ('Villa Ortúzar', 15),
    ('Villa Pueyrredón', 12),
    ('Villa Real', 10),
    ('Villa Riachuelo', 8),
    ('Villa Santa Rita', 11),
    ('Villa Soldati', 8),
    ('Villa Urquiza', 12)
) AS catalog(name, comuna)
WHERE n."name" = catalog.name;

-- Reject unknown neighborhoods.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Neighborhood"
    WHERE "comuna" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot assign commune to unknown neighborhoods';
  END IF;
END;
$$;

-- Enforce data integrity.
ALTER TABLE "Neighborhood"
ALTER COLUMN "comuna" SET NOT NULL,
ADD CONSTRAINT "Neighborhood_comuna_range"
CHECK ("comuna" BETWEEN 1 AND 15);

COMMIT;