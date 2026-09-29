import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const imageDir = path.join(__dirname, "line-rich-menu");

dotenv.config({ path: path.join(projectRoot, ".env.local") });
dotenv.config();

const messagingApiBase = "https://api.line.me/v2/bot";
const messagingDataApiBase = "https://api-data.line.me/v2/bot";

const usage = `Usage: node scripts/setup-line-rich-menu.mjs <command>

  create [general|no-receive|purchasing|all]   Create NEW rich menus and upload images (never deletes, links or sets default)
  link <lineUserId> <richMenuId>               Link one LINE account to one rich menu (use for a single-account test)
  default <richMenuId>                         Set the default rich menu for all users
  sync                                         Link every user with a LINE account to the menu for their role

Menu ids read by sync (set them in .env.local / Vercel after create):
  LINE_RECEIVE_RICH_MENU_ID      receive + dispense + open web   (roles allowed the "receive" menu)
  LINE_DISPENSE_RICH_MENU_ID     dispense + open web             (other roles, and the default menu)
  LINE_PURCHASING_RICH_MENU_ID   order + receive + dispense + web (Admin / Manager)`;

function getAppBaseUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");

  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionUrl) return `https://${productionUrl}`;

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}`;

  return "";
}

function resolveDispenseUrl() {
  const explicitUrl = process.env.NEXT_PUBLIC_LINE_DISPENSE_LIFF_URL?.trim();
  if (explicitUrl) return explicitUrl;

  const liffId = process.env.NEXT_PUBLIC_LINE_DISPENSE_LIFF_ID?.trim();
  if (liffId) return `https://liff.line.me/${liffId}`;

  const baseUrl = getAppBaseUrl();
  return baseUrl ? `${baseUrl}/liff/dispense` : "";
}

function resolveOrderUrl() {
  const explicitUrl = process.env.NEXT_PUBLIC_LINE_ORDER_LIFF_URL?.trim();
  if (explicitUrl) return explicitUrl;

  const liffId = process.env.NEXT_PUBLIC_LINE_ORDER_LIFF_ID?.trim();
  if (liffId) return `https://liff.line.me/${liffId}`;

  const baseUrl = getAppBaseUrl();
  return baseUrl ? `${baseUrl}/liff/orders` : "";
}

function validateUrl(label, url) {
  if (!url) {
    throw new Error(`Missing ${label} URL. Set NEXT_PUBLIC_APP_URL or the matching LINE LIFF ID in .env.local.`);
  }

  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} URL must use https. Current URL: ${url}`);
  }

  if (["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    throw new Error(`${label} URL cannot point to localhost. Current URL: ${url}`);
  }
}

async function lineRequest(endpoint, options = {}) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token || token === "DUMMY_TOKEN") {
    throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN in .env.local.");
  }

  const response = await fetch(endpoint, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE API failed: ${response.status} ${body}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return null;
}

async function createRichMenu({ name, areas }) {
  return lineRequest(`${messagingApiBase}/richmenu`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      size: { width: 2500, height: 843 },
      selected: true,
      name,
      chatBarText: "เมนู",
      areas,
    }),
  });
}

async function uploadRichMenuImage(richMenuId, imagePath) {
  const image = await fs.readFile(imagePath);
  await lineRequest(`${messagingDataApiBase}/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: image,
  });
}

async function setDefaultRichMenu(richMenuId) {
  await lineRequest(`${messagingApiBase}/user/all/richmenu/${richMenuId}`, { method: "POST" });
}

async function linkUserRichMenu(lineUserId, richMenuId) {
  await lineRequest(`${messagingApiBase}/user/${encodeURIComponent(lineUserId)}/richmenu/${richMenuId}`, { method: "POST" });
}

const uri = (label, target) => ({ type: "uri", label, uri: target });
const thirds = [
  { x: 0, width: 833 },
  { x: 833, width: 834 },
  { x: 1667, width: 833 },
];
const quarters = [
  { x: 0, width: 625 },
  { x: 625, width: 625 },
  { x: 1250, width: 625 },
  { x: 1875, width: 625 },
];
const halves = [
  { x: 0, width: 1250 },
  { x: 1250, width: 1250 },
];
const cells = (columns, actions) => columns.map((column, index) => ({
  bounds: { x: column.x, y: 0, width: column.width, height: 843 },
  action: actions[index],
}));

function buildMenus() {
  const appUrl = getAppBaseUrl();
  const dispenseUrl = resolveDispenseUrl();
  validateUrl("App", appUrl);
  validateUrl("Dispense", dispenseUrl);

  return {
    general: {
      name: "LabStock menu - receive, dispense, web",
      image: "general.png",
      envName: "LINE_RECEIVE_RICH_MENU_ID",
      areas: cells(thirds, [
        uri("รับเข้า", `${appUrl}/mobile/receive`),
        uri("เบิกน้ำยา", dispenseUrl),
        uri("เปิด LabStock", `${appUrl}/`),
      ]),
    },
    "no-receive": {
      name: "LabStock menu - dispense, web",
      image: "no-receive.png",
      envName: "LINE_DISPENSE_RICH_MENU_ID",
      areas: cells(halves, [
        uri("เบิกน้ำยา", dispenseUrl),
        uri("เปิด LabStock", `${appUrl}/`),
      ]),
    },
    purchasing: {
      name: "LabStock menu - order, receive, dispense, web",
      image: "purchasing.png",
      envName: "LINE_PURCHASING_RICH_MENU_ID",
      get areas() {
        const orderUrl = resolveOrderUrl();
        validateUrl("Ordering", orderUrl);
        return cells(quarters, [
          uri("สั่งน้ำยา", orderUrl),
          uri("รับเข้า", `${appUrl}/mobile/receive`),
          uri("เบิกน้ำยา", dispenseUrl),
          uri("เปิด LabStock", `${appUrl}/`),
        ]);
      },
    },
  };
}

async function commandCreate(target = "all") {
  const menus = buildMenus();
  const keys = target === "all" ? Object.keys(menus) : [target];
  if (keys.some((key) => !menus[key])) throw new Error(`Unknown menu "${target}".\n\n${usage}`);

  const created = [];
  for (const key of keys) {
    const menu = menus[key];
    const richMenu = await createRichMenu({ name: menu.name, areas: menu.areas });
    await uploadRichMenuImage(richMenu.richMenuId, path.join(imageDir, menu.image));
    created.push(`${menu.envName}=${richMenu.richMenuId}`);
    console.log(`[LINE] Created "${menu.name}" -> ${richMenu.richMenuId}`);
  }

  console.log("[LINE] New menu ids (not linked to anyone, default unchanged):");
  for (const line of created) console.log(line);
}

async function commandLink(lineUserId, richMenuId) {
  if (!lineUserId || !richMenuId) throw new Error(usage);
  await linkUserRichMenu(lineUserId, richMenuId);
  console.log(`[LINE] Linked ${lineUserId} to ${richMenuId}`);
}

async function commandDefault(richMenuId) {
  if (!richMenuId) throw new Error(usage);
  await setDefaultRichMenu(richMenuId);
  console.log(`[LINE] Default rich menu is now ${richMenuId}`);
}

async function commandSync() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  const receiveId = process.env.LINE_RECEIVE_RICH_MENU_ID?.trim();
  const dispenseId = process.env.LINE_DISPENSE_RICH_MENU_ID?.trim();
  const purchasingId = process.env.LINE_PURCHASING_RICH_MENU_ID?.trim();
  if (!receiveId || !dispenseId || !purchasingId) {
    throw new Error("Set LINE_RECEIVE_RICH_MENU_ID, LINE_DISPENSE_RICH_MENU_ID and LINE_PURCHASING_RICH_MENU_ID before sync.");
  }

  const sql = neon(process.env.DATABASE_URL);
  const permissions = await sql`SELECT role, allowed_menus FROM role_permissions`;
  const canReceive = new Set(
    permissions
      .filter((row) => Array.isArray(row.allowed_menus) && row.allowed_menus.includes("receive"))
      .map((row) => row.role),
  );

  const users = await sql`
    SELECT line_user_id, username, role
    FROM users
    WHERE role <> 'Vendor'
      AND line_user_id IS NOT NULL
      AND TRIM(line_user_id) <> ''
  `;

  for (const user of users) {
    const isPurchasing = user.role === "Admin" || user.role === "Manager";
    const richMenuId = isPurchasing ? purchasingId : canReceive.has(user.role) ? receiveId : dispenseId;
    await linkUserRichMenu(String(user.line_user_id), richMenuId);
    console.log(`[LINE] Linked ${user.username} (${user.role}) -> ${richMenuId}`);
  }
  console.log(`[LINE] Synced ${users.length} users.`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "create") return commandCreate(args[0]);
  if (command === "link") return commandLink(args[0], args[1]);
  if (command === "default") return commandDefault(args[0]);
  if (command === "sync") return commandSync();
  console.log(usage);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
