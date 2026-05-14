// ============================================================
// SURVEI LAPANGAN – PEMETAAN BAHAYA BANJIR DAS RANDANGAN
// Google Apps Script – Web App Backend
// ------------------------------------------------------------
// SETUP:
//   1. Buka script.google.com → New Project
//   2. Ganti nilai SPREADSHEET_ID dan FOLDER_ID di bawah
//   3. Deploy → New Deployment → Web App
//      - Execute as: Me
//      - Who has access: Anyone
//   4. Copy URL deployment → tempel ke HTML app (variabel APPS_SCRIPT_URL)
// ============================================================

const SPREADSHEET_ID = "GANTI_DENGAN_SPREADSHEET_ID_ANDA";
const FOLDER_ID      = "GANTI_DENGAN_FOLDER_ID_DRIVE_ANDA";
const SHEET_NAME     = "Data Survei";

// ── Header kolom di Spreadsheet ────────────────────────────
const HEADERS = [
  // Identitas & Lokasi
  "No Kuesioner", "Tanggal Survei", "Nama Enumerator", "No HP Enumerator",
  "Latitude", "Longitude", "Elevasi (m)", "Akurasi GPS (m)",
  "Desa/Kelurahan", "Kecamatan", "Kabupaten", "DAS",
  // Responden
  "Nama Responden", "Usia", "Jenis Kelamin", "Lama Tinggal (thn)",
  "Status Kepemilikan", "Flag Reliabilitas Data",
  // Bagian B – Jejak Banjir
  "Pernah Terdampak Banjir", "Frekuensi Banjir 5 Thn",
  "Ada Jejak Fisik", "Tinggi Jejak Banjir (Rekap Tabel)",
  "Tinggi Genangan Terbesar (cm)",
  "Bagian Bangunan Terendam",
  "Arah Datang Banjir",
  "Sisa Genangan Pasca Surut",
  "Elevasi Relatif Lokasi",
  // Bagian C – Karakteristik Bangunan
  "Fungsi Bangunan", "Jumlah Lantai",
  "Tinggi Lantai dari Tanah (cm)",
  "Selisih Genangan-Lantai (cm)",
  "Struktur Bangunan", "Material Atap", "Pondasi",
  "Kondisi Fisik Bangunan", "Upaya Adaptasi Banjir",
  "Tahun Bangunan", "Dimensi Bangunan",
  "Indeks Paparan Bangunan (0-5)",
  // Bagian D – Tutupan Lahan
  "Tutupan Lahan Radius 50m (Ground Truth)",
  "Tutupan Lahan Radius 200m",
  "Perubahan Tutupan Lahan",
  "Kondisi Vegetasi Riparian", "Jarak ke Sungai",
  "Kondisi Drainase", "Perubahan Kondisi Sungai",
  "Kaitan Perubahan Lahan-Banjir",
  "Kaitan Aktivitas Hulu-Banjir",
  // Bagian E – Frekuensi Intensitas Durasi
  "Frekuensi Banjir Wilayah", "Musim Banjir",
  "Kronologi Kejadian (Thn|Bln|Tinggi cm|Durasi|Sumber)",
  "Intensitas Banjir Terbesar",
  "Kecepatan Datang Banjir", "Kecepatan Arus",
  "Material Banjir", "Peringatan Sebelum Banjir",
  "Titik Awal Banjir (Ada/Tidak)", "Titik Awal Banjir (Lokasi)",
  "Durasi Rata-rata Banjir", "Durasi Banjir Terbesar",
  "Tahun Kejadian Terbesar",
  "Lama Kondisi Normal Kembali",
  "Tren Banjir 5 Thn", "Penyebab Utama Banjir",
  // Bagian F – Dampak & Respons
  "Dampak Terbesar", "Lokasi Pengungsian",
  "Pengetahuan Sistem Peringatan Dini",
  // Bagian G – Catatan
  "Catatan Enumerator", "Konfirmasi Kelengkapan Data",
  // Foto
  "Foto 1", "Foto 2", "Foto 3",
  // Metadata
  "Timestamp Kirim", "Versi App"
];

// ── Entry point utama ───────────────────────────────────────
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(30000);
  try {
    const payload = JSON.parse(e.postData.contents);
    const action  = payload.action || "submit";

    if (action === "submit") {
      return handleSubmit(payload);
    } else if (action === "uploadPhoto") {
      return handlePhotoUpload(payload);
    }
    return respond({ status: "error", message: "Unknown action" });
  } catch (err) {
    return respond({ status: "error", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  // Health check & inisialisasi header
  initSheet();
  return respond({ status: "ok", message: "Survei API aktif" });
}

// ── Submit data form ────────────────────────────────────────
function handleSubmit(payload) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let   sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length)
         .setBackground("#0D2B55")
         .setFontColor("#FFFFFF")
         .setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  const data   = payload.data || {};
  const noKues = data["No Kuesioner"] || generateId();

  // Bangun baris sesuai urutan HEADERS
  const row = HEADERS.map(h => {
    const val = data[h];
    if (val === undefined || val === null) return "";
    if (Array.isArray(val)) return val.join(", ");
    return val;
  });

  // Isi timestamp jika kosong
  const tsIdx = HEADERS.indexOf("Timestamp Kirim");
  if (!row[tsIdx]) row[tsIdx] = new Date().toLocaleString("id-ID");

  sheet.appendRow(row);

  // Format baris baru
  const lastRow = sheet.getLastRow();
  if (lastRow % 2 === 0) {
    sheet.getRange(lastRow, 1, 1, HEADERS.length)
         .setBackground("#EBF5FB");
  }

  // Auto-resize kolom (hanya sesekali, tidak tiap submit)
  if (lastRow <= 3) sheet.autoResizeColumns(1, HEADERS.length);

  return respond({ status: "ok", noKuesioner: noKues, row: lastRow });
}

// ── Upload foto ke Drive ────────────────────────────────────
function handlePhotoUpload(payload) {
  const folder   = DriveApp.getFolderById(FOLDER_ID);
  const b64      = payload.data;        // base64 string
  const filename = payload.filename;    // e.g. BJA_0012_20250518_foto1.jpg
  const noKues   = payload.noKuesioner;
  const fotoIdx  = payload.fotoIndex;   // 1, 2, atau 3

  // Decode base64 → blob
  const decoded  = Utilities.base64Decode(b64);
  const blob     = Utilities.newBlob(decoded, "image/jpeg", filename);

  // Cek subfolder per tanggal
  const tanggal  = payload.tanggal || Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");
  let   subfolder;
  const subfolderIter = folder.getFoldersByName(tanggal);
  if (subfolderIter.hasNext()) {
    subfolder = subfolderIter.next();
  } else {
    subfolder = folder.createFolder(tanggal);
  }

  const file    = subfolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileUrl = "https://drive.google.com/file/d/" + file.getId() + "/view";

  // Update link di Sheets
  updatePhotoLink(noKues, fotoIdx, fileUrl);

  return respond({ status: "ok", url: fileUrl, filename });
}

// ── Update kolom foto di baris yang sesuai ─────────────────
function updatePhotoLink(noKues, fotoIdx, url) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;

  const noKuesCol = HEADERS.indexOf("No Kuesioner") + 1;
  const fotoCol   = HEADERS.indexOf("Foto " + fotoIdx) + 1;
  const lastRow   = sheet.getLastRow();
  const colData   = sheet.getRange(2, noKuesCol, lastRow - 1, 1).getValues();

  for (let i = 0; i < colData.length; i++) {
    if (String(colData[i][0]) === String(noKues)) {
      const cell = sheet.getRange(i + 2, fotoCol);
      cell.setValue(url);
      cell.setFormula(`=HYPERLINK("${url}","📷 Foto ${fotoIdx}")`);
      break;
    }
  }
}

// ── Inisialisasi sheet header ───────────────────────────────
function initSheet() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let   sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length)
         .setBackground("#0D2B55")
         .setFontColor("#FFFFFF")
         .setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
}

// ── Helper ─────────────────────────────────────────────────
function generateId() {
  return "BJA_" + Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyyMMdd") +
         "_" + Math.floor(Math.random() * 9000 + 1000);
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
