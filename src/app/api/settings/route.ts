import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { getRequestId, withRequestId } from "@/lib/request-observability";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return withRequestId(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), requestId);
    }
    if (user.role === "Vendor" && !user.vendor) {
      return withRequestId(
        NextResponse.json({ error: "Vendor profile is not configured" }, { status: 403 }),
        requestId,
      );
    }

    const [reagentRows, jobRows, machineRows, unitRows, vendorRows] = await Promise.all([
      sql`SELECT name FROM reagent_types ORDER BY name ASC`,
      sql`SELECT name FROM job_types ORDER BY name ASC`,
      sql`SELECT name FROM machine_types ORDER BY name ASC`,
      sql`
        SELECT DISTINCT unit AS name
        FROM master_data
        WHERE COALESCE(unit, '') <> ''
        ORDER BY unit ASC
      `,
      user.role === "Vendor"
        ? sql`
            SELECT DISTINCT vendor AS name
            FROM master_data
            WHERE vendor = ${user.vendor}
            ORDER BY vendor ASC
          `
        : sql`
            SELECT DISTINCT vendor AS name
            FROM master_data
            WHERE COALESCE(vendor, '') <> ''
            ORDER BY vendor ASC
          `,
    ]);

    return withRequestId(
      NextResponse.json({
        reagentTypes: reagentRows.map((row) => row.name),
        jobTypes: jobRows.map((row) => row.name),
        machineTypes: machineRows.map((row) => row.name),
        units: unitRows.map((row) => row.name),
        vendors: vendorRows.map((row) => row.name),
      }),
      requestId,
    );
  } catch (error: unknown) {
    console.error(`[Settings GET] requestId=${requestId}`, error);
    return withRequestId(
      NextResponse.json({ error: "Failed to fetch settings", requestId }, { status: 500 }),
      requestId,
    );
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return withRequestId(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), requestId);
    }
    if (user.role !== "Admin") {
      return withRequestId(NextResponse.json({ error: "Forbidden" }, { status: 403 }), requestId);
    }

    const body = await request.json() as { action?: unknown; type?: unknown; value?: unknown };
    const action = typeof body.action === "string" ? body.action : "";
    const type = typeof body.type === "string" ? body.type : "";
    const value = typeof body.value === "string" ? body.value.trim() : "";

    if (!value || value.length > 200) {
      return withRequestId(NextResponse.json({ error: "Invalid value" }, { status: 400 }), requestId);
    }

    const tableName = {
      reagent: "reagent_types",
      job: "job_types",
      machine: "machine_types",
    }[type];
    if (!tableName) {
      return withRequestId(NextResponse.json({ error: "Invalid type" }, { status: 400 }), requestId);
    }

    if (action === "add") {
      if (tableName === "reagent_types") {
        await sql`INSERT INTO reagent_types (name) VALUES (${value}) ON CONFLICT (name) DO NOTHING`;
      } else if (tableName === "job_types") {
        await sql`INSERT INTO job_types (name) VALUES (${value}) ON CONFLICT (name) DO NOTHING`;
      } else {
        await sql`INSERT INTO machine_types (name) VALUES (${value}) ON CONFLICT (name) DO NOTHING`;
      }

      return withRequestId(NextResponse.json({ success: true, message: "เพิ่มข้อมูลสำเร็จ" }), requestId);
    }

    if (action === "delete") {
      if (tableName === "reagent_types") {
        await sql`DELETE FROM reagent_types WHERE name = ${value}`;
      } else if (tableName === "job_types") {
        await sql`DELETE FROM job_types WHERE name = ${value}`;
      } else {
        await sql`DELETE FROM machine_types WHERE name = ${value}`;
      }

      return withRequestId(NextResponse.json({ success: true, message: "ลบข้อมูลสำเร็จ" }), requestId);
    }

    return withRequestId(NextResponse.json({ error: "Invalid action" }, { status: 400 }), requestId);
  } catch (error: unknown) {
    console.error(`[Settings POST] requestId=${requestId}`, error);
    return withRequestId(
      NextResponse.json({ error: "Failed to update settings", requestId }, { status: 500 }),
      requestId,
    );
  }
}
