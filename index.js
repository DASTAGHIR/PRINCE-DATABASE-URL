import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

const dbFolder = './files';
const dbFiles = ['db.json', 'db1.json', 'db2.json', 'db3.json', 'db4.json', 'db5.json'];
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB file size limit for each file

class Stater extends EventEmitter {
  constructor(props) {
    super(props);
    this.state = true;
  }

  setState(newState) {
    this.state = newState || false;
    this.emit('set', newState);
  }

  waitForTrue() {
    return new Promise((resolve) => {
      const check = () => {
        if (this.state) {
          this.off('set', check);
          resolve();
        }
      };
      this.on('set', check);
      check();
    });
  }
}

const isOpen = new Stater();

const app = express();

// Middleware to parse JSON requests
app.use(express.json());

// Function to clean a database file if it exceeds the size limit
async function cleanDatabase(filePath) {
  try {
    const fileData = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(fileData);

    // Clean data if size exceeds MAX_FILE_SIZE / 2
    if (Array.isArray(data)) {
      while (JSON.stringify(data).length > MAX_FILE_SIZE / 2) {
        data.shift();
      }
    } else if (typeof data === 'object') {
      const keys = Object.keys(data);
      while (JSON.stringify(data).length > MAX_FILE_SIZE / 2) {
        delete data[keys.shift()];
      }
    }

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`🧹 ${filePath} cleaned to maintain size limit.`);
  } catch (error) {
    console.error(`❌ Error cleaning ${filePath}:`, error);
  }
}

// Function to get the current database file
async function getCurrentDatabaseFile() {
  for (const dbFile of dbFiles) {
    const filePath = path.join(dbFolder, dbFile);
    try {
      const stats = await fs.stat(filePath);
      if (stats.size < MAX_FILE_SIZE) {
        return filePath;
      }
    } catch {
      await fs.writeFile(filePath, JSON.stringify([], null, 2), 'utf8');
      return filePath;
    }
  }

  console.log('⚠️ All database files exceeded size. Cleaning the first file...');
  const firstFilePath = path.join(dbFolder, dbFiles[0]);
  await cleanDatabase(firstFilePath);
  return firstFilePath;
}

// Function to safely read JSON from a file
async function readJsonFile(filePath) {
  try {
    const fileData = await fs.readFile(filePath, 'utf8');
    return JSON.parse(fileData);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`❌ Invalid JSON in file: ${filePath}. Resetting the file.`);
      // Reset to an empty array if the JSON is invalid
      await fs.writeFile(filePath, JSON.stringify([], null, 2), 'utf8');
      return [];
    }
    throw error; // Re-throw other errors
  }
}

// GET route to fetch data from all database files
app.get('/', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  await isOpen.waitForTrue();
  isOpen.setState(false);

  try {
    const allData = [];
    for (const dbFile of dbFiles) {
      const filePath = path.join(dbFolder, dbFile);
      try {
        const data = await readJsonFile(filePath);
        allData.push(...(Array.isArray(data) ? data : [data]));
      } catch (error) {
        console.error(`⚠️ Skipping invalid or empty file: ${dbFile}`);
      }
    }
    res.status(200).json({ message: '📂 Data fetched successfully!', data: allData });
  } catch (error) {
    console.error('❌ Error fetching data:', error);
    res.status(500).json({ error: 'Internal Server Error 😢' });
  } finally {
    isOpen.setState(true);
  }
});

// POST route to add data to the current database file
app.post('/', async (req, res) => {
  if (req.headers['content-type'] !== 'application/json') {
    return res.status(400).json({
      error: 'Invalid Type ❌',
      message: 'Content-Type must be application/json 🛠️',
    });
  }

  await isOpen.waitForTrue();
  isOpen.setState(false);

  try {
    const filePath = await getCurrentDatabaseFile();

    let existingData = await readJsonFile(filePath);

    // Append new data
    if (Array.isArray(existingData)) {
      existingData.push(req.body);
    } else {
      existingData = [existingData, req.body];
    }

    // Write updated data back to the file
    await fs.writeFile(filePath, JSON.stringify(existingData, null, 2), 'utf8');
    res.status(200).json({ message: '✅ Data added successfully!', data: req.body });
  } catch (error) {
    console.error('❌ Error writing to database:', error);
    res.status(500).json({ error: 'Internal Server Error 😢' });
  } finally {
    isOpen.setState(true);
  }
});

// Ensure database folder exists
async function initializeDatabase() {
  try {
    await fs.mkdir(dbFolder, { recursive: true });
    for (const dbFile of dbFiles) {
      const filePath = path.join(dbFolder, dbFile);
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, JSON.stringify([], null, 2), 'utf8');
        console.log(`📝 Initialized file: ${dbFile}`);
      }
    }
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
}

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log(`🚀 Server is running on port ${port}`);
  await initializeDatabase();
});
