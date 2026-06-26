import { NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/auth";
import sql from "@/lib/db";

async function hasUserEmailColumn() {
  const result = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'email'
    ) as exists
  `;

  return Boolean(result[0]?.exists);
}

export async function POST() {
  try {
    const session = await auth();
    const email = session?.user?.email?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: "Google account email is required." }, { status: 401 });
    }

    const localPart = email.split("@")[0];
    const hasEmail = await hasUserEmailColumn();
    const users = hasEmail
      ? await sql`
          SELECT username, name, role, vendor
          FROM users
          WHERE LOWER(username) = ${email}
             OR LOWER(username) = ${localPart}
             OR LOWER(email) = ${email}
          LIMIT 1
        `
      : await sql`
          SELECT username, name, role, vendor
          FROM users
          WHERE LOWER(username) = ${email}
             OR LOWER(username) = ${localPart}
          LIMIT 1
        `;

    if (users.length === 0) {
      return NextResponse.json(
        { error: "Google account is not linked to a LabStock user." },
        { status: 403 }
      );
    }

    const user = users[0];
    const token = crypto.randomUUID();
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 24);

    await sql`
      UPDATE users
      SET token = ${hashedToken}, token_expiry = ${expiry}
      WHERE username = ${user.username}
    `;

    return NextResponse.json({
      success: true,
      token,
      user: {
        username: user.username,
        name: user.name,
        role: user.role,
        vendor: user.vendor || "",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Google login token error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
