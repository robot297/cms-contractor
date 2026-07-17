import express from 'express';
import path from 'path';
import cors from 'cors';
import bodyParser from 'body-parser';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'dist')));

// Database setup
const db = new sqlite3.Database('./data/contractors.db', (err) => {
  if (err) {
    console.error('Database error:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      company TEXT,
      hourly_rate REAL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'Not Started',
      start_date DATE,
      end_date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(client_id) REFERENCES clients(id)
    )
  `);
}

// API Routes - Clients
app.get('/api/clients', (req, res) => {
  db.all('SELECT * FROM clients ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/api/clients/:id', (req, res) => {
  db.get('SELECT * FROM clients WHERE id = ?', [req.params.id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(row);
    }
  });
});

app.post('/api/clients', (req, res) => {
  const { name, email, phone, company, hourly_rate, notes } = req.body;
  db.run(
    'INSERT INTO clients (name, email, phone, company, hourly_rate, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [name, email, phone, company, hourly_rate, notes],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ id: this.lastID });
      }
    }
  );
});

app.put('/api/clients/:id', (req, res) => {
  const { name, email, phone, company, hourly_rate, notes } = req.body;
  db.run(
    'UPDATE clients SET name = ?, email = ?, phone = ?, company = ?, hourly_rate = ?, notes = ? WHERE id = ?',
    [name, email, phone, company, hourly_rate, notes, req.params.id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ changes: this.changes });
      }
    }
  );
});

app.delete('/api/clients/:id', (req, res) => {
  db.run('DELETE FROM clients WHERE id = ?', [req.params.id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ changes: this.changes });
    }
  });
});

// API Routes - Projects
app.get('/api/projects', (req, res) => {
  db.all(`
    SELECT p.*, c.name as client_name FROM projects p
    LEFT JOIN clients c ON p.client_id = c.id
    ORDER BY p.created_at DESC
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/api/clients/:id/projects', (req, res) => {
  db.all('SELECT * FROM projects WHERE client_id = ? ORDER BY created_at DESC', [req.params.id], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.post('/api/projects', (req, res) => {
  const { client_id, title, description, status, start_date, end_date } = req.body;
  db.run(
    'INSERT INTO projects (client_id, title, description, status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)',
    [client_id, title, description, status, start_date, end_date],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ id: this.lastID });
      }
    }
  );
});

app.put('/api/projects/:id', (req, res) => {
  const { title, description, status, start_date, end_date } = req.body;
  db.run(
    'UPDATE projects SET title = ?, description = ?, status = ?, start_date = ?, end_date = ? WHERE id = ?',
    [title, description, status, start_date, end_date, req.params.id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ changes: this.changes });
      }
    }
  );
});

app.delete('/api/projects/:id', (req, res) => {
  db.run('DELETE FROM projects WHERE id = ?', [req.params.id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ changes: this.changes });
    }
  });
});

// Serve index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
