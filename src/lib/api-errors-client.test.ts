import { describe, expect, it } from "vitest";
import { getApiErrorMessage, parseApiError } from "@/lib/api-errors-client";

const axiosError = (extra: Record<string, unknown>) => Object.assign(new Error("Request failed"), { isAxiosError: true, ...extra });

describe("parseApiError", () => {
  it("reads a structured response body", () => {
    const info = parseApiError(
      axiosError({ response: { status: 409, data: { error: "ไม่พอ", code: "REAGENT_STOCK_INSUFFICIENT", hint: "ลดจำนวน", requestId: "req-1", failed: [1] } } }),
      "fallback",
    );
    expect(info).toMatchObject({ message: "ไม่พอ", code: "REAGENT_STOCK_INSUFFICIENT", hint: "ลดจำนวน", requestId: "req-1", status: 409 });
    expect(info.extra).toEqual({ failed: [1] });
  });

  it("handles old-style bodies without a code", () => {
    const a = parseApiError(axiosError({ response: { status: 400, data: { error: "เก่า" } } }), "fb");
    expect(a.message).toBe("เก่า");
    expect(a.code).toBe("UNKNOWN");
    expect(a.hint).toBeTruthy();
    expect(getApiErrorMessage(axiosError({ response: { status: 400, data: { message: "ข้อความ" } } }), "fb")).toBe("ข้อความ");
  });

  it("maps missing response to network offline", () => {
    const info = parseApiError(axiosError({ code: "ERR_NETWORK" }), "fb");
    expect(info.code).toBe("NETWORK_OFFLINE");
    expect(info.hint).toContain("อินเทอร์เน็ต");
  });

  it("maps ECONNABORTED to timeout", () => {
    expect(parseApiError(axiosError({ code: "ECONNABORTED" }), "fb").code).toBe("TIMEOUT");
  });

  it("uses the fallback for plain errors", () => {
    const info = parseApiError(new Error("TypeError: x is undefined"), "บันทึกไม่สำเร็จ");
    expect(info.message).toBe("บันทึกไม่สำเร็จ");
    expect(info.code).toBe("UNKNOWN");
  });

  it("keeps plain errors that were written in Thai", () => {
    expect(parseApiError(new Error("ไม่พบข้อมูลในไฟล์"), "fb").message).toBe("ไม่พบข้อมูลในไฟล์");
  });
});
