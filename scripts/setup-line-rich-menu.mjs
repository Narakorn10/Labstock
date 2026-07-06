import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const imagePath = path.join(__dirname, "line-rich-menu-dispense.png");

dotenv.config({ path: path.join(projectRoot, ".env.local") });
dotenv.config();

const messagingApiBase = "https://api.line.me/v2/bot";
const messagingDataApiBase = "https://api-data.line.me/v2/bot";

function resolveDispenseUrl() {
  const explicitUrl = process.env.NEXT_PUBLIC_LINE_DISPENSE_LIFF_URL?.trim();
  if (explicitUrl) return explicitUrl;

  const liffId = process.env.NEXT_PUBLIC_LINE_DISPENSE_LIFF_ID?.trim();
  if (liffId) return `https://liff.line.me/${liffId}`;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return `${appUrl.replace(/\/$/, "")}/liff/dispense`;

  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionUrl) return `https://${productionUrl}/liff/dispense`;

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}/liff/dispense`;

  return "";
}

function validateUrl(url) {
  if (!url) {
    throw new Error(
      "Missing LIFF URL. Set NEXT_PUBLIC_APP_URL or NEXT_PUBLIC_LINE_DISPENSE_LIFF_ID in .env.local.",
    );
  }

  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`LINE Rich Menu URL must use https. Current URL: ${url}`);
  }

  if (["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    throw new Error(`LINE Rich Menu URL cannot point to localhost. Current URL: ${url}`);
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
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return null;
}

async function createRichMenu(dispenseUrl) {
  return lineRequest(`${messagingApiBase}/richmenu`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      size: {
        width: 2500,
        height: 843,
      },
      selected: true,
      name: "LabStock dispense menu",
      chatBarText: "เมนูเบิก",
      areas: [{
        bounds: {
          x: 0,
          y: 0,
          width: 2500,
          height: 843,
        },
        action: {
          type: "uri",
          label: "เปิดเมนูเบิก",
          uri: dispenseUrl,
        },
      }],
    }),
  });
}

async function uploadRichMenuImage(richMenuId) {
  const image = await fs.readFile(imagePath);

  await lineRequest(`${messagingDataApiBase}/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
    },
    body: image,
  });
}

async function setDefaultRichMenu(richMenuId) {
  await lineRequest(`${messagingApiBase}/user/all/richmenu/${richMenuId}`, {
    method: "POST",
  });
}

async function main() {
  const dispenseUrl = resolveDispenseUrl();
  validateUrl(dispenseUrl);

  console.log(`[LINE] Creating rich menu for ${dispenseUrl}`);
  const richMenu = await createRichMenu(dispenseUrl);
  const richMenuId = richMenu.richMenuId;

  try {
    console.log(`[LINE] Uploading image to ${richMenuId}`);
    await uploadRichMenuImage(richMenuId);

    console.log(`[LINE] Setting default rich menu ${richMenuId}`);
    await setDefaultRichMenu(richMenuId);

    console.log(`[LINE] Done. Rich menu ID: ${richMenuId}`);
  } catch (error) {
    console.error(`[LINE] Setup failed after creating ${richMenuId}. Delete it in LINE Developers if needed.`);
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
