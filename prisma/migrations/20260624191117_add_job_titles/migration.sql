-- CreateTable
CREATE TABLE "job_titles" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "job_titles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_titles_title_key" ON "job_titles"("title");

-- CreateIndex
CREATE INDEX "job_titles_title_idx" ON "job_titles"("title");
