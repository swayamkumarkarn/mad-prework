CREATE TYPE "RsvpStatus" AS ENUM ('CONFIRMED', 'WAITLISTED', 'CANCELLED');
CREATE TYPE "OutboxEventType" AS ENUM ('RSVP_CREATED', 'RSVP_CANCELLED', 'RSVP_PROMOTED');

CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Event_capacity_positive" CHECK ("capacity" > 0)
);

CREATE TABLE "Rsvp" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "RsvpStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "Rsvp_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Rsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "type" "OutboxEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Rsvp_eventId_status_idx" ON "Rsvp"("eventId", "status");
CREATE INDEX "Rsvp_eventId_createdAt_idx" ON "Rsvp"("eventId", "createdAt");
CREATE UNIQUE INDEX "Rsvp_active_event_email_key" ON "Rsvp"("eventId", "email") WHERE "status" <> 'CANCELLED';
CREATE UNIQUE INDEX "IdempotencyRecord_key_scope_key" ON "IdempotencyRecord"("key", "scope");
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");
