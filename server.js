const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

const DATA_PATH = path.join(__dirname, 'data.json');

// CORS
app.use(cors({
  origin: ['https://medical-queue.onrender.com', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Default State
let queue = [];
let completedPatients = [];
let currentPosition = 0;
let calledPatientId = null;
let historyStack = [];
const clinicName = "Dr Maher Mahmoud Clinics";
const MAX_COMPLETED_PATIENTS = 2000;

// Load data on startup
function loadData() {
  if (fs.existsSync(DATA_PATH)) {
    try {
      const raw = fs.readFileSync(DATA_PATH);
      const data = JSON.parse(raw);
      queue = data.queue || [];
      completedPatients = data.completedPatients || [];
      currentPosition = data.currentPosition || 0;
      calledPatientId = data.calledPatientId || null;
      historyStack = data.historyStack || [];
    } catch (e) {
      console.error("Error loading saved data:", e);
    }
  }
}

// Save data after any change
function saveData() {
  const data = {
    queue,
    completedPatients,
    currentPosition,
    calledPatientId,
    historyStack
  };
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

loadData();

const sortQueue = () => {
  const priorityValues = { emergency: 4, priority: 3, elderly: 2, normal: 1 };
  queue.sort((a, b) => {
    return priorityValues[b.priority] - priorityValues[a.priority] ||
           new Date(a.timestamp) - new Date(b.timestamp);
  });
};

const addToCompleted = (patient, status = 'completed') => {
  const completedPatient = {
    id: patient.id,
    name: patient.name,
    priority: patient.priority,
    notes: patient.notes,
    timestamp: patient.timestamp,
    completedAt: new Date().toISOString(),
    patientNumber: patient.patientNumber,
    status
  };

  completedPatients.unshift(completedPatient);
  if (completedPatients.length > MAX_COMPLETED_PATIENTS) {
    completedPatients.pop();
  }

  saveData();
};

// API Routes
app.get('/api/queue', (req, res) => {
  sortQueue();
  res.json({
    queue,
    currentPosition,
    calledPatientId,
    clinicName,
    completedPatients: completedPatients.slice(0, 5),
    lastUpdated: new Date().toISOString()
  });
});

app.get('/api/completed', (req, res) => {
  res.json(completedPatients);
});

app.post('/api/add', (req, res) => {
  const { name, priority = 'normal', notes = '' } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Patient name is required' });
  }

  const newPatient = {
    id: Date.now().toString(),
    name,
    priority,
    notes,
    status: 'waiting',
    timestamp: new Date().toISOString(),
    patientNumber: queue.length + 1
  };

  queue.push(newPatient);
  sortQueue();
  saveData();

  res.status(201).json(newPatient);
});

app.post('/api/call', (req, res) => {
  if (currentPosition >= queue.length) {
    return res.status(400).json({ error: 'No patients to call' });
  }

  calledPatientId = queue[currentPosition].id;
  queue[currentPosition].status = 'serving';
  saveData();

  res.json({ calledPatientId });
});

app.post('/api/next', (req, res) => {
  if (currentPosition >= queue.length) {
    return res.status(400).json({ error: 'No more patients in queue' });
  }

  const currentPatient = queue[currentPosition];

  historyStack.push({ ...currentPatient });

  if (calledPatientId) {
    addToCompleted(currentPatient, 'completed');
  } else {
    addToCompleted(currentPatient, 'skipped');
  }

  queue.splice(currentPosition, 1);
  calledPatientId = null;

  if (currentPosition >= queue.length) {
    currentPosition = 0;
  }

  saveData();

  res.json({
    currentPosition,
    queue,
    completedPatients
  });
});

app.post('/api/previous', (req, res) => {
  if (historyStack.length === 0) {
    return res.status(400).json({ error: 'No previous patient' });
  }

  const lastPatient = historyStack.pop();

  if (queue.find(p => p.id === lastPatient.id)) {
    return res.status(400).json({ error: 'Patient already in queue' });
  }

  queue.splice(currentPosition, 0, lastPatient);
  queue[currentPosition].status = 'serving';
  calledPatientId = lastPatient.id;

  queue.forEach((p, i) => p.patientNumber = i + 1);

  saveData();

  res.json({ currentPosition, queue });
});

app.post('/api/update/:id', (req, res) => {
  const { id } = req.params;
  const { name, priority, notes, patientNumber } = req.body;
  const index = queue.findIndex(p => p.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const updatedPatient = {
    ...queue[index],
    name: name || queue[index].name,
    priority: priority || queue[index].priority,
    notes: notes || queue[index].notes
  };

  queue.splice(index, 1);

  let newIndex = queue.length;
  if (!isNaN(patientNumber) && patientNumber > 0 && patientNumber <= queue.length + 1) {
    newIndex = patientNumber - 1;
  }

  queue.splice(newIndex, 0, updatedPatient);
  queue.forEach((p, i) => p.patientNumber = i + 1);

  if (calledPatientId === id) {
    currentPosition = queue.findIndex(p => p.id === calledPatientId);
  }

  saveData();

  res.json(updatedPatient);
});

app.delete('/api/remove/:id', (req, res) => {
  const { id } = req.params;
  const index = queue.findIndex(p => p.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const [removedPatient] = queue.splice(index, 1);

  if (index < currentPosition) {
    currentPosition--;
  }

  if (calledPatientId === id) {
    calledPatientId = null;
  }

  saveData();

  res.json(removedPatient);
});

app.post('/api/clear', (req, res) => {
  queue = [];
  completedPatients = [];
  currentPosition = 0;
  calledPatientId = null;
  historyStack = [];

  saveData();

  res.json({ message: 'Queue and completed patients cleared' });
});

app.post('/api/reorder', (req, res) => {
  const { patientId, newPosition } = req.body;

  if (!patientId || newPosition === undefined || newPosition < 0 || newPosition >= queue.length) {
    return res.status(400).json({ error: 'Invalid reorder request' });
  }

  const oldIndex = queue.findIndex(p => p.id === patientId);
  if (oldIndex === -1) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  if (calledPatientId === patientId) {
    return res.status(400).json({ error: 'Cannot reorder a patient currently being served' });
  }

  const [patient] = queue.splice(oldIndex, 1);
  queue.splice(newPosition, 0, patient);
  queue.forEach((p, i) => p.patientNumber = i + 1);

  if (oldIndex < currentPosition && newPosition >= currentPosition) {
    currentPosition--;
  } else if (oldIndex > currentPosition && newPosition <= currentPosition) {
    currentPosition++;
  } else if (oldIndex === currentPosition) {
    currentPosition = newPosition;
  }

  saveData();

  res.json({ success: true, queue, currentPosition, calledPatientId });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    queueLength: queue.length,
    completedPatients: completedPatients.length,
    version: '16.7.59'
  });
});

app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
