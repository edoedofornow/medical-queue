const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let queue = [];
let currentPosition = 0;
let calledCustomer = null;

// Routes
app.get('/api/queue', (req, res) => res.json({ queue, currentPosition, calledCustomer }));
app.post('/api/queue', (req, res) => {
    const patient = req.body;
    patient.timestamp = new Date().toISOString();
    queue.push(patient);
    sortQueue();
    res.status(201).json(patient);
});
app.post('/api/queue/call', (req, res) => {
    if (queue.length > 0 && currentPosition < queue.length) {
        calledCustomer = queue[currentPosition].name;
        queue[currentPosition].status = 'serving';
    }
    res.json({ calledCustomer });
});
app.post('/api/queue/next', (req, res) => {
    if (currentPosition < queue.length - 1) {
        currentPosition++;
        calledCustomer = null;
    }
    res.json({ currentPosition });
});
app.post('/api/queue/previous', (req, res) => {
    if (currentPosition > 0) {
        currentPosition--;
        calledCustomer = queue[currentPosition].name;
        queue[currentPosition].status = 'serving';
    }
    res.json({ currentPosition });
});
app.post('/api/queue/clear', (req, res) => {
    queue = [];
    currentPosition = 0;
    calledCustomer = null;
    res.sendStatus(204);
});

// Helper
function sortQueue() {
    const priority = { emergency: 4, priority: 3, elderly: 2, normal: 1 };
    queue.sort((a, b) => priority[b.priority] - priority[a.priority] || new Date(a.timestamp) - new Date(b.timestamp));
}

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
