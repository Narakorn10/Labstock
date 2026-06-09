# 📓 คู่มือการเชื่อมต่อ NotebookLM กับ Gemini CLI
*จัดทำขึ้นเพื่อเป็นแนวทางสำหรับการเชื่อมต่อระบบความรู้ภายนอกเข้ากับ Terminal*

การเชื่อมต่อ NotebookLM ช่วยให้ AI สามารถเข้าถึงเอกสารส่วนตัวของคุณ (PDF, เว็บไซต์, โน้ต) และนำมาใช้เป็นฐานข้อมูลในการตอบคำถาม (Source-grounding) ได้อย่างแม่นยำ

---

## 🛠️ 1. การติดตั้ง (Installation)
ใช้คำสั่งผ่าน **Skills CLI** เพื่อติดตั้งตัวเชื่อมต่อ (Bridge):
```bash
npx skills add pleaseprompto/notebooklm-skill@notebooklm -g -y
```

## 🔐 2. การยืนยันตัวตน (Authentication)
เนื่องจาก NotebookLM ต้องเข้าถึงบัญชี Google ของคุณ คุณต้องทำการ Login ผ่าน Browser ครั้งแรกเพียงครั้งเดียว:

1.  **ย้ายไปที่โฟลเดอร์ Skill:**
    `cd ~\.agents\skills\notebooklm`
2.  **รันคำสั่ง Setup:**
    `python scripts/run.py auth_manager.py setup`
3.  **ขั้นตอนใน Browser:** หน้าต่าง Chrome จะเปิดขึ้นมา ให้คุณทำการ Login บัญชี Google ให้เรียบร้อย เมื่อเสร็จแล้วระบบจะบันทึก Session ไว้ในเครื่อง

---

## 📚 3. การจัดการสมุดโน้ต (Library Management)
คุณต้องเพิ่ม URL ของ Notebook ที่ต้องการให้ AI รู้จักเข้าไปในระบบก่อน:

**คำสั่งเพิ่มสมุดโน้ต:**
```bash
python scripts/run.py notebook_manager.py add \
  --url "https://notebooklm.google.com/notebook/..." \
  --name "ชื่อที่จำง่าย" \
  --description "คำอธิบายเนื้อหาในโน้ตนี้" \
  --topics "หมวดหมู่1, หมวดหมู่2"
```

**คำสั่งดูรายการทั้งหมด:**
```bash
python scripts/run.py notebook_manager.py list
```

---

## 💬 4. การถามคำถาม (Querying)
เมื่อเชื่อมต่อแล้ว คุณสามารถสั่งให้ AI ไปค้นหาข้อมูลในโน้ตได้โดยตรง:

**คำสั่งถามคำถาม:**
```bash
python scripts/run.py ask_question.py --question "คำถามของคุณ" --notebook-id "id-ของโน้ต"
```

---

## 💡 ข้อแนะนำเพิ่มเติม
- **Headless Mode:** โดยปกติระบบจะทำงานเบื้องหลัง แต่ถ้าต้องการดูการทำงานของ AI ใน Browser ให้ตั้งค่า `HEADLESS=false` ในไฟล์ `.env` ของ Skill
- **R2R Support:** แนะนำให้สร้าง Notebook สำหรับเก็บระเบียบปฏิบัติงาน (SOP) ของห้องแล็บ เพื่อให้ AI ช่วยร่างแผนวิจัย R2R ที่ตรงตามมาตรฐานจริง

---
*บันทึกโดย Gemini CLI - เพื่อการทำงานที่ชาญฉลาดและมีหลักฐานอ้างอิง*
