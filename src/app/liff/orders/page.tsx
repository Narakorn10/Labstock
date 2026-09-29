import type { Metadata } from "next";
import LiffOrderWorkflow from "@/components/liff-order-workflow";

export const metadata: Metadata = {
  title: "สั่งน้ำยา | LabStock",
  description: "สั่งน้ำยาผ่าน LINE LIFF",
};

// Full-screen like /liff/dispense so the LINE in-app browser does not show the desktop AppShell and sidebar.
export default function LiffOrdersPage() {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-ground">
      <LiffOrderWorkflow />
    </div>
  );
}
