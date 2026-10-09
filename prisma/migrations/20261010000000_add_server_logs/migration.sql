CREATE TABLE "ServerLog" (
    "id" UUID NOT NULL,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServerLog_createdAt_idx" ON "ServerLog"("createdAt");
CREATE INDEX "ServerLog_level_createdAt_idx" ON "ServerLog"("level", "createdAt");
CREATE INDEX "ServerLog_source_createdAt_idx" ON "ServerLog"("source", "createdAt");
