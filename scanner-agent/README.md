# Reagent Scanner Agent

## What it does

This Windows console application accepts keyboard-wedge barcode scans, saves confirmed withdrawals to its local SQLite queue, and syncs them to LabStock in the background.

## Install

1. Install the .NET 10 Runtime or SDK on the station computer.
2. Copy the published `ReagentScannerAgent.Worker` folder to the station computer.
3. Set the station URL, station ID, and token as Windows environment variables. Do not save the token in `appsettings.json`.

```powershell
[Environment]::SetEnvironmentVariable('REAGENT_SCANNER_API_BASE_URL', 'https://your-labstock-domain', 'User')
[Environment]::SetEnvironmentVariable('REAGENT_SCANNER_STATION_ID', 'lab-chem-01', 'User')
[Environment]::SetEnvironmentVariable('REAGENT_SCANNER_API_TOKEN', 'your-plain-station-token', 'User')
```

Open a new PowerShell window after setting the variables, then run `ReagentScannerAgent.Worker.exe`.

## Daily use

1. Enter the LabStock username.
2. Scan a barcode. The scanner must be configured to send an Enter key after each scan.
3. Enter the user PIN to verify the withdrawal user with LabStock. A network connection is required when starting a new session.
4. Scan a GS1/UDI barcode. When its GTIN exists in the local master-data cache, the Agent fills item ID, lot, and expiry automatically; enter only the quantity.
5. For an unknown or non-GS1 barcode, enter the item ID, lot number, quantity, and optional expiry date manually.
4. Repeat for each reagent.
5. Type `confirm` to save the complete withdrawal to SQLite. The agent syncs it automatically.

Commands: `status` shows the queue count. `cancel` clears the current unconfirmed session. `Ctrl+C` stops the agent.

## Important

The user, item ID, and lot number must already exist in LabStock. The local queue stores a short-lived user authorization token, never the PIN. A successful local confirmation does not deduct central stock until the server returns `SYNCED`.

See [DEPLOYMENT.md](DEPLOYMENT.md) for station setup, token provisioning, staging acceptance checks, and production release requirements.
