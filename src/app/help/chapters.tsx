import type { ReactNode } from 'react';
import { Figure, LifecycleDiagram } from './diagrams';

/**
 * เนื้อหาคู่มือการใช้งาน LabStock
 *
 * - `audience` บอกว่าบทนี้เขียนให้ใคร: 'all' = ทุกคน, 'staff' = เจ้าหน้าที่แล็บ,
 *   'admin' = ผู้ดูแลห้อง/Admin, 'vendor' = บริษัทผู้ขาย
 * - `routes` คือหน้าในเว็บที่บทนี้อธิบาย: เทสต์ chapters.test.tsx ตรวจว่าทุกหน้านี้ยังมีอยู่จริง
 *   (กันคู่มือล้าสมัยเมื่อหน้าถูกลบหรือเปลี่ยนชื่อ)
 * - ที่มาของแต่ละขั้นตอน (ไฟล์:บรรทัดในโค้ด) อยู่ใน docs/user-manual-sources.md เพื่อให้ตรวจทานได้
 */
export type Audience = 'all' | 'staff' | 'admin' | 'vendor';

export type Chapter = {
  id: string;
  audience: Audience;
  title: string;
  routes: string[];
  body: ReactNode;
};

function Steps({ children }: { children: ReactNode }) {
  return <ol className="manual-steps list-decimal space-y-1.5 pl-6">{children}</ol>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="manual-note rounded-xl border border-line bg-gray-50 px-4 py-3 text-sm text-gray-700">{children}</p>;
}

function Btn({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-ink">“{children}”</strong>;
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'overview',
    audience: 'all',
    title: 'ภาพรวม: น้ำยาเดินทางอย่างไรในระบบ',
    routes: ['/orders', '/receive', '/dispense', '/dashboard', '/logs'],
    body: (
      <div className="space-y-3">
        <p>
          LabStock ติดตามน้ำยาทุกขวด/กล่องตั้งแต่สั่งซื้อจนเบิกใช้ โดยแยกตาม <strong>Lot</strong> และ
          <strong>วันหมดอายุ</strong> งานประจำวันวนอยู่ 4 ขั้นตามภาพนี้
        </p>
        <LifecycleDiagram />
        <Note>
          ในหน้ารายละเอียดใบสั่งน้ำยา การยืนยันว่า “ได้รับของ” เป็นแค่การปิดยอดค้างของใบสั่ง
          <strong> ไม่เพิ่มยอดคลัง</strong> (ระบบเตือนว่า “ไม่มีการเพิ่มสต๊อก ต้องรับเข้าที่หน้า Receive”) —
          ต้องทำ <Btn>Receive (รับเข้า)</Btn> ทุกครั้งที่ของมาถึง ยอดคลังจึงจะเพิ่ม
        </Note>
      </div>
    ),
  },
  {
    id: 'sign-in',
    audience: 'all',
    title: 'เข้าสู่ระบบและออกจากระบบ',
    routes: ['/login'],
    body: (
      <div className="space-y-3">
        <Figure
          src="/help/login.png"
          alt="หน้าเข้าสู่ระบบ มีช่องอีเมลหรือชื่อผู้ใช้ ช่องรหัสผ่าน ลิงก์ลืมรหัสผ่าน ปุ่มเข้าสู่ระบบ และปุ่มเข้าสู่ระบบด้วย Google"
          caption="หน้าเข้าสู่ระบบ"
          narrow
        />
        <Steps>
          <li>เปิดหน้า <Btn>เข้าสู่ระบบ</Btn> (ถ้ายังไม่ได้ล็อกอิน ระบบจะพามาที่หน้านี้เอง)</li>
          <li>กรอก <Btn>อีเมลหรือชื่อผู้ใช้</Btn> และ <Btn>รหัสผ่าน</Btn> แล้วกดปุ่ม <Btn>เข้าสู่ระบบ</Btn></li>
          <li>หรือกดปุ่มเข้าสู่ระบบ <Btn>ด้วย Google</Btn> ถ้าบัญชีของคุณผูกกับอีเมล Google ไว้</li>
          <li>ถ้ากรอกผิด ระบบจะแจ้งว่า “ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง” ให้ลองใหม่อีกครั้ง</li>
        </Steps>
        <p>เมื่อเข้าสำเร็จ ระบบจะพาไปหน้า <Btn>Inventory Overview</Btn> (ภาพรวมคลังน้ำยา)</p>
        <p>
          เลิกใช้งานให้กดปุ่ม <Btn>ออกจากระบบ</Btn> ที่ด้านล่างของเมนูด้านซ้าย
          โดยเฉพาะเมื่อใช้คอมพิวเตอร์ที่ใช้ร่วมกัน
        </p>
      </div>
    ),
  },
  {
    id: 'register',
    audience: 'all',
    title: 'สมัครบัญชีใหม่',
    routes: ['/register'],
    body: (
      <div className="space-y-3">
        <Steps>
          <li>เปิดหน้า <Btn>ลงทะเบียน LabStock</Btn></li>
          <li>กรอก <Btn>ชื่อ-นามสกุล</Btn> <Btn>อีเมล</Btn> <Btn>ชื่อผู้ใช้</Btn> (อย่างน้อย 3 ตัวอักษร)</li>
          <li>ตั้ง <Btn>รหัสผ่าน</Btn> อย่างน้อย 12 ตัวอักษร แล้วกรอก <Btn>ยืนยันรหัสผ่าน</Btn> ให้ตรงกัน</li>
          <li>
            เลือก <Btn>ประเภทบัญชี</Btn>:
            <ul className="mt-1 list-disc space-y-1 pl-6">
              <li><Btn>บุคลากรห้องปฏิบัติการ</Btn> — แล้วเลือก <Btn>ห้องปฏิบัติการที่สังกัด</Btn></li>
              <li>
                <Btn>บริษัทผู้จำหน่าย</Btn> — เลือกบริษัทที่ได้รับอนุมัติแล้วจากรายการ
                หรือเลือก <Btn>ขอเพิ่มบริษัท</Btn> แล้วพิมพ์ชื่อบริษัท
              </li>
            </ul>
          </li>
          <li>กดส่งแบบฟอร์ม</li>
        </Steps>
        <Note>
          บัญชีใหม่ <strong>ใช้งานไม่ได้ทันที</strong> ต้องรอผู้ดูแลระบบอนุมัติก่อน
          ถ้าสมัครแล้วเข้าสู่ระบบไม่ได้ ให้ติดต่อผู้ดูแลระบบของห้องคุณ
        </Note>
      </div>
    ),
  },
  {
    id: 'reset-password',
    audience: 'all',
    title: 'ลืมรหัสผ่าน',
    routes: ['/reset-password'],
    body: (
      <div className="space-y-3">
        <Steps>
          <li>ที่หน้าเข้าสู่ระบบ กดลิงก์ <Btn>ลืมรหัสผ่าน?</Btn></li>
          <li>กรอกอีเมลที่ผูกกับบัญชีของคุณ แล้วส่งคำขอ</li>
          <li>ระบบจะแจ้งว่า “หากอีเมลนี้อยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่แล้ว”</li>
          <li>เปิดลิงก์ในอีเมลนั้น ตั้งรหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร) และกรอกยืนยันให้ตรงกัน</li>
        </Steps>
        <Note>
          ถ้ารอสักพักแล้วไม่พบอีเมล ให้ตรวจโฟลเดอร์จดหมายขยะ แล้วติดต่อผู้ดูแลระบบ
        </Note>
      </div>
    ),
  },
  {
    id: 'menu-and-permissions',
    audience: 'all',
    title: 'เมนูด้านซ้ายและสิทธิ์การใช้งาน',
    routes: ['/dashboard'],
    body: (
      <div className="space-y-3">
        <p>
          เมนูด้านซ้ายเป็นทางเข้าไปทุกหน้าของระบบ แถบเมนูจะแคบ (แสดงเป็นไอคอน)
          และขยายออกเมื่อเอาเมาส์ไปชี้
        </p>
        <Note>
          <strong>ถ้าไม่เห็นเมนูที่คู่มือบอก ไม่ใช่ว่าระบบเสีย</strong> —
          เมนูที่แต่ละคนเห็นขึ้นอยู่กับ “สิทธิ์” ที่ผู้ดูแลระบบตั้งให้ตามบทบาทของบัญชี
          ถ้าต้องใช้เมนูใด ให้แจ้งผู้ดูแลระบบของห้องคุณ
        </Note>
        <p>
          ชื่อและบทบาทของคุณแสดงอยู่ที่ด้านล่างของเมนู
          ใช้ตรวจว่ากำลังล็อกอินด้วยบัญชีที่ถูกต้องหรือไม่
        </p>
      </div>
    ),
  },
  {
    id: 'switch-room',
    audience: 'all',
    title: 'สลับงาน (ห้อง) ที่กำลังทำ',
    routes: ['/dashboard'],
    body: (
      <div className="space-y-3">
        <p>
          ระบบเก็บข้อมูลแยกตามงาน/ห้องปฏิบัติการ ข้อมูลที่คุณเห็นและบันทึกจะเป็นของ
          “งานที่ใช้อยู่” เท่านั้น ที่เมนูด้านซ้ายจะมีกล่อง <Btn>งานที่ใช้อยู่</Btn> บอกว่าตอนนี้อยู่งานไหน
        </p>
        <Steps>
          <li>ที่กล่อง <Btn>สลับงาน</Btn> เลือกงานที่ต้องการ</li>
          <li>ระบบถามยืนยัน “สลับไปงาน … ? ข้อมูลที่ยังไม่บันทึกในหน้านี้จะหาย”</li>
          <li>ยืนยัน แล้วรอจนระบบสลับเสร็จ (ขึ้นว่า “กำลังสลับงาน…”)</li>
        </Steps>
        <Note>
          บัญชีที่มีสิทธิ์ดูหลายงานอาจเห็นตัวเลือก <Btn>ดูทุกงาน (อ่านอย่างเดียว)</Btn>
          โหมดนี้ใช้ดูข้อมูลได้อย่างเดียว <strong>บันทึกอะไรไม่ได้</strong> ต้องเลือกงานก่อนจึงจะบันทึกได้
          ถ้าไม่เห็นกล่องสลับงาน แสดงว่าบัญชีของคุณอยู่ในงานเดียว
        </Note>
      </div>
    ),
  },
];
