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
const clinicName = "City Medical Center";
const MAX_COMPLETED_PATIENTS = 20;

// Helper Functions
const sortQueue = () => {
  const priorityValues = { emergency: 4, priority: 3, elderly: 2, normal: 1 };
  queue.sort((a, b) => {
    return priorityValues[b.priority] - priorityValues[a.priority] || 
           new Date(a.timestamp) - new Date(b.timestamp);
  });
};

const addToCompleted = (patient) => {
  // Create a copy of the patient without the status field
  const completedPatient = {
    id: patient.id,
    name: patient.name,
    priority: patient.priority,
    notes: patient.notes,
    timestamp: patient.timestamp,
    completedAt: new Date().toISOString()
  };
  
  completedPatients.unshift(completedPatient);
  
  if (completedPatients.length > MAX_COMPLETED_PATIENTS) {
    completedPatients.pop();
  }
};

// API Endpoints
app.get('/api/queue', (req, res) => {
  res.json({
    queue,
    currentPosition,
    calledPatientId,
    clinicName,
    completedPatients, // Include completed patients in the main endpoint
    lastUpdated: new Date().toISOString()
  });
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
    timestamp: new Date().toISOString()
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
    addToCompleted(completedPatient);
  }

  // Remove the completed patient from the queue
  queue.splice(currentPosition, 1);
  
  // Don't increment position since we removed an item
  calledPatientId = null;
  
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
  const { name, priority, notes } = req.body;
  const index = queue.findIndex(p => p.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  queue[index] = {
    ...queue[index],
    name: name || queue[index].name,
    priority: priority || queue[index].priority,
    notes: notes || queue[index].notes
  };

  sortQueue();
  
  if (calledPatientId === id) {
    calledPatientId = queue[index].id;
  }
  
  res.json(queue[index]);
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

  // Get the patient and remove from old position
  const [patient] = queue.splice(oldIndex, 1);
  
  // Insert at new position
  queue.splice(newPosition, 0, patient);
  
  // Update currentPosition based on the actual movement
  if (calledPatientId === patientId) {
    currentPosition = newPosition;
  } else if (oldIndex === currentPosition) {
    currentPosition = newPosition;
  } else if (oldIndex < currentPosition && newPosition >= currentPosition) {
    currentPosition--;
  } else if (oldIndex > currentPosition && newPosition <= currentPosition) {
    currentPosition++;
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
    version: '1.2.0'
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