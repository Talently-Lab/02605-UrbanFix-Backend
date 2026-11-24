-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PreferredTime" AS ENUM ('MORNING', 'AFTERNOON', 'ANY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ServiceOfferStatus" ADD VALUE 'RELEASED';
ALTER TYPE "ServiceOfferStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "ServiceRequest" DROP COLUMN "addressLine",
ADD COLUMN     "apartment" TEXT,
ADD COLUMN     "directions" TEXT,
ADD COLUMN     "floor" TEXT,
ADD COLUMN     "preferredTime" "PreferredTime" NOT NULL DEFAULT 'ANY',
ADD COLUMN     "street" TEXT NOT NULL,
ADD COLUMN     "streetNumber" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "phone" TEXT;

-- Enforce case-insensitive email uniqueness.
CREATE UNIQUE INDEX "User_email_case_insensitive"
ON "User" (LOWER("email"));

-- Enforce phone requirements according to user role.
ALTER TABLE "User"
ADD CONSTRAINT "User_phone_by_role"
CHECK (
  (
    "role" = 'CLIENT'
    AND "phone" IS NOT NULL
    AND LENGTH(TRIM("phone")) > 0
  )
  OR
  (
    "role" IN ('TECHNICIAN', 'ADMIN')
    AND "phone" IS NULL
  )
);