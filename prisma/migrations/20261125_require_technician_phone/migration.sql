ALTER TABLE "User"
DROP CONSTRAINT "User_phone_by_role",
ADD CONSTRAINT "User_phone_by_role"
CHECK (
  (
    "role" IN ('CLIENT', 'TECHNICIAN')
    AND "phone" IS NOT NULL
    AND LENGTH(TRIM("phone")) > 0
  )
  OR
  (
    "role" = 'ADMIN'
    AND "phone" IS NULL
  )
);
