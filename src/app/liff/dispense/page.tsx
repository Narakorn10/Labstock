import type { Metadata } from "next";
import LiffDispenseWorkflow from "@/components/liff-dispense-workflow";

export const metadata: Metadata = {
  title: "เบิกจ่ายน้ำยา | LabStock",
  description: "เบิกจ่ายน้ำยาผ่าน LINE LIFF",
};

export default function LiffDispensePage() {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-[#edf5f1]">
      <LiffDispenseWorkflow />
    </div>
  );
}
