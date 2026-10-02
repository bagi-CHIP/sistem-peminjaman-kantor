const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Inisialisasi Database
const db = new sqlite3.Database('./peminjaman.db', (err) => {
  if (err) {
    console.error('Gagal terhubung ke database:', err.message);
  } else {
    console.log('Terhubung ke database SQLite (peminjaman.db).');
  }
});

// Pembuatan Tabel
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS barang (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kode TEXT UNIQUE,
      nama TEXT NOT NULL,
      satuan TEXT DEFAULT 'pcs',
      stok INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS peminjaman (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama_peminjam TEXT NOT NULL,
      divisi TEXT NOT NULL,
      keperluan TEXT,
      items TEXT NOT NULL,
      status TEXT DEFAULT 'Pending',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Data awal barang jika kosong
  db.get("SELECT COUNT(*) AS count FROM barang", (err, row) => {
    if (err) return;
    if (row.count === 0) {
      const stmt = db.prepare("INSERT INTO barang (kode, nama, satuan, stok) VALUES (?, ?, ?, ?)");
      stmt.run('ATK-001', 'Pen X Data Directfill Ballpoint Pen M-2', 'pcs', 10);
      stmt.run('ATK-002', 'Pen Signo', 'pcs', 10);
      stmt.run('ATK-003', 'Pulpen Hitam Cair /kotak', 'kotak', 5);
      stmt.run('ATK-004', 'Pulpen Biru Cair /kotak', 'kotak', 5);
      stmt.run('ATK-005', 'Pensil TIK', 'pcs', 15);
      stmt.run('ATK-006', 'Spidol Permanen /kotak', 'kotak', 5);
      stmt.run('ATK-007', 'Binder Klip no. 105', 'kotak', 20);
      stmt.finalize();
      console.log('Data sampel ATK berhasil dimasukkan.');
    }
  });
});

// Endpoint Ambil Daftar Barang
app.get('/api/barang', (req, res) => {
  db.all("SELECT * FROM barang ORDER BY id ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Endpoint Tambah Barang Baru
app.post('/api/barang', (req, res) => {
  const { kode, nama, satuan, stok } = req.body;
  if (!nama || stok === undefined) return res.status(400).json({ message: 'Nama dan stok wajib diisi' });

  const query = `INSERT INTO barang (kode, nama, satuan, stok) VALUES (?, ?, ?, ?)`;
  db.run(query, [kode || null, nama, satuan || 'pcs', parseInt(stok)], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Barang berhasil ditambahkan', id: this.lastID });
  });
});

// Endpoint Update Barang
app.put('/api/barang/:id', (req, res) => {
  const { id } = req.params;
  const { nama, stok, kode, satuan } = req.body;

  const query = `
    UPDATE barang 
    SET nama = COALESCE(?, nama), 
        stok = ?, 
        kode = COALESCE(?, kode), 
        satuan = COALESCE(?, satuan) 
    WHERE id = ?
  `;

  db.run(query, [nama, parseInt(stok), kode, satuan, id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Stok barang berhasil diperbarui' });
  });
});

// Endpoint Hapus Barang
app.delete('/api/barang/:id', (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM barang WHERE id = ?`, [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Barang berhasil dihapus' });
  });
});

// Endpoint Ambil Semua Permintaan
app.get('/api/peminjaman', (req, res) => {
  db.all("SELECT * FROM peminjaman ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Endpoint Simpan Permintaan ATK Baru
app.post('/api/peminjaman', (req, res) => {
  const { nama_peminjam, divisi, keperluan, items } = req.body;

  if (!nama_peminjam || !divisi || !items) {
    return res.status(400).json({ message: 'Nama, Bidang/Divisi, dan Barang wajib diisi!' });
  }

  const query = `
    INSERT INTO peminjaman (nama_peminjam, divisi, keperluan, items, status, created_at)
    VALUES (?, ?, ?, ?, 'Pending', datetime('now', 'localtime'))
  `;

  db.run(query, [nama_peminjam, divisi, keperluan || '', items], function (err) {
    if (err) {
      console.error('Database Error:', err.message);
      return res.status(500).json({ message: 'Gagal menyimpan data ke database', error: err.message });
    }
    res.json({ message: 'Permintaan ATK berhasil dikirim!', id: this.lastID });
  });
});

// Endpoint Update Status Permintaan & Potong Stok
app.put('/api/peminjaman/:id', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) return res.status(400).json({ message: 'Status wajib diisi' });

  db.get("SELECT * FROM peminjaman WHERE id = ?", [id], (err, row) => {
    if (err || !row) return res.status(404).json({ message: 'Data tidak ditemukan' });

    if (status === 'Disetujui' && row.status !== 'Disetujui') {
      const itemEntries = row.items.split(',');

      itemEntries.forEach(entry => {
        const match = entry.trim().match(/^(.+)\s+\((\d+)\s*.*\)$/);
        if (match) {
          const namaBarang = match[1].trim();
          const qty = parseInt(match[2]);

          db.run(
            "UPDATE barang SET stok = MAX(0, stok - ?) WHERE nama = ?",
            [qty, namaBarang],
            (err) => {
              if (err) console.error(`Gagal potong stok ${namaBarang}:`, err.message);
            }
          );
        }
      });
    }

    db.run("UPDATE peminjaman SET status = ? WHERE id = ?", [status, id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: `Status berhasil diubah menjadi ${status}` });
    });
  });
});

// Routes Halaman
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server aktif di http://localhost:${PORT}`);
});