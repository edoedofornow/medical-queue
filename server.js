const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// CORS Configuration
app.use(cors({
  origin: ['https://medical-queue.onrender.com', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Queue State
let queue = [];
let completedPatients = [];
let currentPosition = 0;
let calledPatientId = null;
const clinicName = "Dr Maher Mahmoud Clinics";
const MAX_COMPLETED_PATIENTS = 2000;

// Helper Functions
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
    status: status
  };
  
  completedPatients.unshift(completedPatient);
  
  if (completedPatients.length > MAX_COMPLETED_PATIENTS) {
    completedPatients.pop();
  }
};

// API Endpoints
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
  res.status(201).json(newPatient);
});

app.post('/api/call', (req, res) => {
  if (currentPosition >= queue.length) {
    return res.status(400).json({ error: 'No patients to call' });
  }

  calledPatientId = queue[currentPosition].id;
  queue[currentPosition].status = 'serving';
  res.json({ calledPatientId });
});

app.post('/api/next', (req, res) => {
  if (currentPosition >= queue.length) {
    return res.status(400).json({ error: 'No more patients in queue' });
  }

  if (calledPatientId) {
    const completedPatient = queue[currentPosition];
    addToCompleted(completedPatient, 'completed');
  } else {
    const skippedPatient = queue[currentPosition];
    addToCompleted(skippedPatient, 'skipped');
  }

  queue.splice(currentPosition, 1);
  calledPatientId = null;

  if (currentPosition >= queue.length) {
    currentPosition = 0;
  }

  res.json({ 
    currentPosition,
    queue,
    completedPatients
  });
});

app.post('/api/previous', (req, res) => {
  if (currentPosition <= 0) {
    return res.status(400).json({ error: 'No previous patient' });
  }

  currentPosition--;
  calledPatientId = queue[currentPosition].id;
  queue[currentPosition].status = 'serving';
  res.json({ currentPosition });
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

  queue.splice(index, 1); // Remove patient

  let newIndex = queue.length; // default to end
  if (!isNaN(patientNumber) && patientNumber > 0 && patientNumber <= queue.length + 1) {
    newIndex = patientNumber - 1;
  }

  queue.splice(newIndex, 0, updatedPatient);

  // Reassign patient numbers
  queue.forEach((p, i) => p.patientNumber = i + 1);

  // Update currentPosition if needed
  if (calledPatientId === id) {
    currentPosition = queue.findIndex(p => p.id === calledPatientId);
  }

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

  res.json(removedPatient);
});

app.post('/api/clear', (req, res) => {
  queue = [];
  completedPatients = [];
  currentPosition = 0;
  calledPatientId = null;
  res.json({ message: 'Queue cleared' });
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

  // Recalculate patient numbers
  queue.forEach((p, i) => p.patientNumber = i + 1);

  // Recalculate currentPosition if needed
  if (oldIndex < currentPosition && newPosition >= currentPosition) {
    currentPosition--;
  } else if (oldIndex > currentPosition && newPosition <= currentPosition) {
    currentPosition++;
  } else if (oldIndex === currentPosition) {
    currentPosition = newPosition;
  }

  res.json({
    success: true,
    queue,
    currentPosition,
    calledPatientId
  });
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
