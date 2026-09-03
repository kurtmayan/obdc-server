import { CreateStoreSyncRecord } from 'src/modules/sync/dto/create-store-sync-record.dto';

export interface QueueMessage<TType extends string, TPayload> {
  type: TType;
  payload: TPayload;
  createdAt: string;
}

export type MyHrTriggerSource = 'CRON' | 'MANUAL' | 'CONTINUATION';

export interface StartMyHrSyncMessage {
  triggerId: string;
  source: MyHrTriggerSource;
  scheduledFor: string;
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

export interface SyncChunkMessage {
  chunkId: string;
}

export type AppQueueMessage =
  | QueueMessage<'SYNC_RECORDS', SyncMessage>
  | QueueMessage<'SYNC_RECORD_CHUNK', SyncChunkMessage>
  | QueueMessage<'SYNC_MY_HR_CHUNK', SyncChunkMessage>
  | VersionedQueueMessage<'START_MY_HR_SYNC', StartMyHrSyncMessage>
  | VersionedQueueMessage<'SYNC_MY_HR_CHUNK', SyncChunkMessage>
  | VersionedQueueMessage<
      'CHECK_MY_HR_BATCH',
      SyncChunkMessage & { batchId: string }
    >;

export interface VersionedQueueMessage<
  TType extends string,
  TPayload,
> extends QueueMessage<TType, TPayload> {
  version: 1;
}

export type MyHrQueueMessage = Extract<
  AppQueueMessage,
  | { type: 'START_MY_HR_SYNC' }
  | { type: 'SYNC_MY_HR_CHUNK' }
  | { type: 'CHECK_MY_HR_BATCH' }
>;
