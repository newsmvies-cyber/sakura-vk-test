# Sakura backend snapshot and retention preparation

This folder is a Git-tracked copy of the local package `work/function-upload-slim-2026-10-21-v2`. It is a source snapshot for coordinated local work. It has **not** been compared with the active Yandex Cloud Function package, and none of these files have been deployed.

## Observed shape in this source snapshot

- API reads and writes one `orders` table.
- The source references columns `id`, `created_at`, `status`, and JSON text `payload`; it does not create tables or show a schema migration.
- The order, contact fields, VK ID, notification setting, and legal events are serialized in `payload`. No separate status-history or personal-profile table is referenced in this package.
- This does not prove the actual YDB schema, constraints, indexes, other consumers, logs, or backups match the local package.

## Local changes prepared

- New requests keep the compatible status code `new` (displayed as «Ожидает подтверждения»).
- `cancelled` is accepted as an additional status. `done` and `cancelled` are terminal; the existing administrator's ability to choose nonterminal statuses remains unchanged. Status updates remain behind verified VK launch parameters and the server-side admin allowlist. A browser-supplied VK ID is never used as authorization.
- Legal request gates remain in place. Payment validation accepts only «Наличными» and «Картой при получении».
- Terminal status transitions set `completedAt` from server time and mark its provenance in the JSON payload. A separate Timer-only entry point scans terminal rows in ordered batches. Rows whose server-recorded terminal time is at least 48 hours old are deleted entirely, so no contact fields, VK IDs, comments, or legal-event identifiers remain in the orders table. The scanner uses compare-and-update/delete conditions so a stale scan cannot erase a row whose status or payload changed after it was read.
- The observed YDB schema has `id` as its primary key and no secondary indexes. Local customer-history and cleanup scans page by `id`; this avoids relying on ordering by non-key `created_at` and prevents filtering only the newest 200 global rows before identifying the customer. Both routes still scan the table because `vkUserId` and completion time are inside JSON `payload`; request cost will grow with table size and must be measured before deployment.
- Old terminal rows without a trustworthy server provenance marker are timestamped on the first cleanup scan, then retained for a full 48 hours. Active rows are never selected for cleanup based on age.
- The cleanup entry point requires the expected Timer trigger ID and fixed payload. It must be deployed as a separate non-public function entry point and invokable only by the Timer service account. Do not add it to the public application API Gateway.

No YDB schema migration is included: the timestamp fits in the existing JSON payload, and the row is deleted after the retention period. A read-only aggregate preflight query is in `retention-preflight.yql`; it has not been run.

## Future Timer settings example

`cleanup-trigger.example.json` is an unapplied template. It suggests a 15-minute UTC schedule (`0/15 * * * ? *`) so cleanup runs independently of the Mini App. Set the future function's `CLEANUP_TRIGGER_ID` to the created Timer ID, supply the `sakura-order-pii-cleanup-v1` payload, grant only `functions.functionInvoker` to the Timer service account, and configure retries plus a monitored dead-letter queue. Confirm the platform's function entry-point and IAM setup in a staging project before production.

The existing app function package also accepts customer HTTP traffic. The cleanup handler therefore must remain a separate, IAM-restricted entry point; event-shape checks alone are not an authorization boundary.

## Retention and operational dependencies

Deleting YDB rows does not erase copies already present in database backups, exports, request logs, support systems, or local administrator downloads. Before rollout, the data owner must identify each copy, set a compatible retention window, and prove purge/expiry behavior. Do not log payloads or order identifiers from the cleaner.

Legal review is required before enabling the 48-hour policy. Federal Law 402-FZ requires certain accounting documents to be retained for at least five years; whether a particular completed Sakura order payload is such a document, and what minimum fields must remain, needs a decision from the operator/accountant. If a required record must remain, retain a separate legally sufficient and minimized record while deleting the customer-contact data; do not silently exempt it from the agreed policy. The 48-hour cleanup has not been deployed or run against YDB.

Before deployment: compare the full function package and YDB schema with this snapshot; verify column types, constraints and indexes; exercise Timer auth and compare-and-delete under concurrent status updates; estimate terminal-row volume and function run time; agree the legally required record fields and backup/log retention; then stage with synthetic fixtures and a restorable backup.
