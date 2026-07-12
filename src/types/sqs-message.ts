import { CreateStoreSyncRecord } from 'src/modules/sync/dto/create-store-sync-record.dto';

export interface QueueMessage<TType extends string, TPayload> {
  type: TType;
  payload: TPayload;
  createdAt: string;
}

export interface TestingMessage {
  message: string;
  name: string;
}

export interface SyncMessage {
  payload: CreateStoreSyncRecord;
  syncRecords: {
    id: string;
    storesId: string;
  }[];
}

export type AppQueueMessage = QueueMessage<'SYNC_RECORDS', SyncMessage>;
