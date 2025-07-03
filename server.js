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
let currentPosition = 0;
let calledPatientId = null;
const clinicName = "City Medical Center";

// Helper Functions
const sortQueue = () => {
  const priorityValues = { emergency: 4, priority: 3, elderly: 2, normal: 1 };
  queue.sort((a, b) => {
    return priorityValues[b.priority] - priorityValues[a.priority] || 
           new Date(a.timestamp) - new Date(b.timestamp);
  });
};

// API Endpoints
app.get('/api/queue', (req, res) => {
  res.json({
    queue,
    currentPosition,
    calledPatientId,
    clinicName,
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
  if (currentPosition >= queue.length - 1) {
    return res.status(400).json({ error: 'No more patients in queue' });
  }

  if (calledPatientId) {
    queue[currentPosition].status = 'completed';
  }

  currentPosition++;
  calledPatientId = null;
  res.json({ currentPosition });
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
  
  // If we're updating the currently called patient, update the calledPatientId
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
  
  // Adjust current position if needed
  if (index < currentPosition) {
    currentPosition--;
  }
  
  // If we removed the called patient, clear the calledPatientId
  if (calledPatientId === id) {
    calledPatientId = null;
  }

  res.json(removedPatient);
});

app.post('/api/clear', (req, res) => {
  queue = [];
  currentPosition = 0;
  calledPatientId = null;
  res.json({ message: 'Queue cleared' });
});

// NEW ENDPOINT FOR REORDERING
app.post('/api/reorder', (req, res) => {
  const { patientId, newPosition } = req.body;
  
  // Validate inputs
  if (!patientId || newPosition === undefined || newPosition < 0) {
    return res.status(400).json({ error: 'Invalid reorder request' });
  }

  const oldIndex = queue.findIndex(p => p.id === patientId);
  if (oldIndex === -1) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  // Don't allow moving beyond array bounds
  if (newPosition >= queue.length) {
    return res.status(400).json({ error: 'Invalid new position' });
  }

  // Get the patient and remove from old position
  const [patient] = queue.splice(oldIndex, 1);
  
  // Insert at new position
  queue.splice(newPosition, 0, patient);
  
  // Update currentPosition if needed
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
    version: '1.0.0'
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});