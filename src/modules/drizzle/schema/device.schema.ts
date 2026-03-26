import { createId } from '@paralleldrive/cuid2';
import { pgTable, text, varchar, timestamp } from 'drizzle-orm/pg-core';

export const devices = pgTable('devices', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  deviceId: text().unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  storeLoc: text().notNull(),
});
