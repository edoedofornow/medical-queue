const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['https://medical-queue.onrender.com', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("✅ Connected to MongoDB");
}).catch(err => {
  console.error("❌ MongoDB connection error:", err.message);
});

// Mongoose Models
const patientSchema = new mongoose.Schema({
  name: String,
  priority: String,
  notes: String,
  status: String,
  timestamp: String,
  patientNumber: Number
});

const completedPatientSchema = new mongoose.Schema({
  name: String,
  priority: String,
  notes: String,
  timestamp: String,
  completedAt: String,
  patientNumber: Number,
  status: String
});

const Patient = mongoose.model('Patient', patientSchema);
const CompletedPatient = mongoose.model('CompletedPatient', completedPatientSchema);

let calledPatientId = null;
let historyStack = [];
const clinicName = "Dr Maher Mahmoud Clinics";
const MAX_COMPLETED_PATIENTS = 2000;

const sortQueue = async () => {
  const priorityValues = { emergency: 4, priority: 3, elderly: 2, normal: 1 };
  const patients = await Patient.find({});
  patients.sort((a, b) => {
    return priorityValues[b.priority] - priorityValues[a.priority] ||
           new Date(a.timestamp) - new Date(b.timestamp);
  });
  for (let i = 0; i < patients.length; i++) {
    patients[i].patientNumber = i + 1;
    await patients[i].save();
  }
};

const addToCompleted = async (patient, status = 'completed') => {
  const completed = new CompletedPatient({
    name: patient.name,
    priority: patient.priority,
    notes: patient.notes,
    timestamp: patient.timestamp,
    completedAt: new Date().toISOString(),
    patientNumber: patient.patientNumber,
    status
  });
  await completed.save();
  const count = await CompletedPatient.countDocuments();
  if (count > MAX_COMPLETED_PATIENTS) {
    const oldest = await CompletedPatient.findOne().sort({ completedAt: 1 });
    if (oldest) await oldest.deleteOne();
  }
};

app.get('/api/queue', async (req, res) => {
  await sortQueue();
  const queue = await Patient.find().sort({ patientNumber: 1 });
  const completedPatients = await CompletedPatient.find().sort({ completedAt: -1 }).limit(5);
  res.json({
    queue,
    currentPosition: 0,
    calledPatientId,
    clinicName,
    completedPatients,
    lastUpdated: new Date().toISOString()
  });
});

app.get('/api/completed', async (req, res) => {
  const completed = await CompletedPatient.find().sort({ completedAt: -1 });
  res.json(completed);
});

app.post('/api/add', async (req, res) => {
  const { name, priority = 'normal', notes = '' } = req.body;
  if (!name) return res.status(400).json({ error: 'Patient name is required' });
  const queueLength = await Patient.countDocuments();
  const newPatient = new Patient({
    name,
    priority,
    notes,
    status: 'waiting',
    timestamp: new Date().toISOString(),
    patientNumber: queueLength + 1
  });
  await newPatient.save();
  await sortQueue();
  res.status(201).json(newPatient);
});

app.post('/api/call', async (req, res) => {
  const queue = await Patient.find().sort({ patientNumber: 1 });
  if (queue.length === 0) return res.status(400).json({ error: 'No patients to call' });
  const patient = queue[0];
  calledPatientId = patient._id.toString();
  patient.status = 'serving';
  await patient.save();
  res.json({ calledPatientId });
});

app.post('/api/next', async (req, res) => {
  const queue = await Patient.find().sort({ patientNumber: 1 });
  if (queue.length === 0) return res.status(400).json({ error: 'No patients in queue' });
  const currentPatient = queue[0];
  historyStack.push({ ...currentPatient._doc });
  if (calledPatientId) await addToCompleted(currentPatient, 'completed');
  else await addToCompleted(currentPatient, 'skipped');
  await currentPatient.deleteOne();
  calledPatientId = null;
  res.json({
    currentPosition: 0,
    queue: await Patient.find().sort({ patientNumber: 1 }),
    completedPatients: await CompletedPatient.find().sort({ completedAt: -1 }).limit(5)
  });
});

app.post('/api/previous', async (req, res) => {
  if (historyStack.length === 0) return res.status(400).json({ error: 'No previous patient' });
  const lastPatient = historyStack.pop();
  const exists = await Patient.findOne({ _id: lastPatient._id });
  if (exists) return res.status(400).json({ error: 'Patient already in queue' });
  const restored = new Patient({ ...lastPatient, status: 'serving', timestamp: new Date().toISOString() });
  await restored.save();
  await sortQueue();
  calledPatientId = restored._id.toString();
  res.json({
    currentPosition: 0,
    queue: await Patient.find().sort({ patientNumber: 1 })
  });
});

app.post('/api/update/:id', async (req, res) => {
  const { id } = req.params;
  const { name, priority, notes, patientNumber } = req.body;
  const patient = await Patient.findById(id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  patient.name = name || patient.name;
  patient.priority = priority || patient.priority;
  patient.notes = notes || patient.notes;
  await patient.save();
  await sortQueue();
  res.json(patient);
});

app.delete('/api/remove/:id', async (req, res) => {
  const { id } = req.params;
  const patient = await Patient.findById(id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  await patient.deleteOne();
  if (calledPatientId === id) calledPatientId = null;
  res.json({ success: true });
});

app.post('/api/clear', async (req, res) => {
  await Patient.deleteMany({});
  await CompletedPatient.deleteMany({});
  calledPatientId = null;
  historyStack = [];
  res.json({ message: 'Queue and completed patients cleared' });
});

app.post('/api/reorder', async (req, res) => {
  const { patientId, newPosition } = req.body;
  const queue = await Patient.find().sort({ patientNumber: 1 });
  if (!patientId || newPosition === undefined || newPosition < 0 || newPosition >= queue.length) {
    return res.status(400).json({ error: 'Invalid reorder request' });
  }
  const index = queue.findIndex(p => p._id.toString() === patientId);
  if (index === -1) return res.status(404).json({ error: 'Patient not found' });
  if (calledPatientId === patientId) return res.status(400).json({ error: 'Cannot reorder serving patient' });
  const patient = queue.splice(index, 1)[0];
  queue.splice(newPosition, 0, patient);
  for (let i = 0; i < queue.length; i++) {
    queue[i].patientNumber = i + 1;
    await queue[i].save();
  }
  res.json({ success: true, queue });
});

app.get('/health', async (req, res) => {
  const queueLength = await Patient.countDocuments();
  const completedLength = await CompletedPatient.countDocuments();
  res.json({
    status: 'healthy',
    queueLength,
    completedPatients: completedLength,
    version: 'Mongo-1.0'
  });
});

// Frontend
app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
