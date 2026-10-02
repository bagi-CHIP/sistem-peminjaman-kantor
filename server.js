const express = require('express');
const bodyParser = require('body-parser');
const path = require('path'); // 1. Tambahkan modul path bawaan Node.js
const db = require('./database');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());

// 2. Gunakan path.join agar Express menemukan folder public secara tepat
app.use(express.static(path.join(__dirname, 'public')));

// 3. Tambahkan rute khusus ini untuk memastikan halaman admin selalu bisa dipanggil
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- API BARANG ---
// Get list barang (bisa dengan query pencarian)
app.get('/api/barang', (req, res) => {
  const search = req.query.search || '';
  const sql = "SELECT * FROM barang WHERE kode LIKE ? OR nama LIKE ?";
  db.all(sql, [`%${search}%`, `%${search}%`], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Tambah barang baru (Admin)
app.post('/api/admin/barang/tambah', (req, res) => {
  const { kode, nama, satuan, stok } = req.body;
  db.run(
    "INSERT INTO barang (kode, nama, satuan, stok) VALUES (?, ?, ?, ?)",
    [kode, nama, satuan, stok],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Update stok barang langsung (Admin)
app.post('/api/admin/barang/update-stok', (req, res) => {
  const { id, stok } = req.body;
  db.run("UPDATE barang SET stok = ? WHERE id = ?", [stok, id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// --- API PEMINJAMAN ---
// Submit Peminjaman
app.post('/api/peminjaman', (req, res) => {
  const { nama, email, bidang, keperluan, items } = req.body;
  const noPinjam = 'PR-' + Math.floor(10000 + Math.random() * 90000);

  db.run(
    `INSERT INTO peminjaman (nomor_pinjam, nama_peminjam, email, bidang, keperluan) VALUES (?, ?, ?, ?, ?)`,
    [noPinjam, nama, email, bidang, keperluan],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      const peminjamanId = this.lastID;

      const stmt = db.prepare(`INSERT INTO detail_peminjaman (peminjaman_id, barang_id, jumlah) VALUES (?, ?, ?)`);
      items.forEach(item => {
        if (item.jumlah > 0) stmt.run(peminjamanId, item.barang_id, item.jumlah);
      });
      stmt.finalize();

      res.json({ success: true, nomor_pinjam: noPinjam });
    }
  );
});

// Get daftar peminjaman beserta detail barangnya (Admin)
app.get('/api/admin/peminjaman', (req, res) => {
  const sql = `
    SELECT p.*, 
           GROUP_CONCAT(b.nama || ' (' || dp.jumlah || ' ' || b.satuan || ')', ', ') AS item_list
    FROM peminjaman p
    LEFT JOIN detail_peminjaman dp ON p.id = dp.peminjaman_id
    LEFT JOIN barang b ON dp.barang_id = b.id
    GROUP BY p.id
    ORDER BY p.tanggal DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Update status & potong stok otomatis jika disetujui
app.post('/api/admin/peminjaman/status', (req, res) => {
  const { id, status } = req.body;

  db.get("SELECT status FROM peminjaman WHERE id = ?", [id], (err, row) => {
    if (err || !row) return res.status(500).json({ error: 'Data tidak ditemukan' });
    if (row.status === status) return res.json({ success: true }); // Tidak ada perubahan

    // Jika disetujui dan sebelumnya bukan disetujui -> potong stok
    if (status === 'Disetujui' && row.status !== 'Disetujui') {
      db.all("SELECT barang_id, jumlah FROM detail_peminjaman WHERE peminjaman_id = ?", [id], (err, items) => {
        if (err) return res.status(500).json({ error: err.message });

        items.forEach(item => {
          db.run("UPDATE barang SET stok = MAX(0, stok - ?) WHERE id = ?", [item.jumlah, item.barang_id]);
        });

        db.run("UPDATE peminjaman SET status = ? WHERE id = ?", [status, id], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true });
        });
      });
    } else {
      db.run("UPDATE peminjaman SET status = ? WHERE id = ?", [status, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server berjalan di:`);
  console.log(`- Lokal: http://localhost:${PORT}`);
  console.log(`- Jaringan Wi-Fi: http://10.10.7.9:${PORT}`);
});