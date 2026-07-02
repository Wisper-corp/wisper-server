-- CreateTable
CREATE TABLE "industries" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT NOT NULL,

    CONSTRAINT "industries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "industries_name_key" ON "industries"("name");

-- CreateIndex
CREATE INDEX "industries_name_idx" ON "industries"("name");

-- CreateIndex
CREATE INDEX "industries_sector_idx" ON "industries"("sector");
