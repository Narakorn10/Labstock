# LINE LIFF Ordering Rollout

## Environment

Set these in production and `.env.local` before creating the LINE rich menu.

```env
NEXT_PUBLIC_LINE_ORDER_LIFF_ID=
NEXT_PUBLIC_LINE_ORDER_LIFF_URL=
NEXT_PUBLIC_APP_URL=
LINE_PURCHASING_RICH_MENU_ID=
LINE_DISPENSE_RICH_MENU_ID=
LINE_RECEIVE_RICH_MENU_ID=
```

Use either `NEXT_PUBLIC_LINE_ORDER_LIFF_ID` or `NEXT_PUBLIC_LINE_ORDER_LIFF_URL`. `NEXT_PUBLIC_APP_URL` is the fallback for `/liff/orders`.

## Database

Run once in Neon:

```sql
\i upgrade_v12_line_liff_ordering.sql
```

The migration adds `purchase_orders.liff_request_id` for duplicate-submit protection from LINE and recreates the vendor/status index.

## Rich Menu

Menu images live in `scripts/line-rich-menu/*.html` (2500x843, design 3a). Render the PNGs with Edge:

```powershell
npm run line:render-rich-menu
```

Three menus, one per audience:

| Menu | Cells | Env var | Who |
| --- | --- | --- | --- |
| general | receive (web `/mobile/receive`), dispense (LIFF), open LabStock | `LINE_RECEIVE_RICH_MENU_ID` | roles allowed the `receive` menu |
| no-receive | dispense (LIFF), open LabStock | `LINE_DISPENSE_RICH_MENU_ID` | other roles (e.g. Operator) and the default menu |
| purchasing | order (LIFF), receive (web `/mobile/receive`), dispense (LIFF), open LabStock | `LINE_PURCHASING_RICH_MENU_ID` | Admin, Manager |

Rollout (each step is separate and nothing is deleted, so the old menu ids remain the rollback):

```powershell
node scripts/setup-line-rich-menu.mjs create              # new menus + ids, no links, default unchanged
node scripts/setup-line-rich-menu.mjs link <lineUserId> <richMenuId>   # test on one account
# put the new ids in Vercel env, redeploy, then:
node scripts/setup-line-rich-menu.mjs default <no-receive menu id>
node scripts/setup-line-rich-menu.mjs sync
```

`create` never links users or changes the default. `sync` links every non-Vendor user that has a LINE account. New accounts are linked by `linkLineRichMenuForRole` when they bind through the mobile app.
