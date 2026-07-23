import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const dispenseImagePath = path.join(__dirname, "line-rich-menu-dispense.png");
const purchasingImagePath = path.join(__dirname, "line-rich-menu-purchasing.png");

dotenv.config({ path: path.join(projectRoot, ".env.local") });
dotenv.config();

const messagingApiBase = "https://api.line.me/v2/bot";
const messagingDataApiBase = "https://api-data.line.me/v2/bot";

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

async function createRichMenu({ name, chatBarText, areas }) {
  return lineRequest(`${messagingApiBase}/richmenu`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      size: { width: 2500, height: 843 },
      selected: true,
      name,
      chatBarText,
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

async function syncPurchasingUsers(richMenuId) {
  if (!process.env.DATABASE_URL) {
    console.warn("[LINE] DATABASE_URL is not set, skipping Admin/Manager rich menu sync.");
    return 0;
  }

  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    SELECT line_user_id, username, role
    FROM users
    WHERE role IN ('Admin', 'Manager')
      AND line_user_id IS NOT NULL
      AND TRIM(line_user_id) <> ''
  `;

  for (const row of rows) {
    await linkUserRichMenu(String(row.line_user_id), richMenuId);
    console.log(`[LINE] Linked ${row.username} (${row.role}) to purchasing rich menu.`);
  }

  return rows.length;
}

async function main() {
  const mode = process.argv[2] || "all";
  const dispenseUrl = resolveDispenseUrl();
  const orderUrl = resolveOrderUrl();
  validateUrl("Dispense", dispenseUrl);
  if (mode !== "dispense") validateUrl("Ordering", orderUrl);

  let dispenseRichMenuId = process.env.LINE_DISPENSE_RICH_MENU_ID?.trim();
  let purchasingRichMenuId = process.env.LINE_PURCHASING_RICH_MENU_ID?.trim();

  if (!dispenseRichMenuId && (mode === "all" || mode === "dispense")) {
    console.log(`[LINE] Creating default dispense rich menu for ${dispenseUrl}`);
    const richMenu = await createRichMenu({
      name: "LabStock dispense menu",
      chatBarText: "เมนูเบิกน้ำยา",
      areas: [{
        bounds: { x: 0, y: 0, width: 2500, height: 843 },
        action: { type: "uri", label: "เปิดเมนูเบิก", uri: dispenseUrl },
      }],
    });
    dispenseRichMenuId = richMenu.richMenuId;
    await uploadRichMenuImage(dispenseRichMenuId, dispenseImagePath);
  }

  if (dispenseRichMenuId && (mode === "all" || mode === "dispense")) {
    console.log(`[LINE] Setting default rich menu ${dispenseRichMenuId}`);
    await setDefaultRichMenu(dispenseRichMenuId);
  }

  if (!purchasingRichMenuId && (mode === "all" || mode === "purchasing")) {
    console.log(`[LINE] Creating Admin/Manager purchasing rich menu for ${orderUrl}`);
    const richMenu = await createRichMenu({
      name: "LabStock admin purchasing menu",
      chatBarText: "LabStock",
      areas: [
        {
          bounds: { x: 0, y: 0, width: 1250, height: 843 },
          action: { type: "uri", label: "เบิกน้ำยา", uri: dispenseUrl },
        },
        {
          bounds: { x: 1250, y: 0, width: 1250, height: 843 },
          action: { type: "uri", label: "สั่งน้ำยา", uri: orderUrl },
        },
      ],
    });
    purchasingRichMenuId = richMenu.richMenuId;
    await uploadRichMenuImage(purchasingRichMenuId, purchasingImagePath);
  }

  if (purchasingRichMenuId && (mode === "all" || mode === "purchasing" || mode === "sync")) {
    const linked = await syncPurchasingUsers(purchasingRichMenuId);
    console.log(`[LINE] Admin/Manager linked users: ${linked}`);
  }

  console.log("[LINE] Done.");
  console.log(`[LINE] LINE_DISPENSE_RICH_MENU_ID=${dispenseRichMenuId || ""}`);
  console.log(`[LINE] LINE_PURCHASING_RICH_MENU_ID=${purchasingRichMenuId || ""}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
