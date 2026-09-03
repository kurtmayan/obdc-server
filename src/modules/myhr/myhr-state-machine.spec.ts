import { MyHrChunkStatus, MyHrJobStatus } from 'src/generated/prisma/enums';
import { deriveMyHrJobSummary } from './myhr-state-machine';

describe('deriveMyHrJobSummary', () => {
  it.each([
    [[chunk(MyHrChunkStatus.SUCCESS, 10)], MyHrJobStatus.SUCCESS],
    [[chunk(MyHrChunkStatus.FAILED, 10)], MyHrJobStatus.FAILED],
    [
      [chunk(MyHrChunkStatus.SUCCESS, 7), chunk(MyHrChunkStatus.FAILED, 3)],
      MyHrJobStatus.PARTIAL_SUCCESS,
    ],
    [
      [chunk(MyHrChunkStatus.SUCCESS, 7), chunk(MyHrChunkStatus.UNKNOWN, 3)],
      MyHrJobStatus.NEEDS_REVIEW,
    ],
    [
      [chunk(MyHrChunkStatus.SUCCESS, 7), chunk(MyHrChunkStatus.VERIFYING, 3)],
      MyHrJobStatus.PROCESSING,
    ],
  ])('derives the expected terminal or active state', (chunks, expected) => {
    expect(deriveMyHrJobSummary(chunks).status).toBe(expected);
  });

  it('aggregates all record categories and prefers an unknown root error', () => {
    expect(
      deriveMyHrJobSummary([
        chunk(MyHrChunkStatus.SUCCESS, 5),
        chunk(MyHrChunkStatus.FAILED, 2, 'failed'),
        chunk(MyHrChunkStatus.UNKNOWN, 3, 'review'),
      ]),
    ).toEqual({
      status: MyHrJobStatus.NEEDS_REVIEW,
      successfulRecords: 5,
      failedRecords: 2,
      reviewRecords: 3,
      errorMessage: 'review',
    });
  });
});

function chunk(
  status: MyHrChunkStatus,
  totalRecords: number,
  errorMessage: string | null = null,
) {
  return { status, totalRecords, errorMessage };
}
