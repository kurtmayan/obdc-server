# MyHR synchronization operations

The HTTP application owns only the hourly trigger. The worker owns trigger
deduplication, job/chunk creation, outbox publication, upload processing, and
batch verification.

## Safe enablement

Both `MYHR_SYNC_ENABLED` and `MYHR_WORKER_ENABLED` default to `false`.

1. Apply the Prisma migration while the old scheduler is disabled.
2. Capture sanitized pending, success, and failed responses from the MyHR
   status endpoint.
3. Add those values to the three `MYHR_STATUS_*_VALUES` settings and run the
   contract tests.
4. Deploy and enable the worker at concurrency `1`.
5. Reconcile every migrated `UNKNOWN` chunk.
6. Enable the API scheduler and observe one complete hourly run.
7. Increase worker concurrency to `2` only after verifying the MyHR rate limit.

The application refuses to start with either MyHR component enabled while the
status mappings are empty.

## Required SQS configuration

The queue is at-least-once. Configure a dead-letter queue with
`maxReceiveCount=5`, retain failed messages long enough for investigation, and
alarm whenever the DLQ contains a message. The queue visibility timeout must
match `AWS_SQS_VISIBILITY_TIMEOUT_SECONDS`; the worker extends visibility at
half that interval while a message is in flight.

Invalid or unsupported messages are deliberately not deleted, allowing the
SQS redrive policy to quarantine them.

## Alerts

Route these structured warning events to the production alerting platform:

- `myhr_trigger_queue_exhausted`
- `myhr_outbox_stale`
- `myhr_active_job_stale`
- `myhr_unknown_chunks`
- `myhr_verification_overdue`
- `myhr_upload_failed`
- `myhr_status_check_failed`
- `myhr_outbox_loop_failed`
- SQS DLQ message count greater than zero

## Unknown upload reconciliation

An upload becomes `UNKNOWN` after any ambiguous POST outcome. It is never
retried automatically.

- If the MyHR batch ID is known, attach it and allow normal status verification.
- Retry only after an operator explicitly acknowledges the duplicate risk.
- Otherwise mark it failed with a reason.

All reconciliation endpoints require the `SUPERADMIN` role and are recorded by
the existing HTTP audit interceptor.
