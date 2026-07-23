# LINE LIFF Ordering Rollout

## Environment

Set these in production and `.env.local` before creating the LINE rich menu.

```env
NEXT_PUBLIC_LINE_ORDER_LIFF_ID=
NEXT_PUBLIC_LINE_ORDER_LIFF_URL=
NEXT_PUBLIC_APP_URL=
LINE_PURCHASING_RICH_MENU_ID=
LINE_DISPENSE_RICH_MENU_ID=
```

Use either `NEXT_PUBLIC_LINE_ORDER_LIFF_ID` or `NEXT_PUBLIC_LINE_ORDER_LIFF_URL`. `NEXT_PUBLIC_APP_URL` is the fallback for `/liff/orders`.

## Database

Run once in Neon:

```sql
\i upgrade_v12_line_liff_ordering.sql
```

The migration adds `purchase_orders.liff_request_id` for duplicate-submit protection from LINE and recreates the vendor/status index.

## Rich Menu

Generate PNG assets:

```powershell
npm run line:generate-rich-menu
```

Create or sync rich menus:

```powershell
npm run line:setup-rich-menu
node scripts/setup-line-rich-menu.mjs purchasing
node scripts/setup-line-rich-menu.mjs sync
```

`all` creates the default dispense menu, creates the Admin/Manager purchasing menu, sets the default menu for all users, then links Admin/Manager LINE accounts to the purchasing menu.
