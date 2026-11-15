-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CLIENT', 'TECHNICIAN', 'ADMIN');

-- CreateEnum
CREATE TYPE "TechnicianApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('ELECTRICITY', 'PLUMBING', 'GAS', 'LOCKSMITH', 'MASONRY');

-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Technician" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "approvalStatus" "TechnicianApprovalStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Technician_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianSpecialty" (
    "technicianId" UUID NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "licenseNumber" TEXT,

    CONSTRAINT "TechnicianSpecialty_pkey" PRIMARY KEY ("technicianId","category")
);

-- CreateTable
CREATE TABLE "Neighborhood" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Neighborhood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianNeighborhood" (
    "technicianId" UUID NOT NULL,
    "neighborhoodId" UUID NOT NULL,

    CONSTRAINT "TechnicianNeighborhood_pkey" PRIMARY KEY ("technicianId","neighborhoodId")
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "technicianId" UUID,
    "neighborhoodId" UUID NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "addressLine" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" UUID,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceOffer" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "technicianId" UUID NOT NULL,
    "status" "ServiceOfferStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ServiceOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Technician_userId_key" ON "Technician"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Neighborhood_name_key" ON "Neighborhood"("name");

-- CreateIndex
CREATE INDEX "ServiceOffer_requestId_technicianId_status_idx" ON "ServiceOffer"("requestId", "technicianId", "status");

-- CreateIndex
CREATE INDEX "ServiceOffer_technicianId_status_expiresAt_idx" ON "ServiceOffer"("technicianId", "status", "expiresAt");

-- AddForeignKey
ALTER TABLE "Technician" ADD CONSTRAINT "Technician_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianSpecialty" ADD CONSTRAINT "TechnicianSpecialty_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianNeighborhood" ADD CONSTRAINT "TechnicianNeighborhood_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianNeighborhood" ADD CONSTRAINT "TechnicianNeighborhood_neighborhoodId_fkey" FOREIGN KEY ("neighborhoodId") REFERENCES "Neighborhood"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_neighborhoodId_fkey" FOREIGN KEY ("neighborhoodId") REFERENCES "Neighborhood"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOffer" ADD CONSTRAINT "ServiceOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOffer" ADD CONSTRAINT "ServiceOffer_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOffer_one_pending_per_request"
ON "ServiceOffer" ("requestId")
WHERE "status" = 'PENDING';

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOffer_one_accepted_per_request"
ON "ServiceOffer" ("requestId")
WHERE "status" = 'ACCEPTED';

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequest_one_active_per_technician"
ON "ServiceRequest" ("technicianId")
WHERE "technicianId" IS NOT NULL
  AND "status" IN ('ACCEPTED', 'IN_PROGRESS');
