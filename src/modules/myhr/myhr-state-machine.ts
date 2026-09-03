import { MyHrChunkStatus, MyHrJobStatus } from 'src/generated/prisma/enums';

export type MyHrChunkSummaryInput = {
  status: MyHrChunkStatus;
  totalRecords: number;
  errorMessage?: string | null;
};

export type MyHrJobSummary = {
  status: MyHrJobStatus;
  successfulRecords: number;
  failedRecords: number;
  reviewRecords: number;
  errorMessage: string | null;
};

export function deriveMyHrJobSummary(
  chunks: MyHrChunkSummaryInput[],
): MyHrJobSummary {
  const successfulRecords = sumRecords(chunks, MyHrChunkStatus.SUCCESS);
  const failedRecords = sumRecords(chunks, MyHrChunkStatus.FAILED);
  const reviewRecords = sumRecords(chunks, MyHrChunkStatus.UNKNOWN);
  const incomplete = chunks.some(
    (chunk) =>
      chunk.status === MyHrChunkStatus.PENDING ||
      chunk.status === MyHrChunkStatus.UPLOADING ||
      chunk.status === MyHrChunkStatus.VERIFYING,
  );

  let status: MyHrJobStatus = MyHrJobStatus.PROCESSING;
  if (!incomplete) {
    if (reviewRecords > 0) status = MyHrJobStatus.NEEDS_REVIEW;
    else if (failedRecords === 0) status = MyHrJobStatus.SUCCESS;
    else if (successfulRecords > 0) status = MyHrJobStatus.PARTIAL_SUCCESS;
    else status = MyHrJobStatus.FAILED;
  }

  const errorMessage =
    chunks.find((chunk) => chunk.status === MyHrChunkStatus.UNKNOWN)
      ?.errorMessage ??
    chunks.find((chunk) => chunk.status === MyHrChunkStatus.FAILED)
      ?.errorMessage ??
    null;

  return {
    status,
    successfulRecords,
    failedRecords,
    reviewRecords,
    errorMessage,
  };
}

function sumRecords(
  chunks: MyHrChunkSummaryInput[],
  status: MyHrChunkStatus,
): number {
  return chunks
    .filter((chunk) => chunk.status === status)
    .reduce((total, chunk) => total + chunk.totalRecords, 0);
}
