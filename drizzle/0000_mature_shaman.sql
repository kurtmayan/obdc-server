CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"deviceId" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"storeLoc" text NOT NULL,
	CONSTRAINT "devices_deviceId_unique" UNIQUE("deviceId")
);
