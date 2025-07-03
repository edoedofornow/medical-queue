const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

// Environment configuration
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Queue state
let queue = [];
let currentPosition = 0;
let calledCustomer = null;
let previousPatients = [];

// Helper function to sort queue
function sortQueue() {
    const priority = { emergency: 4, priority: 3, elderly: 2, normal: 1 };
    queue.sort((a, b) => 
        priority[b.priority] - priority[a.priority] || 
        new Date(a.timestamp) - new Date(b.timestamp)
    );
}

// API Routes
app.get('/api/queue', (req, res) => {
    res.json({ 
        queue, 
        currentPosition, 
        calledCustomer,
        clinicName: "Medical Center"  // Optional clinic name
    });
});

app.post('/api/add', (req, res) => {
    const { name, priority = 'normal', notes = '' } = req.body;
    
    if (!name) {
        return res.status(400).json({ error: 'Patient name is required' });
    }

    const newPatient = {
        name,
        ticket: `P-${(queue.length + 1).toString().padStart(3, '0')}`,
        status: 'waiting',
        priority,
        notes,
        timestamp: new Date().toISOString(),
        queueTime: new Date().toLocaleTimeString()
    };

    queue.push(newPatient);
    sortQueue();
    
    res.status(201).json({
        message: 'Patient added successfully',
        patient: newPatient
    });
});

app.post('/api/call', (req, res) => {
    if (queue.length === 0 || currentPosition >= queue.length) {
        return res.status(400).json({ error: 'No patients to call' });
    }

    calledCustomer = queue[currentPosition].name;
    queue[currentPosition].status = 'serving';
    
    res.json({ 
        message: `Called patient: ${calledCustomer}`,
        calledCustomer
    });
});

app.post('/api/next', (req, res) => {
    if (queue.length === 0) {
        return res.status(400).json({ error: 'Queue is empty' });
    }

    if (currentPosition >= queue.length - 1) {
        return res.status(400).json({ error: 'No more patients in queue' });
    }

    // Store current patient in history
    const currentPatient = queue[currentPosition];
    previousPatients.push({
        ...currentPatient,
        action: calledCustomer ? 'Called' : 'Skipped',
        servedTime: new Date().toLocaleTimeString()
    });

    currentPosition++;
    calledCustomer = null;
    
    res.json({ 
        message: 'Moved to next patient',
        currentPosition
    });
});

app.post('/api/previous', (req, res) => {
    if (previousPatients.length === 0) {
        return res.status(400).json({ error: 'No previous patients' });
    }

    const lastPatient = previousPatients.pop();
    currentPosition = queue.findIndex(p => p.name === lastPatient.name);
    
    if (currentPosition === -1) {
        return res.status(400).json({ error: 'Patient no longer in queue' });
    }

    calledCustomer = lastPatient.name;
    queue[currentPosition].status = 'serving';
    
    res.json({ 
        message: `Returned to patient: ${calledCustomer}`,
        currentPosition
    });
});

app.post('/api/update', (req, res) => {
    const { index, name, priority, notes } = req.body;
    
    if (index < 0 || index >= queue.length) {
        return res.status(400).json({ error: 'Invalid patient index' });
    }

    if (!name) {
        return res.status(400).json({ error: 'Patient name is required' });
    }

    queue[index] = {
        ...queue[index],
        name,
        priority: priority || queue[index].priority,
        notes: notes || queue[index].notes
    };

    sortQueue();
    
    res.json({ 
        message: 'Patient updated successfully',
        patient: queue[index]
    });
});

app.post('/api/remove', (req, res) => {
    const { index } = req.body;
    
    if (index < 0 || index >= queue.length) {
        return res.status(400).json({ error: 'Invalid patient index' });
    }

    const removedPatient = queue.splice(index, 1)[0];
    
    // Adjust current position if needed
    if (index < currentPosition) {
        currentPosition--;
    }

    res.json({ 
        message: 'Patient removed successfully',
        patient: removedPatient
    });
});

app.post('/api/clear', (req, res) => {
    queue = [];
    currentPosition = 0;
    calledCustomer = null;
    previousPatients = [];
    
    res.json({ message: 'Queue cleared successfully' });
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK',
        environment: NODE_ENV,
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running in ${NODE_ENV} mode on port ${PORT}`);
    console.log(`Admin panel available at /admin.html`);
    console.log(`Display screen available at /display.html`);
});