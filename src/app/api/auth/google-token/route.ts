import { NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/auth";
import { findActiveUserByEmail } from "@/lib/auth-service";
import sql from "@/lib/db";

export async function POST() {
  try {
    const session = await auth();
    const email = session?.user?.email?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: "Google account email is required." }, { status: 401 });
    }

    // Match the Auth.js sign-in rule: exact email only. Matching by username or
    // the part before "@" could link a Google account to someone else's user.
    const user = await findActiveUserByEmail(email);
    if (!user) {
      return NextResponse.json(
        { error: "Google account is not linked to an active LabStock user." },
        { status: 403 }
      );
    }

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
