# Scanner Agent deployment and staging checklist

Use this guide for a staging deployment first. Do not run the database migration against production until every staging check below passes.

## 1. Server preparation

1. Back up the database.
2. Apply `upgrade_v8_reagent_scanner.sql` once, using the same migration process as the LabStock application.
3. Confirm the existing `users` table has `pin_hash` support. Scanner users must have a PIN and must not have the `Vendor` role.
4. Create one station and one station token. Store only the SHA-256 hash of the token in `station_tokens`; give the plain token to the station administrator once.

Example SQL structure (replace the example values):

```sql
INSERT INTO stations (station_id, station_name, department_name)
VALUES ('lab-chem-01', 'Chemistry bench 1', 'Clinical Chemistry');

INSERT INTO station_tokens (station_id, token_hash, token_name)
VALUES ('lab-chem-01', '<sha256-of-plain-token>', 'Chemistry bench 1');
```

Revoke a lost station token rather than reusing it:

```sql
UPDATE station_tokens
SET is_active = FALSE, revoked_at = NOW()
WHERE station_id = 'lab-chem-01' AND token_name = 'Chemistry bench 1';
```

## 2. Station setup

1. Copy the published Agent folder to a protected local folder, for example `C:\LabStockScannerAgent`.
2. Set the three environment variables for the Windows user that runs the Agent:

```powershell
[Environment]::SetEnvironmentVariable('REAGENT_SCANNER_API_BASE_URL', 'https://labstock.example', 'User')
[Environment]::SetEnvironmentVariable('REAGENT_SCANNER_STATION_ID', 'lab-chem-01', 'User')
[Environment]::SetEnvironmentVariable('REAGENT_SCANNER_API_TOKEN', '<plain-station-token>', 'User')
```

3. Open a new terminal and run `ReagentScannerAgent.Worker.exe`.
4. Do not put the station token in `appsettings.json`, source code, or a shared folder.
5. Back up `data\reagent-scanner.db` locally. It contains the offline queue and authorization tokens, so restrict the folder to the station operator and local administrators.
6. Keep the Agent online briefly after startup so it can refresh its master-data cache. The cache refreshes every hour by default.

## 3. Staging acceptance checks

| Check | Expected result |
| --- | --- |
| Correct username and PIN | Agent starts a withdrawal session and receives an authorization token. |
| Incorrect PIN | Agent refuses the session; no queue record is created. |
| Vendor user PIN | Agent refuses the session. |
| Valid item and sufficient stock | Queue becomes `SYNCED`; inventory decreases once and one log entry is written per item. |
| Same queued request submitted twice | Second submission reports a duplicate; stock is not reduced again. |
| Insufficient stock | Queue becomes `CONFLICT`; inventory and logs are unchanged. |
| Expired/revoked user authorization | Queue becomes `REJECTED` with `USER_AUTHORIZATION_INVALID`; stock is unchanged. |
| Invalid/revoked station token | Authorization and heartbeat return HTTP 401; stock is unchanged. |
| Network interruption after local confirm | Queue stays pending/retries; it syncs once when the connection returns before the 12-hour user authorization expires. |

## 4. Operational rules

- A user authorization lasts 12 hours and is tied to one station. Start a new session while the Agent can reach LabStock.
- Do not delete a queue record marked `CONFLICT` or `REJECTED` until its cause is understood and documented.
- If the station is offline longer than 12 hours, re-enter the withdrawal after connectivity returns; an expired authorization is intentionally not reusable.
- Treat a copied SQLite queue database as sensitive station credential material.

## 5. Production release gate

Proceed only after the acceptance checks pass, a backup is verified, a station owner is assigned, and the staging migration result has been reviewed. Commit source and documentation only; publish output and local SQLite data remain ignored by Git.
